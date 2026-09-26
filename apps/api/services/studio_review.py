"""Read-only, actor-bound Studio review bridge. Never provisions users or bypasses membership."""
import base64
import binascii
import hashlib
import hmac
import json
import subprocess
import tempfile
import time
import uuid
from fractions import Fraction
from pathlib import Path

from fastapi import HTTPException
from ..config import settings
from ..models.asset import Asset, AssetVersion, MediaFile, ProcessingStatus
from ..models.comment import Comment, Annotation
from ..models.project import Project, ProjectRole
from ..models.user import User, UserStatus
from .permissions import get_project_member
from .redis_service import get_redis
from .s3_service import get_s3_client

AUDIENCE = 'elastic-freeframe-review-read-v1'


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


def assertion_user(ticket, db, project_id, asset_id, version_id, operation):
    secret = settings.studio_sso_secret
    if not settings.studio_sso_enabled or not secret or len(secret) < 32:
        raise HTTPException(503, 'Studio review bridge unavailable')
    try:
        if len(ticket) > 4096: raise ValueError()
        body, signature = ticket.split('.')
        expected = hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest()
        supplied = base64.urlsafe_b64decode(signature + '=' * (-len(signature) % 4))
        if not hmac.compare_digest(expected, supplied): raise ValueError()
        claims = json.loads(base64.urlsafe_b64decode(body + '=' * (-len(body) % 4)))
        now = int(time.time())
        if (claims.get('iss') != 'elastic-labs-studio' or claims.get('aud') != AUDIENCE
            or claims.get('operation') != operation
            or claims.get('project_id') != str(project_id) or claims.get('asset_id') != str(asset_id)
            or claims.get('version_id') != str(version_id)
            or type(claims.get('iat')) is not int or type(claims.get('exp')) is not int
            or claims['iat'] > now + 5 or claims['exp'] <= now or claims['exp'] <= claims['iat']
            or claims['exp'] - claims['iat'] > 60): raise ValueError()
        actor = uuid.UUID(claims['sub']); uuid.UUID(claims['jti'])
    except (ValueError, TypeError, KeyError, UnicodeError, binascii.Error, AttributeError):
        raise HTTPException(401, 'Invalid Studio review assertion') from None
    try:
        claimed = get_redis().set('studio_review:' + claims['jti'], '1', nx=True, ex=90)
    except Exception:
        raise HTTPException(503, 'Review replay protection unavailable') from None
    if not claimed: raise HTTPException(401, 'Review assertion already used')
    user = db.query(User).filter(User.id == actor, User.deleted_at.is_(None)).first()
    if not user or user.status != UserStatus.active or not (user.preferences or {}).get('studio_sso'):
        raise HTTPException(403, 'Mapped Studio account unavailable')
    return user


def authorized_scope(db, user, project_id, asset_id, version_id):
    if user.deleted_at is not None or user.status != UserStatus.active or not (user.preferences or {}).get('studio_sso'):
        raise HTTPException(403, 'Mapped Studio account unavailable')
    project = db.query(Project).filter(Project.id == project_id, Project.deleted_at.is_(None)).first()
    member = get_project_member(db, project_id, user.id)
    if not project or not member: raise HTTPException(403, 'Current project membership required')
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.project_id == project_id, Asset.deleted_at.is_(None)).first()
    version = db.query(AssetVersion).filter(AssetVersion.id == version_id, AssetVersion.asset_id == asset_id,
        AssetVersion.deleted_at.is_(None), AssetVersion.processing_status == ProcessingStatus.ready).first()
    if not asset or not version: raise HTTPException(404, 'Review version unavailable')
    return member, asset, version


def visible_comments(db, member, asset_id, version_id):
    query = db.query(Comment).filter(Comment.asset_id == asset_id, Comment.version_id == version_id, Comment.deleted_at.is_(None))
    if member.role not in (ProjectRole.owner, ProjectRole.editor):
        query = query.filter(Comment.visibility == 'public')
    comments = query.order_by(Comment.created_at, Comment.id).all()
    visible = {c.id for c in comments}
    # A hidden parent's reply must not leak the hidden conversation.
    for _ in range(len(comments)):
        hidden = {c.id for c in comments if c.parent_id is not None and c.parent_id not in visible}
        if not hidden: break
        visible -= hidden
    rows = []
    for comment in comments:
        if comment.id not in visible: continue
        drawing = db.query(Annotation).filter(Annotation.comment_id == comment.id).first()
        row = {'id':str(comment.id), 'parentId':str(comment.parent_id) if comment.parent_id else None,
            'authorId':str(comment.author_id) if comment.author_id else None,
            'guestAuthorId':str(comment.guest_author_id) if comment.guest_author_id else None,
            'timeStart':str(comment.timecode_start) if comment.timecode_start is not None else None,
            'timeEnd':str(comment.timecode_end) if comment.timecode_end is not None else None,
            'text':comment.body, 'resolved':comment.resolved, 'visibility':comment.visibility,
            'createdAt':comment.created_at.isoformat(), 'updatedAt':comment.updated_at.isoformat(),
            'drawing':{'id':str(drawing.id), 'data':drawing.drawing_data, 'frameNumber':drawing.frame_number} if drawing else None}
        row['sourceHash'] = digest(row)
        rows.append(row)
    return rows


def probe_file(path):
    ffprobe = Path(settings.studio_review_ffprobe_path)
    if not ffprobe.is_absolute() or not ffprobe.is_file():
        raise HTTPException(503, 'Review timing probe unavailable')
    try:
        result = subprocess.run([str(ffprobe), '-v', 'error', '-select_streams', 'v:0', '-show_frames', '-show_streams',
            '-show_entries', 'stream=time_base,start_pts,duration_ts,width,height,avg_frame_rate:frame=best_effort_timestamp',
            '-of', 'json', str(path)], capture_output=True, timeout=60, check=True)
        if len(result.stdout) > 8_000_000: raise ValueError()
        data = json.loads(result.stdout); stream = data['streams'][0]
        tb = Fraction(stream['time_base'])
        pts = [int(f['best_effort_timestamp']) for f in data['frames']]
        if not pts or len(pts) > 100_000 or any(a >= b for a,b in zip(pts,pts[1:])): raise ValueError()
        duration = Fraction(int(stream['duration_ts'])) * tb
        origin=int(stream['start_pts'])
        if tb<=0 or duration<=0 or pts[0]!=origin or (pts[-1]-origin)*tb>=duration: raise ValueError()
        return {'timeBase':str(tb), 'presentationOriginPts':origin, 'pts':pts, 'duration':str(duration), 'width':stream['width'], 'height':stream['height'],
            'observedFps':stream['avg_frame_rate']}
    except (subprocess.SubprocessError, ValueError, KeyError, IndexError, OSError):
        raise HTTPException(503, 'Exact review timing unavailable') from None


def media_evidence(db, version_id):
    files = db.query(MediaFile).filter(MediaFile.version_id == version_id).all()
    videos = [f for f in files if str(getattr(f.file_type, 'value', f.file_type)) == 'video']
    if len(videos) != 1 or not videos[0].s3_key_download:
        raise HTTPException(409, 'A single review MP4 is required for exact timing')
    media = videos[0]
    client = get_s3_client()
    def download(key, target):
        response = client.get_object(Bucket=settings.s3_bucket, Key=key)
        size = int(response['ContentLength'])
        if size > 512_000_000: raise HTTPException(413, 'Review media exceeds bridge limit')
        sha = hashlib.sha256(); total = 0
        try:
            with target.open('wb') as handle:
                while chunk := response['Body'].read(1024 * 1024):
                    total += len(chunk)
                    if total > 512_000_000: raise HTTPException(413, 'Review media exceeds bridge limit')
                    sha.update(chunk); handle.write(chunk)
        finally: response['Body'].close()
        if total != size: raise HTTPException(503, 'Review media incomplete')
        return sha.hexdigest()
    try:
        with tempfile.TemporaryDirectory(prefix='studio-review-') as directory:
            raw = Path(directory) / 'source'; reviewed = Path(directory) / 'review.mp4'
            raw_sha = download(media.s3_key_raw, raw)
            review_sha = download(media.s3_key_download, reviewed)
            timing = probe_file(reviewed)
            return {'rawSha256':raw_sha, 'reviewSha256':review_sha, 'timing':timing}
    except HTTPException: raise
    except Exception:
        raise HTTPException(503, 'Review media evidence unavailable') from None


def read_review(db, user, project_id, asset_id, version_id, operation):
    member, asset, version = authorized_scope(db,user,project_id,asset_id,version_id)
    comments = visible_comments(db,member,asset_id,version_id)
    result = {'schemaVersion':1, 'actorId':str(user.id), 'projectId':str(project_id), 'assetId':str(asset_id),
        'versionId':str(version_id), 'versionNumber':version.version_number,
        'visibleComments':{c['id']:c['sourceHash'] for c in comments}, 'visibilityHash':digest({c['id']:c['sourceHash'] for c in comments})}
    if operation == 'snapshot':
        result['media'] = media_evidence(db,version_id)
        # Membership may have changed while media was downloaded/probed.
        db.expire_all()
        member, _, _ = authorized_scope(db,user,project_id,asset_id,version_id)
        comments = visible_comments(db,member,asset_id,version_id)
        result['comments'] = comments
        result['visibleComments'] = {c['id']:c['sourceHash'] for c in comments}
        result['visibilityHash'] = digest(result['visibleComments'])
        result['snapshotHash'] = digest(result)
    return result
