"""Native Studio delegation must fail before an existing endpoint can read or mutate foreign scope."""
import time
import hashlib
import uuid
from unittest.mock import MagicMock, patch
import pytest
from fastapi import HTTPException
from jose import jwt
from starlette.requests import Request
from apps.api.config import settings
from apps.api.models.project import ProjectRole
from apps.api.services.studio_native import delegated_studio_user, _check_refs

PROJECT = uuid.uuid4()
ACTOR = uuid.uuid4()
ORG = uuid.uuid4()
ASSET = uuid.uuid4()
OTHER = uuid.uuid4()
SECRET = "studio-native-test-key-with-at-least-32-chars"

@pytest.fixture(autouse=True)
def native_request_state():
    from apps.api.services.studio_native import NATIVE_SCOPE
    mark = NATIVE_SCOPE.set(False)
    with patch("apps.api.services.studio_native.get_redis") as redis:
        redis.return_value.set.return_value = True
        yield
    NATIVE_SCOPE.reset(mark)



def request(method, path):
    return Request({"type": "http", "method": method, "path": path, "query_string": b"", "headers": []})


def token(method, path, project=PROJECT):
    now = int(time.time())
    return jwt.encode({"iss": "elastic-labs-studio", "aud": "studio-native-reviews", "type": "studio_delegate",
      "sub": str(ACTOR), "org": str(ORG), "project": str(project), "method": method, "path": path,
      "request_hash": hashlib.sha256(b"\n").hexdigest(), "iat": now, "exp": now + 45, "jti": str(uuid.uuid4())}, SECRET, algorithm="HS256")


@pytest.mark.asyncio
async def test_foreign_project_path_rejected_before_db(monkeypatch):
    monkeypatch.setattr(settings, "studio_sso_enabled", True)
    monkeypatch.setattr(settings, "studio_native_secret", SECRET)
    with pytest.raises(HTTPException) as e:
        await delegated_studio_user(request("GET", f"/projects/{OTHER}/assets"), token("GET", f"/projects/{OTHER}/assets"), MagicMock())
    assert e.value.status_code == 403


@pytest.mark.asyncio
async def test_token_cannot_change_method_or_path(monkeypatch):
    monkeypatch.setattr(settings, "studio_sso_enabled", True)
    monkeypatch.setattr(settings, "studio_native_secret", SECRET)
    with pytest.raises(HTTPException) as e:
        await delegated_studio_user(request("POST", f"/projects/{PROJECT}/assets"), token("GET", f"/projects/{PROJECT}/assets"), MagicMock())
    assert e.value.status_code == 403


@pytest.mark.asyncio
async def test_owner_and_binding_are_checked(monkeypatch):
    monkeypatch.setattr(settings, "studio_sso_enabled", True)
    monkeypatch.setattr(settings, "studio_native_secret", SECRET)
    db = MagicMock()
    project = MagicMock(id=PROJECT)
    db.query.return_value.filter.return_value.first.return_value = project
    member = MagicMock(role=ProjectRole.owner)
    user = MagicMock(id=ACTOR, preferences={"studio_sso": True})
    from apps.api.models.user import UserStatus
    user.status = UserStatus.active
    with patch("apps.api.services.studio_native.get_project_member", return_value=member), patch("apps.api.services.studio_native.get_user_by_id", return_value=user):
        got = await delegated_studio_user(request("GET", f"/projects/{PROJECT}/assets"), token("GET", f"/projects/{PROJECT}/assets"), db)
        assert got is user
        assert user._studio_native is True
        member.role = ProjectRole.viewer
        with pytest.raises(HTTPException) as e:
            await delegated_studio_user(request("GET", f"/projects/{PROJECT}/assets"), token("GET", f"/projects/{PROJECT}/assets"), db)
        assert e.value.status_code == 403


def test_foreign_asset_reference_denied_even_with_owned_path():
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = MagicMock(id=ASSET, project_id=OTHER)
    with pytest.raises(HTTPException) as e:
        _check_refs(db, PROJECT, {"asset": str(ASSET)})
    assert e.value.status_code == 403

@pytest.mark.asyncio
async def test_assertion_replay_is_rejected(monkeypatch):
    monkeypatch.setattr(settings,'studio_sso_enabled',True)
    monkeypatch.setattr(settings,'studio_native_secret',SECRET)
    db=MagicMock();db.query.return_value.filter.return_value.first.return_value=MagicMock(id=PROJECT)
    user=MagicMock(id=ACTOR,preferences={'studio_sso':True})
    from apps.api.models.user import UserStatus
    user.status=UserStatus.active
    with patch('apps.api.services.studio_native.get_project_member',return_value=MagicMock(role=ProjectRole.owner)),patch('apps.api.services.studio_native.get_user_by_id',return_value=user),patch('apps.api.services.studio_native.get_redis') as redis:
        redis.return_value.set.side_effect=[True,False]
        t=token('GET',f'/projects/{PROJECT}/assets')
        await delegated_studio_user(request('GET',f'/projects/{PROJECT}/assets'),t,db)
        with pytest.raises(HTTPException):
            await delegated_studio_user(request('GET',f'/projects/{PROJECT}/assets'),t,db)

@pytest.mark.asyncio
async def test_query_cannot_be_changed_under_signed_assertion(monkeypatch):
    monkeypatch.setattr(settings,'studio_sso_enabled',True)
    monkeypatch.setattr(settings,'studio_native_secret',SECRET)
    r=Request({'type':'http','method':'GET','path':f'/assets/{ASSET}/stream','query_string':f'version_id={OTHER}'.encode(),'headers':[]})
    db=MagicMock();db.query.return_value.filter.return_value.first.return_value=MagicMock(id=PROJECT)
    user=MagicMock(id=ACTOR,preferences={'studio_sso':True})
    from apps.api.models.user import UserStatus
    user.status=UserStatus.active
    with patch('apps.api.services.studio_native.get_project_member',return_value=MagicMock(role=ProjectRole.owner)),patch('apps.api.services.studio_native.get_user_by_id',return_value=user),pytest.raises(HTTPException):
        await delegated_studio_user(r,token('GET',f'/assets/{ASSET}/stream'),db)


def test_upload_key_cannot_target_another_owned_asset():
    db=MagicMock()
    db.query.return_value.filter.return_value.first.return_value=MagicMock(id=ASSET,project_id=PROJECT)
    with pytest.raises(HTTPException):
        _check_refs(db,PROJECT,{'asset_id':str(ASSET),'s3_key':f'raw/{PROJECT}/{OTHER}/{uuid.uuid4()}/file.mp4'})


def test_share_without_project_or_asset_or_folder_fails_closed():
    db=MagicMock()
    db.query.return_value.filter.return_value.first.return_value=MagicMock(project_id=None,asset_id=None,folder_id=None)
    with pytest.raises(HTTPException):
        _check_refs(db,PROJECT,{'share':'known-review-token'})


def test_version_from_another_asset_is_rejected():
    db=MagicMock()
    from apps.api.models.asset import Asset,AssetVersion
    def query(model):
        result=MagicMock()
        result.filter.return_value=result
        result.first.return_value=MagicMock(id=ASSET,project_id=PROJECT) if model is Asset else MagicMock(id=uuid.uuid4(),asset_id=OTHER)
        return result
    db.query.side_effect=query
    with pytest.raises(HTTPException):
        _check_refs(db,PROJECT,{'asset':str(ASSET),'version_id':str(uuid.uuid4())})


def test_attachment_must_belong_to_path_comment():
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = MagicMock(comment_id=OTHER)
    with pytest.raises(HTTPException):
        _check_refs(db, PROJECT, {"attachment": str(uuid.uuid4()), "comment": str(ASSET)})

@pytest.mark.asyncio
async def test_preexisting_studio_access_session_rejected_at_native_cutover(monkeypatch):
    from apps.api.middleware.auth import get_current_user
    from fastapi.security import HTTPAuthorizationCredentials
    from apps.api.models.user import UserStatus
    monkeypatch.setattr(settings, "studio_native_only", True)
    user = MagicMock(status=UserStatus.active, preferences={"studio_sso": True})
    with patch("apps.api.middleware.auth.decode_token", return_value={"type": "access", "sub": str(ACTOR)}), patch("apps.api.middleware.auth.get_user_by_id", return_value=user):
        with pytest.raises(HTTPException) as error:
            await get_current_user(request("GET", f"/assets/{ASSET}"), HTTPAuthorizationCredentials(scheme="Bearer", credentials="old-access-session"), MagicMock())
        assert error.value.status_code == 401


def test_native_hls_segments_do_not_outlive_manifest():
    from apps.api.routers.hls_proxy import create_hls_token, hls_proxy
    token_value = create_hls_token("processed/test/version", expires_seconds=300)
    s3 = MagicMock()
    s3.get_object.return_value = {"Body": MagicMock(read=lambda: b"#EXTM3U\nsegment.ts\n")}
    with patch("apps.api.routers.hls_proxy.get_s3_client", return_value=s3), patch("apps.api.routers.hls_proxy.generate_presigned_get_url", return_value="https://test.invalid/segment") as sign:
        result = hls_proxy("index.m3u8", token_value)
        assert result.status_code == 200
        assert 1 <= sign.call_args.kwargs["expires_in"] <= 300
