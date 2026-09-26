"""Actor assertions, current ACL, and exact media evidence without live provider writes."""
import base64
import hashlib
import hmac
import io
import json
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace as NS
from unittest.mock import MagicMock
import pytest
from fastapi import HTTPException
from apps.api.services import studio_review as review
from apps.api.models.user import UserStatus
from apps.api.models.project import ProjectRole

SECRET='test-only-review-key-that-is-at-least-32-bytes'
def signed(claims):
    body=base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip('=')
    mac=base64.urlsafe_b64encode(hmac.new(SECRET.encode(),body.encode(),hashlib.sha256).digest()).decode().rstrip('=')
    return body+'.'+mac

@pytest.fixture
def assertion(monkeypatch,mock_db):
    monkeypatch.setattr(review.settings,'studio_sso_secret',SECRET);monkeypatch.setattr(review.settings,'studio_sso_enabled',True)
    monkeypatch.setattr(review.time,'time',lambda:1000)
    redis=MagicMock();redis.set.return_value=True;monkeypatch.setattr(review,'get_redis',lambda:redis)
    ids=[uuid.uuid4() for _ in range(4)];actor,project,asset,version=ids
    user=NS(id=actor,status=UserStatus.active,preferences={'studio_sso':True},deleted_at=None)
    mock_db.first.return_value=user
    claims={'iss':'elastic-labs-studio','aud':review.AUDIENCE,'sub':str(actor),'iat':1000,'exp':1045,'jti':str(uuid.uuid4()),'operation':'authorize','project_id':str(project),'asset_id':str(asset),'version_id':str(version)}
    return claims,mock_db,user,redis,(project,asset,version)

def test_scoped_assertion_replay_and_other_audience(assertion):
    claims,db,user,redis,ids=assertion
    assert review.assertion_user(signed(claims),db,*ids,'authorize') is user
    for changes in ({'aud':'elastic-freeframe-sso'},{'operation':'snapshot'},{'asset_id':str(uuid.uuid4())},{'exp':999},{'iat':True},{'exp':1100}):
        with pytest.raises(HTTPException) as denied:review.assertion_user(signed({**claims,**changes}),db,*ids,'authorize')
        assert denied.value.status_code==401
    redis.set.return_value=False
    with pytest.raises(HTTPException,match='already used'):review.assertion_user(signed(claims),db,*ids,'authorize')

def test_mapped_active_actor_and_current_member_required(assertion,monkeypatch):
    claims,db,user,redis,ids=assertion
    user.preferences={}
    with pytest.raises(HTTPException) as denied:review.assertion_user(signed(claims),db,*ids,'authorize')
    assert denied.value.status_code==403
    user.preferences={'studio_sso':True};user.is_superadmin=True
    monkeypatch.setattr(review,'get_project_member',lambda *_:None)
    with pytest.raises(HTTPException,match='Current project membership'):review.authorized_scope(db,user,*ids)
    user.deleted_at=datetime.now(timezone.utc)
    with pytest.raises(HTTPException,match='Mapped Studio'):review.authorized_scope(db,user,*ids)

def test_hidden_parent_never_leaks_reply(mock_db):
    mock_db.order_by.return_value=mock_db
    now=datetime.now(timezone.utc);parent=uuid.uuid4()
    row=NS(id=uuid.uuid4(),parent_id=parent,author_id=uuid.uuid4(),guest_author_id=None,timecode_start=1.2,timecode_end=1.3,body='public reply under hidden parent',resolved=False,visibility='public',created_at=now,updated_at=now)
    mock_db.all.return_value=[row]
    assert review.visible_comments(mock_db,NS(role=ProjectRole.viewer),uuid.uuid4(),uuid.uuid4())==[]
    row.parent_id=None;mock_db.first.return_value=None
    visible=review.visible_comments(mock_db,NS(role=ProjectRole.reviewer),uuid.uuid4(),uuid.uuid4())
    assert visible[0]['text']==row.body and 'sourceHash' in visible[0]

def test_media_checksums_and_actual_pts(mock_db,monkeypatch):
    mock_db.all.return_value=[NS(file_type='video',s3_key_download='review',s3_key_raw='raw')]
    payload={'raw':b'original video','review':b'exact MP4'}
    s3=NS(get_object=lambda **args:{'ContentLength':len(payload[args['Key']]),'Body':io.BytesIO(payload[args['Key']])})
    monkeypatch.setattr(review,'get_s3_client',lambda:s3)
    monkeypatch.setattr(review,'probe_file',lambda path:{'pts':[0,1000,3100],'timeBase':'1/24000','duration':'1/6','width':10,'height':10})
    result=review.media_evidence(mock_db,uuid.uuid4())
    assert result['rawSha256']==hashlib.sha256(payload['raw']).hexdigest()
    assert result['reviewSha256']==hashlib.sha256(payload['review']).hexdigest()
    assert result['timing']['pts']==[0,1000,3100]

def test_probe_rejects_duplicate_pts(monkeypatch,tmp_path):
    probe = tmp_path / 'ffprobe'; probe.write_bytes(b'fixture executable')
    monkeypatch.setattr(review.settings,'studio_review_ffprobe_path',str(probe))
    data={'streams':[{'time_base':'1/24','duration_ts':2,'width':10,'height':10,'avg_frame_rate':'24/1'}],'frames':[{'best_effort_timestamp':0},{'best_effort_timestamp':0}]}
    monkeypatch.setattr(review.subprocess,'run',lambda *args,**kwargs:NS(stdout=json.dumps(data).encode()))
    with pytest.raises(HTTPException,match='Exact review timing'):review.probe_file(tmp_path/'test.mp4')

def test_membership_rechecked_after_media_download(assertion,monkeypatch):
    _,db,user,_,ids=assertion
    db.first.side_effect=[NS(),NS(),NS(version_number=1),NS()]
    calls=iter([NS(role=ProjectRole.owner),None]);monkeypatch.setattr(review,'get_project_member',lambda *_:next(calls))
    monkeypatch.setattr(review,'visible_comments',lambda *_:[]);monkeypatch.setattr(review,'media_evidence',lambda *_:{})
    with pytest.raises(HTTPException,match='Current project membership'):review.read_review(db,user,*ids,'snapshot')
    db.expire_all.assert_called_once()
