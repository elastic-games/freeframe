"""Narrow API for independently revocable Redchain review workers.

The opaque worker key never enters FreeFrame's general user authentication. All
object IDs are resolved through the credential's current project and folder.
"""
import hashlib
import json
import logging
import re
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.asset import Asset, AssetVersion, MediaFile, ProcessingStatus
from ..models.comment import Comment
from ..models.folder import Folder
from ..models.project import Project, ProjectRole
from ..models.review_worker import ReviewWorker, ReviewWorkerOperation
from ..models.user import User, UserStatus
from ..schemas.comment import CommentCreate
from ..schemas.upload import CompleteUploadRequest, InitiateUploadRequest, PresignPartRequest, MAX_MULTIPART_BYTES
from ..services.permissions import get_project_member
from ..services.review_worker_binding import require_studio_binding
from . import comments, upload

router = APIRouter(prefix="/review-workers", tags=["review-workers"])
log = logging.getLogger(__name__)
CLIP = re.compile(r"^[0-9]{3}_[A-Za-z0-9_]{1,60}$")
VERSION = re.compile(r"^v[0-9]{2,3}$")
KEY = re.compile(r"^rw_[A-Za-z0-9_-]{40,100}$")


def _deny():
    raise HTTPException(status_code=404, detail="Review item unavailable")


def worker_scope(x_review_key: str | None = Header(default=None), db: Session = Depends(get_db)):
    if not x_review_key or not KEY.fullmatch(x_review_key):
        raise HTTPException(status_code=401, detail="Review credential required")
    digest = hashlib.sha256(x_review_key.encode()).hexdigest()
    worker = db.query(ReviewWorker).filter(ReviewWorker.key_hash == digest,
                                            ReviewWorker.revoked_at.is_(None)).first()
    if not worker:
        raise HTTPException(status_code=401, detail="Review credential unavailable")
    project = db.query(Project).filter(Project.id == worker.project_id,
                                       Project.deleted_at.is_(None)).first()
    folder = db.query(Folder).filter(Folder.id == worker.folder_id,
                                     Folder.project_id == worker.project_id,
                                     Folder.deleted_at.is_(None)).first()
    user = db.query(User).filter(User.id == worker.user_id,
                                 User.deleted_at.is_(None)).first()
    member = get_project_member(db, worker.project_id, worker.user_id)
    if (not project or not folder or folder.project_id != worker.project_id or
            not user or user.status != UserStatus.active or
            not member or member.role not in (ProjectRole.owner, ProjectRole.editor)):
        raise HTTPException(status_code=403, detail="Review access revoked")
    require_studio_binding(worker.organization_id, worker.project_id)
    return worker, user


def _asset(db: Session, worker: ReviewWorker, asset_id: uuid.UUID):
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.project_id == worker.project_id,
                                   Asset.folder_id == worker.folder_id,
                                   Asset.deleted_at.is_(None)).first()
    if not asset or asset.project_id != worker.project_id or asset.folder_id != worker.folder_id:
        _deny()
    return asset


def _version(db: Session, worker: ReviewWorker, version_id: uuid.UUID):
    version = db.query(AssetVersion).filter(AssetVersion.id == version_id,
                                             AssetVersion.deleted_at.is_(None)).first()
    if not version:
        _deny()
    _asset(db, worker, version.asset_id)
    return version


def _upload_version(db: Session, worker: ReviewWorker, version_id: uuid.UUID):
    version = _version(db, worker, version_id)
    receipt = db.query(ReviewWorkerOperation).filter(
        ReviewWorkerOperation.worker_id == worker.id,
        ReviewWorkerOperation.operation == "upload",
        ReviewWorkerOperation.version_id == version_id,
    ).first()
    if not receipt:
        _deny()
    return version


def _hash(value: dict):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _asset_has_clip_number(asset_name: str, clip: str) -> bool:
    match = re.match(r"^(?:Redchain[\W_]*)?([0-9]{3})(?![0-9])", asset_name,
                     flags=re.IGNORECASE)
    return bool(match and match.group(1) == clip[:3])


def _receipt(db: Session, worker: ReviewWorker, kind: str, key: str, request_hash: str,
             svn_revision: int | None):
    if not 8 <= len(key) <= 120 or not re.fullmatch(r"[A-Za-z0-9:_-]+", key):
        raise HTTPException(status_code=400, detail="Invalid idempotency key")
    op_key = f"{kind}:{key}"
    existing = db.query(ReviewWorkerOperation).filter(
        ReviewWorkerOperation.worker_id == worker.id,
        ReviewWorkerOperation.operation_key == op_key,
    ).first()
    if existing:
        if existing.request_hash != request_hash:
            raise HTTPException(status_code=409, detail="Idempotency key reused with different request")
        return existing, True
    receipt = ReviewWorkerOperation(worker_id=worker.id, operation_key=op_key,
                                    operation=kind, request_hash=request_hash,
                                    svn_revision=svn_revision)
    db.add(receipt)
    try:
        db.flush()
    except Exception:
        db.rollback()
        raise HTTPException(status_code=409, detail="Review operation already in progress") from None
    return receipt, False


def _audit(worker: ReviewWorker, action: str, **fields):
    log.info("review_worker %s", json.dumps({"worker": worker.name, "action": action,
                                             **{k: str(v) for k, v in fields.items()}}, sort_keys=True))


@router.get("/assets")
def list_worker_assets(clip: str | None = None, db: Session = Depends(get_db), scope=Depends(worker_scope)):
    worker, _ = scope
    if clip is not None and not CLIP.fullmatch(clip):
        raise HTTPException(status_code=400, detail="Invalid clip ID")
    rows = db.query(Asset).filter(Asset.project_id == worker.project_id,
                                  Asset.folder_id == worker.folder_id,
                                  Asset.deleted_at.is_(None)).all()
    if clip:
        # Older portal assets use spaces in titles while SVN clip IDs use underscores.
        # Match whole clip tokens so 010_Idle_01 cannot select 010 Idle 011.
        pattern = r"(?<![A-Za-z0-9])" + r"[\W_]*".join(map(re.escape, clip.split("_"))) + r"(?![A-Za-z0-9])"
        exact = [a for a in rows if re.search(pattern, a.name, flags=re.IGNORECASE)]
        # Some capture folder IDs include a resolution suffix absent from an
        # existing review title (for example 122_DualChainWhips_480p).
        # A unique three-digit ID can recover that review; ambiguity remains
        # visible to the CLI, which refuses to upload without an explicit ID.
        rows = exact or [a for a in rows if _asset_has_clip_number(a.name, clip)]
    result = []
    for asset in rows:
        versions = db.query(AssetVersion).filter(AssetVersion.asset_id == asset.id,
                    AssetVersion.deleted_at.is_(None)).order_by(AssetVersion.version_number.desc()).all()
        result.append({"asset_id": asset.id, "name": asset.name, "project_id": asset.project_id,
                       "folder_id": asset.folder_id,
                       "versions": [{"version_id": v.id, "number": v.version_number,
                                     "status": v.processing_status.value} for v in versions]})
    _audit(worker, "list", clip=clip or "all")
    return result


@router.get("/assets/{asset_id}/comments")
def worker_comments(asset_id: uuid.UUID, version_id: uuid.UUID,
                    db: Session = Depends(get_db), scope=Depends(worker_scope)):
    worker, user = scope
    _asset(db, worker, asset_id)
    if _version(db, worker, version_id).asset_id != asset_id:
        _deny()
    result = comments.list_comments(asset_id, version_id=version_id, visibility="public",
                                    db=db, current_user=user)
    _audit(worker, "comments", asset=asset_id, version=version_id)
    return result


class WorkerUpload(BaseModel):
    clip: str
    candidate: str
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    svn_revision: int = Field(ge=1)
    idempotency_key: str
    original_filename: str
    file_size_bytes: int = Field(gt=0, le=MAX_MULTIPART_BYTES)
    asset_id: uuid.UUID | None = None


@router.post("/upload/initiate")
def worker_initiate(body: WorkerUpload, db: Session = Depends(get_db), scope=Depends(worker_scope)):
    worker, user = scope
    if not CLIP.fullmatch(body.clip) or not VERSION.fullmatch(body.candidate) or not body.original_filename.lower().endswith(".mp4"):
        raise HTTPException(status_code=400, detail="Invalid review candidate")
    filename_clip = re.match(r"^([0-9]{3})[_ -]", body.original_filename)
    if filename_clip and filename_clip.group(1) != body.clip[:3]:
        raise HTTPException(status_code=400, detail="Comparison filename has a different clip ID")
    if body.asset_id:
        existing = _asset(db, worker, body.asset_id)
        if not _asset_has_clip_number(existing.name, body.clip):
            raise HTTPException(status_code=409, detail="Review asset belongs to a different clip ID")
    digest = _hash(body.model_dump(mode="json", exclude={"idempotency_key", "asset_id"}))
    receipt, replay = _receipt(db, worker, "upload", body.idempotency_key, digest, body.svn_revision)
    if replay:
        if not receipt.version_id:
            raise HTTPException(status_code=409, detail="Review upload needs reconciliation")
        version = _upload_version(db, worker, receipt.version_id)
        media = db.query(MediaFile).filter(MediaFile.version_id == version.id).first()
        if not media:
            _deny()
        return {"project_id": worker.project_id, "asset_id": version.asset_id, "version_id": version.id,
                "upload_id": version.upload_id, "s3_key": media.s3_key_raw,
                "chunk_size_bytes": version.chunk_size_bytes, "status": version.processing_status.value,
                "replayed": True}
    if not body.asset_id:
        existing_assets = db.query(Asset).filter(Asset.project_id == worker.project_id,
            Asset.folder_id == worker.folder_id, Asset.deleted_at.is_(None)).all()
        if any(_asset_has_clip_number(asset.name, body.clip) for asset in existing_assets):
            db.rollback()
            raise HTTPException(status_code=409, detail="Existing clip asset requires asset_id")
    request = InitiateUploadRequest(project_id=worker.project_id, folder_id=worker.folder_id,
        asset_id=body.asset_id, asset_name=f"Redchain {body.clip}",
        original_filename=body.original_filename, mime_type="video/mp4",
        file_size_bytes=body.file_size_bytes)
    receipt.clip_id = body.clip
    receipt.candidate = body.candidate
    receipt.media_sha256 = body.sha256
    result = upload._initiate_upload(request, db, user, operation=receipt)
    _audit(worker, "upload_initiate", clip=body.clip, asset=result.asset_id,
           version=result.version_id, svn_revision=body.svn_revision)
    return {**result.model_dump(), "project_id": worker.project_id,
            "status": "uploading", "replayed": False}


@router.get("/upload/{version_id}/parts")
def worker_parts(version_id: uuid.UUID, db: Session = Depends(get_db), scope=Depends(worker_scope)):
    worker, user = scope
    _upload_version(db, worker, version_id)
    return upload.list_held_parts(version_id, db=db, current_user=user)


@router.post("/upload/{version_id}/presign-part")
def worker_presign(body: PresignPartRequest, version_id: uuid.UUID,
                   db: Session = Depends(get_db), scope=Depends(worker_scope)):
    worker, user = scope
    version = _upload_version(db, worker, version_id)
    media = db.query(MediaFile).filter(MediaFile.version_id == version.id,
                                       MediaFile.s3_key_raw == body.s3_key).first()
    if not media or version.upload_id != body.upload_id:
        _deny()
    return upload.presign_part(body, db=db, current_user=user)


@router.post("/upload/complete")
def worker_complete(body: CompleteUploadRequest, background_tasks: BackgroundTasks,
                    db: Session = Depends(get_db), scope=Depends(worker_scope)):
    worker, user = scope
    version = _upload_version(db, worker, body.version_id)
    if version.asset_id != body.asset_id or version.upload_id != body.upload_id:
        _deny()
    media = db.query(MediaFile).filter(MediaFile.version_id == version.id,
                                       MediaFile.s3_key_raw == body.s3_key).first()
    if not media:
        _deny()
    result = upload.complete_upload(body, background_tasks, db=db, current_user=user)
    _audit(worker, "upload_complete", asset=body.asset_id, version=body.version_id)
    return result


class WorkerReply(BaseModel):
    version_id: uuid.UUID
    corrected_version_id: uuid.UUID
    body: str = Field(min_length=1, max_length=5000)
    idempotency_key: str
    svn_revision: int = Field(ge=1)


class WorkerComment(BaseModel):
    version_id: uuid.UUID
    body: str = Field(min_length=1, max_length=5000)
    idempotency_key: str
    svn_revision: int = Field(ge=1)
    timecode_start: float | None = Field(default=None, ge=0)
    timecode_end: float | None = Field(default=None, ge=0)


@router.post("/assets/{asset_id}/comments")
def worker_create_comment(asset_id: uuid.UUID, body: WorkerComment,
                          db: Session = Depends(get_db), scope=Depends(worker_scope)):
    worker, user = scope
    _asset(db, worker, asset_id)
    version = _version(db, worker, body.version_id)
    if version.asset_id != asset_id or version.processing_status != ProcessingStatus.ready:
        _deny()
    if body.timecode_end is not None and (body.timecode_start is None or
                                           body.timecode_end < body.timecode_start):
        raise HTTPException(status_code=400, detail="Invalid comment timecode range")
    digest = _hash({"asset": str(asset_id), "version": str(version.id),
                    "body": body.body, "timecode_start": body.timecode_start,
                    "timecode_end": body.timecode_end, "svn_revision": body.svn_revision})
    receipt, replay = _receipt(db, worker, "comment", body.idempotency_key,
                               digest, body.svn_revision)
    if replay:
        if not receipt.comment_id:
            raise HTTPException(status_code=409, detail="Review comment needs reconciliation")
        return {"comment_id": receipt.comment_id, "replayed": True}
    result = comments._create_comment(asset_id,
        CommentCreate(version_id=version.id, body=body.body, visibility="public",
                      timecode_start=body.timecode_start, timecode_end=body.timecode_end),
        db, user, operation=receipt)
    _audit(worker, "comment", asset=asset_id, version=version.id, comment=result.id,
           svn_revision=body.svn_revision)
    return {"comment_id": result.id, "replayed": False}


@router.post("/assets/{asset_id}/comments/{comment_id}/replies")
def worker_reply(asset_id: uuid.UUID, comment_id: uuid.UUID, body: WorkerReply,
                 db: Session = Depends(get_db), scope=Depends(worker_scope)):
    worker, user = scope
    _asset(db, worker, asset_id)
    version = _version(db, worker, body.version_id)
    corrected = _version(db, worker, body.corrected_version_id)
    if corrected.asset_id != asset_id or corrected.id == version.id or corrected.processing_status != ProcessingStatus.ready:
        _deny()
    parent = db.query(Comment).filter(Comment.id == comment_id, Comment.asset_id == asset_id,
              Comment.version_id == version.id, Comment.deleted_at.is_(None),
              Comment.visibility == "public").first()
    if not parent or parent.visibility != "public" or version.asset_id != asset_id:
        _deny()
    digest = _hash({"asset": str(asset_id), "comment": str(comment_id),
                    "version": str(version.id), "corrected_version": str(corrected.id),
                    "body": body.body, "svn_revision": body.svn_revision})
    receipt, replay = _receipt(db, worker, "reply", body.idempotency_key, digest, body.svn_revision)
    if replay:
        if not receipt.comment_id:
            raise HTTPException(status_code=409, detail="Review reply needs reconciliation")
        return {"comment_id": receipt.comment_id, "replayed": True}
    result = comments._reply_to_comment(asset_id, comment_id,
        CommentCreate(version_id=version.id,
                      body=f"{body.body}\n\nAddressed in version {corrected.version_number} (SVN r{body.svn_revision}).",
                      visibility="public"),
        db, user, operation=receipt)
    _audit(worker, "reply", asset=asset_id, version=version.id, comment=result.id,
           parent=comment_id, svn_revision=body.svn_revision)
    return {"comment_id": result.id, "replayed": False}
