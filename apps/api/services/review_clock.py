"""Native, version-bound presentation clocks. Never infer frame identity from fps."""
import hashlib
import json
import math
import posixpath
import re
import subprocess
import tempfile
import time
from fractions import Fraction
from pathlib import Path

from fastapi import HTTPException
from ..config import settings
from .redis_service import get_redis
from .s3_service import get_s3_client
from .studio_review import digest, probe_file
from .media_probe import bounded_probe

MAX_BYTES = 512_000_000


def clock_for_asset(db, asset, version, user):
    from ..models.asset import MediaFile, ProcessingStatus
    from ..models.user import UserStatus
    from .permissions import require_asset_access
    if version.asset_id != asset.id or version.deleted_at is not None or version.processing_status != ProcessingStatus.ready:
        raise HTTPException(409,'Exact review version is unavailable')
    require_asset_access(db,asset,user)
    files=db.query(MediaFile).filter(MediaFile.version_id==version.id).all()
    videos=[f for f in files if str(getattr(f.file_type,'value',f.file_type))=='video']
    if len(videos)!=1: raise HTTPException(409,'A single reviewed video is required')
    result=native_review_clock(videos[0],asset.project_id,asset.id,version.id)
    db.expire_all()
    if asset.deleted_at is not None or version.deleted_at is not None or user.deleted_at is not None or user.status!=UserStatus.active:
        raise HTTPException(403,'Current review access is unavailable')
    require_asset_access(db,asset,user)
    return result


def _object_index(client, media):
    heads = [client.head_object(Bucket=settings.s3_bucket, Key=key) for key in (media.s3_key_raw, media.s3_key_download)]
    rows = []
    token = None
    while True:
        args = {'Bucket':settings.s3_bucket, 'Prefix':media.s3_key_processed.rstrip('/')+'/'}
        if token: args['ContinuationToken'] = token
        response = client.list_objects_v2(**args)
        rows.extend(response.get('Contents', []))
        if len(rows) > 2000: raise HTTPException(413, 'Review clock has too many media objects')
        if not response.get('IsTruncated'): break
        token = response['NextContinuationToken']
    if not rows or any(not r.get('ETag') for r in rows) or any(not h.get('ETag') for h in heads):
        raise HTTPException(409, 'Immutable review object identity is unavailable')
    return {'heads':[(h['ETag'],h['ContentLength']) for h in heads],
        'processed':sorted((r['Key'],r['ETag'],r['Size']) for r in rows)}


def _download(client, key, target, budget, max_size=MAX_BYTES):
    if time.monotonic()>budget[1]: raise HTTPException(504,'Native clock probe deadline exceeded')
    response = client.get_object(Bucket=settings.s3_bucket, Key=key)
    sha = hashlib.sha256(); size = int(response['ContentLength']); total = 0
    budget[0] += size
    if size>max_size or budget[0] > MAX_BYTES: response['Body'].close(); raise HTTPException(413, 'Review clock exceeds media probe limit')
    try:
        with target.open('wb') as handle:
            while chunk := response['Body'].read(1024*1024):
                if time.monotonic()>budget[1]: raise HTTPException(504,'Native clock probe deadline exceeded')
                total += len(chunk)
                if total > size: raise HTTPException(503, 'Review object size changed')
                sha.update(chunk); handle.write(chunk)
    finally: response['Body'].close()
    if total != size: raise HTTPException(503, 'Review media is incomplete')
    return sha.hexdigest()


def _references(text):
    if any(tag in text for tag in ('#EXT-X-KEY:', '#EXT-X-DISCONTINUITY', '#EXT-X-MAP:')):
        raise HTTPException(409, 'This HLS structure has no verified presentation clock')
    refs = [line.strip() for line in text.splitlines() if line.strip() and not line.startswith('#')]
    if not refs or len(refs) > 1000: raise HTTPException(409, 'HLS manifest has no bounded media sequence')
    for ref in refs:
        if not re.fullmatch(r'[A-Za-z0-9_./-]+', ref) or ref.startswith('/') or '..' in ref.split('/'):
            raise HTTPException(409, 'HLS media reference is unsupported')
    return refs


def _segment_probe(path, timeout=60):
    args = [settings.studio_review_ffprobe_path, '-v','error','-show_streams','-show_packets','-show_frames',
        '-show_entries','stream=index,codec_type,time_base,width,height:packet=stream_index,pts,dts:frame=media_type,best_effort_timestamp',
        '-of','json',str(path)]
    result = bounded_probe(args,limit=16_000_000,timeout=timeout)
    data = json.loads(result); streams = {s['index']:s for s in data['streams']}
    video = next(s for s in streams.values() if s['codec_type']=='video'); tb=Fraction(video['time_base'])
    mixed = data.get('packets_and_frames', [])
    frames = data.get('frames', []) or [r for r in mixed if r.get('type')=='frame']
    packets = data.get('packets', []) or [r for r in mixed if r.get('type')=='packet']
    pts=[int(f['best_effort_timestamp']) for f in frames if f.get('media_type')=='video']
    if not pts or len(pts)>100_000 or any(a>=b for a,b in zip(pts,pts[1:])): raise HTTPException(409,'HLS frame order is unverified')
    first = {}
    for packet in packets:
        index=packet['stream_index']; stream=streams[index]
        if stream['codec_type'] not in ('video','audio') or index in first: continue
        # HLS.js anchors the main remuxer to lowest video DTS / audio PTS.
        field='dts' if stream['codec_type']=='video' else 'pts'
        first[index]=Fraction(int(packet[field]))*Fraction(stream['time_base'])
    if not first: raise HTTPException(409,'HLS decode origin is unavailable')
    return {'pts':pts,'timeBase':tb,'init':min(first.values()),'width':video['width'],'height':video['height']}


def _decoded_hash(path, timeout=120):
    executable=Path(settings.studio_review_ffprobe_path).with_name('ffmpeg')
    if not executable.is_absolute() or not executable.is_file(): raise HTTPException(503,'Review pixel probe unavailable')
    result=bounded_probe([str(executable),'-v','error','-i',str(path),'-map','0:v:0','-pix_fmt','rgb24',
        '-f','hash','-hash','sha256','pipe:1'],limit=4096,timeout=timeout)
    value=result.decode().strip().split('=')[-1]
    if not re.fullmatch('[0-9a-f]{64}',value): raise HTTPException(503,'Review pixel identity unavailable')
    return value


def native_review_clock(media, project_id, asset_id, version_id):
    if not media.s3_key_download or not media.s3_key_processed or not media.s3_key_raw:
        raise HTTPException(409,'A complete video review rendition is required')
    client=get_s3_client(); before=_object_index(client,media)
    identity=digest({'versionId':str(version_id),'objects':before})
    cache_key='review_clock:v1:'+identity
    cached=None
    try:
        cached=get_redis().get(cache_key)
        if cached: cached=json.loads(cached)
    except Exception: cached=None
    if cached and cached['reviewClock']['projectId']==str(project_id) and cached['reviewClock']['assetId']==str(asset_id):
        if _object_index(client,media)!=before: raise HTTPException(409,'Review objects changed during clock cache verification')
        return cached
    try:
        with tempfile.TemporaryDirectory(prefix='native-review-clock-') as directory:
            root=Path(directory); budget=[0,time.monotonic()+120]; raw=root/'raw'; review=root/'review.mp4'
            def remaining(cap):
                value=budget[1]-time.monotonic()
                if value<=0: raise HTTPException(504,'Native clock probe deadline exceeded')
                return min(cap,value)
            raw_sha=_download(client,media.s3_key_raw,raw,budget); review_sha=_download(client,media.s3_key_download,review,budget)
            timing=probe_file(review, timeout=remaining(60)); normalized=[Fraction(p-timing['presentationOriginPts'])*Fraction(timing['timeBase']) for p in timing['pts']]
            master=root/'master.m3u8'; prefix=media.s3_key_processed.rstrip('/')
            master_sha=_download(client,prefix+'/master.m3u8',master,budget,1_000_000); variants=[]; reviewed_pixel_hash=None; pixel_match=False
            refs=_references(master.read_text())
            if len(refs)>32: raise HTTPException(413,'Too many HLS review renditions')
            total_segments=0
            for level,ref in enumerate(refs):
                playlist=root/f'playlist-{level}.m3u8'; playlist_sha=_download(client,prefix+'/'+ref,playlist,budget,1_000_000); content=playlist.read_text()
                if '#EXT-X-ENDLIST' not in content: raise HTTPException(409,'Only complete VOD clocks are supported')
                sequence_match=re.search(r'^#EXT-X-MEDIA-SEQUENCE:(\d+)\s*$',content,re.M); sequence=int(sequence_match[1]) if sequence_match else 0
                segments=[]; combined=root/f'variant-{level}.ts'; combined_pts=[]; first_probe=None
                with combined.open('wb') as output:
                    for index,segment_ref in enumerate(_references(content)):
                        total_segments+=1
                        if total_segments>10_000: raise HTTPException(413,'Too many HLS review segments')
                        if not segment_ref.endswith('.ts'): raise HTTPException(409,'Only MPEG-TS review clocks are supported')
                        segment=root/f'segment-{level}-{index}.ts'; key=prefix+'/'+posixpath.join(posixpath.dirname(ref),segment_ref)
                        sha=_download(client,key,segment,budget); probe=_segment_probe(segment,remaining(60))
                        if first_probe is None: first_probe=probe
                        if probe['timeBase']!=first_probe['timeBase']: raise HTTPException(409,'HLS time base changes within a rendition')
                        base=Fraction(first_probe['pts'][0])*first_probe['timeBase']
                        segment_pts=[Fraction(p)*probe['timeBase']-base for p in probe['pts']]
                        if len(combined_pts)+len(segment_pts)>len(normalized): raise HTTPException(409,'HLS has more frames than the reviewed rendition')
                        combined_pts.extend(segment_pts); segments.append({'sequence':sequence+index,'sha256':sha,'firstNormalizedPresentationSeconds':str(segment_pts[0])})
                        with segment.open('rb') as source:
                            while chunk:=source.read(1024*1024): output.write(chunk)
                if combined_pts!=normalized: raise HTTPException(409,'HLS frames do not match the normalized reviewed frame sequence')
                first_time=Fraction(first_probe['pts'][0])*first_probe['timeBase']; offset=first_time-first_probe['init']
                if abs(offset)>10: raise HTTPException(409,'HLS presentation origin is unsupported')
                variant={'level':level,'playlistSha256':playlist_sha,'firstVideoPresentationSeconds':str(first_time),
                    'initDecodeSeconds':str(first_probe['init']),'browserOriginSeconds':str(offset),'timeBase':str(first_probe['timeBase']),'segments':segments}
                if (first_probe['width'],first_probe['height'])==(timing['width'],timing['height']):
                    if reviewed_pixel_hash is None: reviewed_pixel_hash=_decoded_hash(review,remaining(120))
                    native_hash=_decoded_hash(combined,remaining(120))
                    if native_hash==reviewed_pixel_hash: pixel_match=True; variant['reviewedDecodedPixelSha256']=native_hash
                variants.append(variant)
            if not pixel_match: raise HTTPException(409,'HLS pixels do not match the reviewed rendition')
            if _object_index(client,media)!=before: raise HTTPException(409,'Review objects changed during clock verification')
            clock={'schema':'freeframe-review-clock/v1','projectId':str(project_id),'assetId':str(asset_id),'versionId':str(version_id),
                'rawSha256':raw_sha,'reviewSha256':review_sha,'timingSha256':digest(timing),'hls':{'masterSha256':master_sha,'variants':variants}}
            clock['clockSha256']=digest(clock); result={'reviewClock':clock,'timing':timing}
            try: get_redis().set(cache_key,json.dumps(result),ex=600)
            except Exception: pass
            return result
    except HTTPException: raise
    except (OSError,ValueError,KeyError,IndexError,StopIteration,subprocess.SubprocessError):
        raise HTTPException(503,'Native review clock verification unavailable') from None


def normalized_capture(capture, evidence, time_start, time_end, drawing_index=None):
    """Validate observed browser clock against native media, then derive canonical frame."""
    try:
        expected_keys={'schema','reviewClockSha256','level','sequence','measuredOriginSeconds','mediaTimeSeconds','hlsInitPts','hlsTimescale','reviewIndex'}
        if not isinstance(capture,dict) or set(capture)!=expected_keys or capture['schema']!='freeframe-annotation-clock/v1': raise ValueError()
        clock=evidence['reviewClock']; timing=evidence['timing']
        if capture['reviewClockSha256']!=clock['clockSha256']: raise ValueError()
        level=capture['level']; index=capture['reviewIndex']
        if type(level)is not int or type(index)is not int: raise ValueError()
        variant=next(v for v in clock['hls']['variants'] if v['level']==level)
        if type(capture['sequence'])is not int: raise ValueError()
        for field in ('measuredOriginSeconds','mediaTimeSeconds'):
            if type(capture[field])not in (int,float) or not math.isfinite(capture[field]) or abs(capture[field])>1_000_000: raise ValueError()
        if type(capture['hlsInitPts'])is not int or abs(capture['hlsInitPts'])>2**63 or type(capture['hlsTimescale'])is not int or not 0<capture['hlsTimescale']<=1_000_000_000: raise ValueError()
        quantum=Fraction(variant['timeBase']); origin=Fraction(variant['browserOriginSeconds'])
        if abs(Fraction(str(capture['measuredOriginSeconds']))-origin)>quantum: raise ValueError()
        if abs(Fraction(capture['hlsInitPts'],capture['hlsTimescale'])-Fraction(variant['initDecodeSeconds']))>quantum: raise ValueError()
        normalized=Fraction(str(capture['mediaTimeSeconds']))-origin
        times=[Fraction(p-timing['presentationOriginPts'])*Fraction(timing['timeBase']) for p in timing['pts']]
        if normalized < -quantum or normalized > Fraction(timing['duration'])+quantum: raise ValueError()
        nearest=min(range(len(times)),key=lambda i:(abs(times[i]-normalized),i))
        if index!=nearest or drawing_index is not None and drawing_index!=index: raise ValueError()
        if abs(times[index]-normalized)>quantum: raise ValueError()
        segment_index=next(i for i,s in enumerate(variant['segments']) if s['sequence']==capture['sequence'])
        segment_start=Fraction(variant['segments'][segment_index]['firstNormalizedPresentationSeconds'])
        segment_end=Fraction(variant['segments'][segment_index+1]['firstNormalizedPresentationSeconds']) if segment_index+1<len(variant['segments']) else Fraction(timing['duration'])
        if not segment_start<=times[index]<segment_end: raise ValueError()
        if time_start is None or abs(Fraction(str(time_start))-times[index])>quantum: raise ValueError()
        if time_end is not None and Fraction(str(time_end))!=Fraction(str(time_start)): raise ValueError()
        return {'schema':'freeframe-annotation-clock/v1','verified':True,'reviewClockSha256':clock['clockSha256'],
            'rawSha256':clock['rawSha256'],'reviewSha256':clock['reviewSha256'],'timingSha256':clock['timingSha256'],'playback':'hls',
            **{k:capture[k] for k in ('level','sequence','measuredOriginSeconds','mediaTimeSeconds','hlsInitPts','hlsTimescale')},
            'browserOriginSeconds':str(origin),'reviewIndex':index,'reviewPts':timing['pts'][index],'canonicalTimeSeconds':str(times[index])}
    except (ValueError,TypeError,KeyError,IndexError,StopIteration,ZeroDivisionError):
        raise HTTPException(409,'The annotation has no verified canonical review frame') from None
