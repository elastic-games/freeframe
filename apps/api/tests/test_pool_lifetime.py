"""Async waits must not retain DB connections; fresh poster ACL stays authoritative."""
import hashlib
import time
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException
from jose import jwt
from starlette.requests import Request


@pytest.mark.asyncio
async def test_revoked_owner_during_poster_read_cannot_commit():
    from apps.api.routers import projects
    db=MagicMock();old_key='posters/old-owned-poster.png';project=SimpleNamespace(poster_s3_key=old_key)
    async def read():
        db.close.assert_called_once()
        return b'synthetic-image'
    file=SimpleNamespace(content_type='image/png',filename='fixture.png',read=read)
    with patch.object(projects,'_get_project',return_value=project), \
         patch.object(projects,'_require_project_owner',side_effect=[object(),HTTPException(403,'revoked')]), \
         patch.object(projects,'put_object') as put,patch.object(projects,'delete_object') as delete,pytest.raises(HTTPException) as error:
        await projects.upload_project_poster(uuid.uuid4(),file,db,SimpleNamespace(id=uuid.uuid4()))
    assert error.value.status_code==403
    assert project.poster_s3_key==old_key
    assert put.call_count==1
    assert put.call_args.args[0]!=old_key
    delete.assert_called_once_with(put.call_args.args[0])
    db.commit.assert_not_called()


@pytest.mark.asyncio
async def test_ambiguous_poster_commit_retains_new_object_for_reconciliation():
    from apps.api.routers import projects
    db=MagicMock();db.commit.side_effect=RuntimeError('ambiguous commit')
    project=SimpleNamespace(poster_s3_key='posters/prior.png')
    async def read():return b'synthetic-image'
    file=SimpleNamespace(content_type='image/png',filename='fixture.png',read=read)
    with patch.object(projects,'_get_project',return_value=project), \
         patch.object(projects,'_require_project_owner',return_value=object()), \
         patch.object(projects,'put_object') as put,patch.object(projects,'delete_object') as delete, \
         pytest.raises(RuntimeError,match='ambiguous commit'):
        await projects.upload_project_poster(uuid.uuid4(),file,db,SimpleNamespace(id=uuid.uuid4()))
    assert put.call_count==1
    delete.assert_not_called()


@pytest.mark.asyncio
async def test_stream_releases_session_before_redis_generator():
    from apps.api.routers import events
    from apps.api.models.user import UserStatus
    db=MagicMock()
    async def stream(project_id):
        db.close.assert_called_once()
        yield ': synthetic\n\n'
    request=Request({'type':'http','method':'GET','path':'/events/fixture','headers':[],'query_string':b''})
    with patch.object(events,'get_project_member',return_value=object()),patch.object(events,'event_stream',stream):
        response=await events.stream_events(uuid.uuid4(),request,db,None,
                 SimpleNamespace(id=uuid.uuid4(),status=UserStatus.active,preferences={}))
        assert await anext(response.body_iterator)==': synthetic\n\n'


@pytest.mark.asyncio
async def test_delegated_body_is_bound_before_any_database_read(monkeypatch):
    from apps.api.config import settings
    from apps.api.services.studio_native import delegated_studio_user
    secret='synthetic-test-delegation-secret-at-least-32-bytes'
    monkeypatch.setattr(settings,'studio_sso_enabled',True)
    monkeypatch.setattr(settings,'studio_native_secret',secret)
    pid=uuid.uuid4();path=f'/projects/{pid}/folders';now=int(time.time());db=MagicMock()
    claim={'iss':'elastic-labs-studio','aud':'studio-native-reviews','type':'studio_delegate',
           'sub':str(uuid.uuid4()),'org':str(uuid.uuid4()),'project':str(pid),'method':'POST','path':path,
           'iat':now,'exp':now+45,'jti':str(uuid.uuid4()),'request_hash':hashlib.sha256(b'wrong').hexdigest()}
    async def receive():
        db.query.assert_not_called()
        return {'type':'http.request','body':b'{"name":"Synthetic"}','more_body':False}
    request=Request({'type':'http','method':'POST','path':path,'headers':[(b'content-type',b'application/json')],
                     'query_string':b''},receive)
    with pytest.raises(HTTPException) as error:
        await delegated_studio_user(request,jwt.encode(claim,secret,algorithm='HS256'),db)
    assert error.value.status_code==403
    db.query.assert_not_called()
