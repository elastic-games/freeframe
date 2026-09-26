"""Project-bound, server-only Studio delegation for native Reviews.

Tokens are intentionally unusable as normal FreeFrame access tokens. Each token
names one HTTP method and path, lasts at most 60 seconds, and is checked again
against the live project/object graph before an existing endpoint executes.
"""
import re
import time
import uuid
import hashlib
import hmac
from contextvars import ContextVar
from fastapi import HTTPException, Request
from jose import JWTError, jwt
from sqlalchemy.orm import Session
from ..config import settings
from ..models.asset import Asset, AssetVersion
from ..models.comment import Comment, CommentAttachment
from ..models.folder import Folder
from ..models.project import Project, ProjectRole
from ..models.share import ShareLink
from ..models.user import User, UserStatus
from ..services.auth_service import get_user_by_id
from ..services.permissions import get_project_member
from ..services.redis_service import get_redis

NATIVE_SCOPE: ContextVar[bool] = ContextVar("studio_native_scope", default=False)

_UUID = r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
_ALLOWED = [
    ("GET", rf"/projects/(?P<project>{_UUID})"),
    ("GET", rf"/events/(?P<project>{_UUID})"),
    ("GET", rf"/projects/(?P<project>{_UUID})/assets"),
    ("GET", rf"/projects/(?P<project>{_UUID})/folders"),
    ("POST", rf"/projects/(?P<project>{_UUID})/folders"),
    ("GET", rf"/projects/(?P<project>{_UUID})/trash"),
    ("GET", rf"/projects/(?P<project>{_UUID})/folder-tree"),
    ("GET", rf"/assets/(?P<asset>{_UUID})"),
    ("DELETE", rf"/assets/(?P<asset>{_UUID})"),
    ("POST", rf"/assets/(?P<asset>{_UUID})/restore"),
    ("PATCH", rf"/assets/(?P<asset>{_UUID})/move"),
    ("GET", rf"/assets/(?P<asset>{_UUID})/versions"),
    ("GET", rf"/assets/(?P<asset>{_UUID})/stream"),
    ("GET", rf"/assets/(?P<asset>{_UUID})/comments"),
    ("GET", rf"/assets/(?P<asset>{_UUID})/comments/export"),
    ("POST", rf"/assets/(?P<asset>{_UUID})/comments"),
    ("POST", rf"/assets/(?P<asset>{_UUID})/comments/(?P<comment>{_UUID})/replies"),
    ("POST", rf"/comments/(?P<comment>{_UUID})/resolve"),
    ("PATCH", rf"/comments/(?P<comment>{_UUID})"),
    ("DELETE", rf"/comments/(?P<comment>{_UUID})"),
    ("POST", rf"/comments/(?P<comment>{_UUID})/attachments"),
    ("DELETE", rf"/comments/(?P<comment>{_UUID})/attachments/(?P<attachment>{_UUID})"),
    ("POST", rf"/comments/(?P<comment>{_UUID})/react"),
    ("GET", rf"/assets/(?P<asset>{_UUID})/shares"),
    ("POST", rf"/assets/(?P<asset>{_UUID})/share"),
    ("DELETE", r"/share/(?P<share>[A-Za-z0-9_-]{16,128})"),
    ("PATCH", r"/share/(?P<share>[A-Za-z0-9_-]{16,128})"),
    ("PATCH", rf"/folders/(?P<folder>{_UUID})"),
    ("DELETE", rf"/folders/(?P<folder>{_UUID})"),
    ("POST", rf"/folders/(?P<folder>{_UUID})/restore"),
    ("POST", r"/upload/initiate"),
    ("POST", r"/upload/presign-part"),
    ("POST", r"/upload/complete"),
    ("POST", r"/upload/abort"),
    ("GET", rf"/upload/(?P<version>{_UUID})/parts"),
]


def _denied() -> HTTPException:
    return HTTPException(status_code=403, detail="Review scope unavailable")


def _uuid(value):
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        raise _denied() from None


def _check_refs(db: Session, project_id: uuid.UUID, values: dict, allow_deleted: bool = False):
    if values.get("project") is not None and _uuid(values["project"]) != project_id:
        raise _denied()
    if values.get("project_id") is not None and _uuid(values["project_id"]) != project_id:
        raise _denied()
    asset_id = values.get("asset") or values.get("asset_id")
    for key in ("asset", "asset_id"):
        if values.get(key) is not None:
            query = db.query(Asset).filter(Asset.id == _uuid(values[key]))
            row = (query if allow_deleted else query.filter(Asset.deleted_at.is_(None))).first()
            if not row or row.project_id != project_id:
                raise _denied()
            if asset_id is not None and row.id != _uuid(asset_id):
                raise _denied()
    for key in ("version", "version_id"):
        if values.get(key) is not None:
            row = db.query(AssetVersion).filter(AssetVersion.id == _uuid(values[key]), AssetVersion.deleted_at.is_(None)).first()
            if not row:
                raise _denied()
            _check_refs(db, project_id, {"asset": row.asset_id})
            if asset_id is not None and row.asset_id != _uuid(asset_id):
                raise _denied()
            if values.get("upload_id") is not None and row.upload_id != values["upload_id"]:
                raise _denied()
    for key in ("folder", "folder_id"):
        if values.get(key) not in (None, "root"):
            query = db.query(Folder).filter(Folder.id == _uuid(values[key]))
            row = (query if allow_deleted else query.filter(Folder.deleted_at.is_(None))).first()
            if not row or row.project_id != project_id:
                raise _denied()
    for key in ("comment", "comment_id", "comment_parent"):
        if values.get(key) is not None:
            row = db.query(Comment).filter(Comment.id == _uuid(values[key]), Comment.deleted_at.is_(None)).first()
            if not row:
                raise _denied()
            _check_refs(db, project_id, {"asset": row.asset_id})
            if asset_id is not None and row.asset_id != _uuid(asset_id):
                raise _denied()
    if values.get("attachment") is not None:
        attachment = db.query(CommentAttachment).filter(CommentAttachment.id == _uuid(values["attachment"])).first()
        if not attachment or not values.get("comment") or attachment.comment_id != _uuid(values["comment"]):
            raise _denied()
        _check_refs(db, project_id, {"comment": attachment.comment_id})
    if values.get("share") is not None:
        link = db.query(ShareLink).filter(ShareLink.token == values["share"], ShareLink.deleted_at.is_(None)).first()
        if not link or not any((link.project_id, link.asset_id, link.folder_id)):
            raise _denied()
        if link.project_id is not None and link.project_id != project_id:
            raise _denied()
        if link.asset_id is not None:
            _check_refs(db, project_id, {"asset": link.asset_id})
        if link.folder_id is not None:
            _check_refs(db, project_id, {"folder": link.folder_id})
    s3_key = values.get("s3_key")
    if s3_key is not None:
        if not isinstance(s3_key, str) or not s3_key.startswith(f"raw/{project_id}/"):
            raise _denied()
        parts = s3_key.split("/")
        if len(parts) < 5:
            raise _denied()
        if asset_id is not None and _uuid(parts[2]) != _uuid(asset_id):
            raise _denied()
        if values.get("version_id") is not None and _uuid(parts[3]) != _uuid(values["version_id"]):
            raise _denied()
        _check_refs(db, project_id, {"asset": parts[2], "version": parts[3], "upload_id": values.get("upload_id")})


async def delegated_studio_user(request: Request, token: str, db: Session) -> User:
    secret = settings.studio_native_secret
    if not settings.studio_sso_enabled or not secret or len(secret) < 32:
        raise _denied()
    try:
        claim = jwt.decode(token, secret, algorithms=["HS256"], audience="studio-native-reviews")
        now = int(time.time())
        if (claim.get("iss") != "elastic-labs-studio" or claim.get("type") != "studio_delegate"
                or not isinstance(claim.get("iat"), int) or claim["iat"] > now + 5
                or not isinstance(claim.get("exp"), int) or claim["exp"] - claim["iat"] > 60
                or claim.get("method") != request.method or claim.get("path") != request.url.path
                or not isinstance(claim.get("org"), str)):
            raise _denied()
        project_id = _uuid(claim["project"])
        user_id = _uuid(claim["sub"])
        _uuid(claim["org"])
    except (JWTError, KeyError, ValueError, TypeError):
        raise _denied() from None
    match = next((re.fullmatch(pattern, request.url.path) for method, pattern in _ALLOWED
                  if method == request.method and re.fullmatch(pattern, request.url.path)), None)
    if not match:
        raise _denied()
    project = db.query(Project).filter(Project.id == project_id, Project.deleted_at.is_(None)).first()
    member = get_project_member(db, project_id, user_id)
    user = get_user_by_id(db, user_id)
    if (not project or not member or member.role != ProjectRole.owner or not user
            or user.status == UserStatus.deactivated or not (user.preferences or {}).get("studio_sso")):
        raise _denied()
    values = dict(match.groupdict())
    raw = b""
    for key in ("version_id", "folder_id"):
        if request.query_params.get(key):
            values[key] = request.query_params[key]
    if request.method in ("POST", "PATCH"):
        if request.headers.get("content-type", "").split(";")[0].lower() != "application/json":
            raise _denied()
        raw = await request.body()
        if len(raw) > 2_000_000:
            raise HTTPException(status_code=413, detail="Review request too large")
        try:
            body = await request.json()
        except ValueError:
            raise _denied() from None
        if not isinstance(body, dict):
            raise _denied()
        if any(key in body and str(body[key]) != str(value) for key, value in values.items()):
            raise _denied()
        values.update(body)
        parent_id = values.pop("parent_id", None)
        if parent_id is not None:
            if "/folders" in request.url.path:
                _check_refs(db, project_id, {"folder": parent_id})
            else:
                values["comment_parent"] = parent_id
    digest = hashlib.sha256(request.url.query.encode() + b"\n" + raw).hexdigest()
    if not isinstance(claim.get("request_hash"), str) or not hmac.compare_digest(claim["request_hash"], digest):
        raise _denied()
    nonce = _uuid(claim.get("jti"))
    _check_refs(db, project_id, values, allow_deleted=request.url.path.endswith("/restore"))
    # Consume assertions only after authorization. Redis is shared across API
    # workers; an unavailable replay store must not authorize a mutation.
    try:
        accepted = get_redis().set(f"studio_native:{nonce}", "1", nx=True, ex=65)
    except Exception:
        raise HTTPException(status_code=503, detail="Review authorization unavailable") from None
    if not accepted:
        raise _denied()
    user._studio_native = True
    NATIVE_SCOPE.set(True)
    return user
