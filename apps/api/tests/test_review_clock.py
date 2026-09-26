"""Mock-only native clock boundaries; real browser evidence has separate receipts."""
import copy
import hashlib
import json
import uuid
from fractions import Fraction
from types import SimpleNamespace as NS
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException, Response
from apps.api.services import review_clock as clock
from apps.api.services.studio_review import digest
from apps.api.models.asset import ProcessingStatus
from apps.api.models.user import UserStatus


def evidence():
    timing={'pts':[9000,10000,11000,12100],'presentationOriginPts':9000,'timeBase':'1/24000','duration':'1/6','width':10,'height':10,'observedFps':'24/1'}
    native={'schema':'freeframe-review-clock/v1','projectId':str(uuid.uuid4()),'assetId':str(uuid.uuid4()),'versionId':str(uuid.uuid4()),
        'rawSha256':'a'*64,'reviewSha256':'b'*64,'timingSha256':digest(timing),'hls':{'masterSha256':'c'*64,'variants':[{
            'level':0,'playlistSha256':'d'*64,'firstVideoPresentationSeconds':'1/6','initDecodeSeconds':'0','browserOriginSeconds':'1/6','timeBase':'1/90000',
            'segments':[{'sequence':0,'sha256':'e'*64,'firstNormalizedPresentationSeconds':'0'}]}]}}
    native['clockSha256']=digest(native)
    return {'reviewClock':native,'timing':timing}


def capture(value):
    return {'schema':'freeframe-annotation-clock/v1','reviewClockSha256':value['reviewClock']['clockSha256'],'level':0,'sequence':0,
        'measuredOriginSeconds':float(Fraction(1,6)),'mediaTimeSeconds':0.25,'hlsInitPts':0,'hlsTimescale':90000,'reviewIndex':2}


def test_capture_binds_presented_pts_with_one_normalization():
    value=evidence();raw=capture(value)
    normalized=clock.normalized_capture(raw,value,float(Fraction(1,12)),None,2)
    assert normalized['verified'] is True
    assert normalized['canonicalTimeSeconds']=='1/12'
    assert normalized['reviewPts']==11000 and normalized['reviewIndex']==2
    assert normalized['rawSha256']==value['reviewClock']['rawSha256']
    assert raw['mediaTimeSeconds']==0.25


@pytest.mark.parametrize(('field','bad'),[
    ('reviewClockSha256','0'*64),('measuredOriginSeconds',0.0),('mediaTimeSeconds',0.151),
    ('mediaTimeSeconds',float('nan')),('mediaTimeSeconds',float('inf')),('hlsInitPts',15000),
    ('hlsTimescale',0),('reviewIndex',1),('reviewIndex',True),('level',99),('sequence',99),
])
def test_forged_or_unpresented_capture_is_denied(field,bad):
    value=evidence();raw=capture(value);raw[field]=bad
    with pytest.raises(HTTPException) as denied:clock.normalized_capture(raw,value,float(Fraction(1,12)),None,2)
    assert denied.value.status_code==409


def test_point_only_clock_rejects_range_and_wrong_drawing_frame():
    value=evidence();raw=capture(value)
    with pytest.raises(HTTPException):clock.normalized_capture(raw,value,float(Fraction(1,12)),0.129,2)
    with pytest.raises(HTTPException):clock.normalized_capture(raw,value,float(Fraction(1,12)),None,1)
    assert clock.normalized_capture(raw,value,float(Fraction(1,12)),float(Fraction(1,12)),2)['reviewIndex']==2


def test_future_buffer_segment_cannot_claim_earlier_presented_frame():
    value=evidence();value['reviewClock']['hls']['variants'][0]['segments'].append({'sequence':1,'sha256':'f'*64,'firstNormalizedPresentationSeconds':'1/12'})
    raw=capture(value)
    with pytest.raises(HTTPException):clock.normalized_capture(raw,value,float(Fraction(1,12)),None,2)
    raw['sequence']=1
    assert clock.normalized_capture(raw,value,float(Fraction(1,12)),None,2)['reviewIndex']==2
    raw.update(reviewIndex=0,mediaTimeSeconds=float(Fraction(1,6)))
    with pytest.raises(HTTPException):clock.normalized_capture(raw,value,0.0,None,0)


def test_segment_probe_uses_integer_pts_not_rounded_pts_time(monkeypatch,tmp_path):
    data={'streams':[{'index':0,'codec_type':'video','time_base':'1/90000','width':10,'height':10}],
        'packets':[{'stream_index':0,'pts':15000,'dts':0,'pts_time':'999.999'}],
        'frames':[{'media_type':'video','best_effort_timestamp':15000,'best_effort_timestamp_time':'999.999'},
            {'media_type':'video','best_effort_timestamp':22500,'best_effort_timestamp_time':'999.999'}]}
    monkeypatch.setattr(clock,'bounded_probe',lambda *a,**kw:json.dumps(data).encode())
    probe=clock._segment_probe(tmp_path/'frame.ts')
    assert probe['pts']==[15000,22500]
    assert probe['timeBase']==Fraction(1,90000) and probe['init']==0


def test_complete_prefix_identity_includes_all_pages_and_objects():
    client=MagicMock();client.head_object.side_effect=[{'ETag':'raw','ContentLength':3},{'ETag':'review','ContentLength':6}]
    client.list_objects_v2.side_effect=[{'Contents':[{'Key':'p/master.m3u8','ETag':'m','Size':12}],'IsTruncated':True,'NextContinuationToken':'page2'},
        {'Contents':[{'Key':'p/low/0.ts','ETag':'s','Size':10},{'Key':'p/thumbnail.jpg','ETag':'t','Size':7}],'IsTruncated':False}]
    result=clock._object_index(client,NS(s3_key_raw='raw',s3_key_download='review',s3_key_processed='p'))
    assert len(result['processed'])==3
    assert ('p/thumbnail.jpg','t',7) in result['processed']
    assert client.list_objects_v2.call_args_list[1].kwargs['ContinuationToken']=='page2'


@pytest.fixture
def mocked_native(monkeypatch):
    media=NS(s3_key_raw='raw',s3_key_download='review',s3_key_processed='p')
    objects={'heads':[('raw-etag',3),('review-etag',6)],'processed':[('p/master.m3u8','m',50),('p/hi/0.ts','s',8)]}
    state={'objects':objects,'downloads':0};cache={}
    redis=NS(get=lambda key:cache.get(key),set=lambda key,value,ex:cache.__setitem__(key,value))
    monkeypatch.setattr(clock,'get_redis',lambda:redis);monkeypatch.setattr(clock,'get_s3_client',lambda:object())
    monkeypatch.setattr(clock,'_object_index',lambda *a:copy.deepcopy(state['objects']))
    payloads={'raw':b'raw','review':b'review','p/master.m3u8':b'#EXTM3U\nhi/index.m3u8\n','p/hi/index.m3u8':b'#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:0.17,\n0.ts\n#EXT-X-ENDLIST\n','p/hi/0.ts':b'segment'}
    def download(client,key,target,budget,max_size=clock.MAX_BYTES):
        state['downloads']+=1;target.write_bytes(payloads[key]);return hashlib.sha256(payloads[key]).hexdigest()
    monkeypatch.setattr(clock,'_download',download)
    monkeypatch.setattr(clock,'probe_file',lambda *a,**kw:evidence()['timing'])
    monkeypatch.setattr(clock,'_segment_probe',lambda *a:{'pts':[15000,18750,22500,26625],'timeBase':Fraction(1,90000),'init':Fraction(0),'width':10,'height':10})
    monkeypatch.setattr(clock,'_decoded_hash',lambda *a:'a'*64)
    return media,state,cache,tuple(uuid.uuid4() for _ in range(3))


def test_native_cache_rechecks_full_fingerprint_and_invalidates_changed_objects(mocked_native):
    media,state,cache,ids=mocked_native
    first=clock.native_review_clock(media,*ids);downloads=state['downloads']
    assert len(cache)==1 and first['reviewClock']['hls']['variants'][0]['browserOriginSeconds']=='1/6'
    assert clock.native_review_clock(media,*ids)==first and state['downloads']==downloads
    state['objects']['processed'].append(('p/thumbnail.jpg','new-etag',7))
    clock.native_review_clock(media,*ids)
    assert len(cache)==2 and state['downloads']>downloads


def test_cached_hit_cannot_return_after_object_identity_changes(mocked_native,monkeypatch):
    media,state,cache,ids=mocked_native;clock.native_review_clock(media,*ids)
    before=copy.deepcopy(state['objects']);changed=copy.deepcopy(before);changed['heads'][0]=('replaced',3)
    index=MagicMock(side_effect=[before,changed]);monkeypatch.setattr(clock,'_object_index',index)
    with pytest.raises(HTTPException) as denied:clock.native_review_clock(media,*ids)
    assert denied.value.status_code==409 and index.call_count==2


def test_exact_pts_and_decoded_pixels_are_both_required(mocked_native,monkeypatch):
    media,state,cache,ids=mocked_native
    monkeypatch.setattr(clock,'_decoded_hash',MagicMock(side_effect=['a'*64,'b'*64]))
    with pytest.raises(HTTPException,match='pixels'):clock.native_review_clock(media,*ids)
    assert not cache


@pytest.mark.parametrize('post_revoke',[False,True])
def test_current_asset_acl_is_checked_before_and_after_clock_probe(mock_db,monkeypatch,post_revoke):
    from apps.api.services import permissions
    asset=NS(id=uuid.uuid4(),project_id=uuid.uuid4(),deleted_at=None)
    version=NS(id=uuid.uuid4(),asset_id=asset.id,deleted_at=None,processing_status=ProcessingStatus.ready)
    user=NS(id=uuid.uuid4(),deleted_at=None,status=UserStatus.active)
    mock_db.all.return_value=[NS(file_type='video')]
    access=MagicMock(side_effect=[None,HTTPException(403,'revoked')] if post_revoke else [HTTPException(403,'revoked')])
    monkeypatch.setattr(permissions,'require_asset_access',access)
    probe=MagicMock(return_value=evidence());monkeypatch.setattr(clock,'native_review_clock',probe)
    with pytest.raises(HTTPException) as denied:clock.clock_for_asset(mock_db,asset,version,user)
    assert denied.value.status_code==403
    assert probe.call_count==int(post_revoke)
    assert access.call_count==(2 if post_revoke else 1)
    mock_db.add.assert_not_called();mock_db.commit.assert_not_called()


def test_review_clock_route_requires_exact_version_and_no_store(mock_db,monkeypatch):
    from apps.api.routers import assets
    asset=NS(id=uuid.uuid4(),project_id=uuid.uuid4());version=NS(id=uuid.uuid4(),asset_id=asset.id)
    mock_db.first.side_effect=[asset,version]
    monkeypatch.setattr(assets,'require_asset_access',lambda *a:None)
    probe=MagicMock(return_value=evidence());monkeypatch.setattr(clock,'clock_for_asset',probe)
    response=Response();user=NS(id=uuid.uuid4())
    assert assets.get_review_clock(asset.id,version.id,response,mock_db,user)==probe.return_value
    probe.assert_called_once_with(mock_db,asset,version,user)
    assert response.headers['Cache-Control']=='private, no-store'
    mock_db.first.side_effect=[asset,None]
    with pytest.raises(HTTPException) as denied:assets.get_review_clock(asset.id,uuid.uuid4(),Response(),mock_db,user)
    assert denied.value.status_code==404

def test_irregular_presentation_pts_choose_frame_without_fps_division():
    value=evidence();raw=capture(value);raw.update(reviewIndex=3,mediaTimeSeconds=float(Fraction(1,6)+Fraction(31,240)))
    result=clock.normalized_capture(raw,value,float(Fraction(31,240)),None,3)
    assert result['reviewPts']==12100 and result['canonicalTimeSeconds']=='31/240'


def test_foreign_asset_version_is_denied_before_clock_probe(mock_db,monkeypatch):
    asset=NS(id=uuid.uuid4(),project_id=uuid.uuid4(),deleted_at=None)
    version=NS(id=uuid.uuid4(),asset_id=uuid.uuid4(),deleted_at=None,processing_status=ProcessingStatus.ready)
    probe=MagicMock();monkeypatch.setattr(clock,'native_review_clock',probe)
    with pytest.raises(HTTPException) as denied:clock.clock_for_asset(mock_db,asset,version,NS())
    assert denied.value.status_code==409
    probe.assert_not_called()


def test_probe_cadence_mismatch_cannot_populate_clock_cache(mocked_native,monkeypatch):
    media,state,cache,ids=mocked_native
    monkeypatch.setattr(clock,'_segment_probe',lambda *a:{'pts':[15000,18750,22501,26625],'timeBase':Fraction(1,90000),'init':Fraction(0),'width':10,'height':10})
    with pytest.raises(HTTPException,match='frame sequence'):clock.native_review_clock(media,*ids)
    assert not cache


@pytest.mark.parametrize('manifest',[
    '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128\n0.ts\n', '#EXTM3U\n#EXT-X-DISCONTINUITY\n0.ts\n',
    '#EXTM3U\n../other.ts\n', '#EXTM3U\nhttps://elsewhere.invalid/clip.ts\n', '#EXTM3U\n/absolute.ts\n',
])
def test_unverified_manifest_structure_and_unbounded_paths_are_denied(manifest):
    with pytest.raises(HTTPException) as denied:clock._references(manifest)
    assert denied.value.status_code==409


def test_media_object_limit_is_enforced():
    client=MagicMock();client.head_object.return_value={'ETag':'e','ContentLength':3}
    client.list_objects_v2.return_value={'Contents':[{'Key':str(i),'ETag':'e','Size':1} for i in range(2001)]}
    with pytest.raises(HTTPException) as denied:clock._object_index(client,NS(s3_key_raw='raw',s3_key_download='review',s3_key_processed='p'))
    assert denied.value.status_code==413


def test_download_bound_closes_body_before_creating_file(tmp_path):
    import io,time
    body=io.BytesIO(b'x');client=NS(get_object=lambda **kw:{'ContentLength':clock.MAX_BYTES+1,'Body':body})
    target=tmp_path/'oversized'
    with pytest.raises(HTTPException) as denied:clock._download(client,'object',target,[0,time.monotonic()+10])
    assert denied.value.status_code==413 and body.closed and not target.exists()


@pytest.mark.parametrize(('program','expected'),[
    ("import sys;sys.stdout.write('x'*8192)",413),
    ("import time;time.sleep(5)",'deadline'),
    ("import sys;sys.exit(3)",'exit'),
])
def test_native_probe_bounds_real_child_output_and_deadline(program,expected):
    import subprocess,sys,time
    from apps.api.services.media_probe import bounded_probe
    started=time.monotonic()
    exception=HTTPException if expected==413 else subprocess.TimeoutExpired if expected=='deadline' else subprocess.CalledProcessError
    with pytest.raises(exception) as denied:bounded_probe([sys.executable,'-c',program],limit=1024,timeout=.15)
    if expected==413:assert denied.value.status_code==413
    if expected=='exit':assert denied.value.returncode==3
    assert time.monotonic()-started<2


def test_native_probe_returns_exact_small_child_bytes():
    import sys
    from apps.api.services.media_probe import bounded_probe
    assert bounded_probe([sys.executable,'-c',"import sys;sys.stdout.buffer.write(b'{\"pts\":[1,2]}')"],limit=1024,timeout=2)==b'{"pts":[1,2]}'


def test_hls_frame_collection_is_bounded_by_reviewed_frame_count(mocked_native,monkeypatch):
    media,state,cache,ids=mocked_native
    monkeypatch.setattr(clock,'_segment_probe',lambda *a:{'pts':[15000,18750,22500,26625,30000],'timeBase':Fraction(1,90000),'init':Fraction(0),'width':10,'height':10})
    with pytest.raises(HTTPException) as denied:clock.native_review_clock(media,*ids)
    assert denied.value.status_code==409 and 'more frames' in denied.value.detail and not cache


def test_create_clocked_comment_stores_canonical_frame_not_browser_float(mock_db,monkeypatch):
    from apps.api.routers import comments
    from apps.api.schemas.comment import CommentCreate
    from apps.api.models.comment import Annotation
    value=evidence();raw=capture(value)
    actor=NS(id=uuid.uuid4(),name='Mock reviewer');asset=NS(id=uuid.uuid4(),project_id=uuid.uuid4(),created_by=actor.id)
    version=NS(id=uuid.uuid4(),asset_id=asset.id)
    mock_db.first.return_value=version
    monkeypatch.setattr(comments,'_get_asset',lambda *a:asset)
    monkeypatch.setattr(comments,'require_asset_access',lambda *a:None)
    monkeypatch.setattr(clock,'clock_for_asset',lambda *a:value)
    monkeypatch.setattr(comments,'_create_mentions',lambda *a:None)
    monkeypatch.setattr(comments.event_service,'publish_sync',lambda *a:None)
    monkeypatch.setattr(comments,'_build_comment_response',lambda c,*a,**kw:c)
    body=CommentCreate(version_id=version.id,body='Mock-only canonical storage check',timecode_start=.25-float(Fraction(1,6)),timecode_end=.25-float(Fraction(1,6)),review_clock=raw,annotation={'drawing_data':{'objects':[]}})
    result=comments.create_comment(asset.id,body,mock_db,actor)
    assert result.timecode_start==float(Fraction(1,12)) and result.timecode_end==result.timecode_start
    assert result.review_clock['canonicalTimeSeconds']=='1/12'
    annotation=next(call.args[0] for call in mock_db.add.call_args_list if isinstance(call.args[0],Annotation))
    assert annotation.frame_number==2
