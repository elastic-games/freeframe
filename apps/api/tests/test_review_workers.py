"""Security boundaries specific to the worker-only review API."""
import hashlib
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from apps.api.routers import review_workers as rw
from apps.api.models.asset import ProcessingStatus
from apps.api.models.asset import Asset, AssetType, AssetVersion
from apps.api.models.comment import Comment
from apps.api.models.folder import Folder
from apps.api.models.project import Project, ProjectMember
from apps.api.models.review_worker import ReviewWorker
from apps.api.models.user import User


def _worker():
    return SimpleNamespace(id=uuid.uuid4(), name="elastic-5090",
                           organization_id=uuid.uuid4(), project_id=uuid.uuid4(), folder_id=uuid.uuid4(),
                           user_id=uuid.uuid4())


def test_missing_and_revoked_keys_cannot_authenticate(mock_db):
    with pytest.raises(HTTPException) as absent:
        rw.worker_scope(None, mock_db)
    assert absent.value.status_code == 401
    key = "rw_" + "a" * 43
    mock_db.first.return_value = None
    with pytest.raises(HTTPException) as revoked:
        rw.worker_scope(key, mock_db)
    assert revoked.value.status_code == 401
    assert hashlib.sha256(key.encode()).hexdigest() not in str(revoked.value.detail)


def test_binding_revocation_denies_an_otherwise_valid_worker(mock_db):
    worker = _worker()
    actor = SimpleNamespace(id=worker.user_id, status=rw.UserStatus.active)
    folder = SimpleNamespace(id=worker.folder_id, project_id=worker.project_id)
    member = SimpleNamespace(role=rw.ProjectRole.editor)
    mock_db.first.side_effect = [worker, SimpleNamespace(id=worker.project_id), folder, actor]
    with patch.object(rw, "get_project_member", return_value=member), \
         patch.object(rw, "require_studio_binding", side_effect=HTTPException(403, "revoked")):
        with pytest.raises(HTTPException) as denied:
            rw.worker_scope("rw_" + "a" * 43, mock_db)
    assert denied.value.status_code == 403


def test_asset_cannot_escape_bound_folder_even_if_query_returns_a_row(mock_db):
    worker = _worker()
    foreign = SimpleNamespace(id=uuid.uuid4(), project_id=worker.project_id,
                              folder_id=uuid.uuid4())
    mock_db.first.return_value = foreign
    with pytest.raises(HTTPException) as denied:
        rw._asset(mock_db, worker, foreign.id)
    assert denied.value.status_code == 404


def test_foreign_asset_upload_stops_before_initiation(mock_db):
    worker = _worker()
    body = rw.WorkerUpload(clip="010_Idle_01", candidate="v02", sha256="a" * 64,
                           svn_revision=78, idempotency_key="stable-key-1234",
                           original_filename="comparison.mp4", file_size_bytes=123,
                           asset_id=uuid.uuid4())
    with patch.object(rw, "_asset", side_effect=HTTPException(404, "unavailable")), \
         patch.object(rw.upload, "_initiate_upload") as initiate:
        with pytest.raises(HTTPException) as denied:
            rw.worker_initiate(body, mock_db, (worker, SimpleNamespace(id=worker.user_id)))
    assert denied.value.status_code == 404
    initiate.assert_not_called()


def test_reply_cannot_attach_to_internal_comment(mock_db):
    worker = _worker()
    asset_id, version_id, comment_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    corrected_id = uuid.uuid4()
    body = rw.WorkerReply(version_id=version_id, corrected_version_id=corrected_id,
                          body="Fixed in v03", idempotency_key="reply-12345678",
                          svn_revision=89)
    version = SimpleNamespace(id=version_id, asset_id=asset_id)
    corrected = SimpleNamespace(id=corrected_id, asset_id=asset_id,
                                processing_status=ProcessingStatus.ready)
    parent = SimpleNamespace(id=comment_id, asset_id=asset_id, version_id=version_id,
                             visibility="internal")
    mock_db.first.return_value = parent
    with patch.object(rw, "_asset"), patch.object(rw, "_version", side_effect=[version, corrected]), \
         patch.object(rw.comments, "_reply_to_comment") as reply:
        with pytest.raises(HTTPException) as denied:
            rw.worker_reply(asset_id, comment_id, body, mock_db,
                            (worker, SimpleNamespace(id=worker.user_id)))
    assert denied.value.status_code == 404
    reply.assert_not_called()


def test_reused_key_with_different_request_is_refused(mock_db):
    worker = _worker()
    old = SimpleNamespace(request_hash="a" * 64)
    mock_db.first.return_value = old
    with pytest.raises(HTTPException) as denied:
        rw._receipt(mock_db, worker, "upload", "stable-key-1234", "b" * 64, 78)
    assert denied.value.status_code == 409


def test_public_surface_has_no_approval_or_delete_method():
    paths = {route.path: route.methods for route in rw.router.routes}
    assert paths
    assert not any("approve" in path or "share" in path or "delete" in path for path in paths)
    assert all("DELETE" not in methods and "PATCH" not in methods for methods in paths.values())


def test_http_worker_route_refuses_missing_key(client):
    response = client.get("/review-workers/assets")
    assert response.status_code == 401


def test_disposable_db_asset_comment_reply_and_upload_receipt(client, real_db, monkeypatch):
    from apps.api.database import get_db
    actor = User(email=f"worker-{uuid.uuid4()}@example.invalid", name="Node 5090",
                 password_hash=None, status=rw.UserStatus.active, preferences={})
    real_db.add(actor); real_db.flush()
    project = Project(name="Giant & Ghosts", created_by=actor.id)
    real_db.add(project); real_db.flush()
    folder = Folder(project_id=project.id, name="Redchain", created_by=actor.id)
    real_db.add(folder); real_db.flush()
    real_db.add(ProjectMember(project_id=project.id, user_id=actor.id, role=rw.ProjectRole.editor))
    key = "rw_" + "a" * 43
    real_db.add(ReviewWorker(name="elastic-5090", key_hash=hashlib.sha256(key.encode()).hexdigest(),
                             organization_id=uuid.uuid4(), project_id=project.id,
                             folder_id=folder.id, user_id=actor.id))
    asset = Asset(project_id=project.id, folder_id=folder.id, name="010 Idle 01 - MoCapAnything Keyfit v01",
                  asset_type=AssetType.video, created_by=actor.id)
    real_db.add(asset); real_db.flush()
    old = AssetVersion(asset_id=asset.id, version_number=1,
                       processing_status=ProcessingStatus.ready, created_by=actor.id)
    fixed = AssetVersion(asset_id=asset.id, version_number=2,
                         processing_status=ProcessingStatus.ready, created_by=actor.id)
    real_db.add_all([old, fixed]); real_db.flush()
    parent = Comment(asset_id=asset.id, version_id=old.id, author_id=actor.id,
                     body="Fix hoof slide", visibility="public")
    real_db.add(parent); real_db.flush()
    client.app.dependency_overrides[get_db] = lambda: real_db
    monkeypatch.setattr(rw, "require_studio_binding", lambda _org, _project: None)
    monkeypatch.setattr(rw.comments.event_service, "publish_sync", lambda *_a, **_k: None)
    headers = {"X-Review-Key": key}

    listing = client.get("/review-workers/assets?clip=010_Idle_01", headers=headers)
    assert listing.status_code == 200 and listing.json()[0]["asset_id"] == str(asset.id)
    legacy_suffix = client.get("/review-workers/assets?clip=010_Idle_01_480p", headers=headers)
    assert legacy_suffix.status_code == 200 and legacy_suffix.json()[0]["asset_id"] == str(asset.id)
    comments = client.get(f"/review-workers/assets/{asset.id}/comments?version_id={old.id}", headers=headers)
    assert comments.status_code == 200 and comments.json()[0]["body"] == "Fix hoof slide"
    reply_body = {"version_id": str(old.id), "corrected_version_id": str(fixed.id),
                  "body": "Hoof contact corrected at 00:02:04.",
                  "idempotency_key": "reply-010-v2-hoof", "svn_revision": 89}
    replied = client.post(f"/review-workers/assets/{asset.id}/comments/{parent.id}/replies",
                          headers=headers, json=reply_body)
    assert replied.status_code == 200, replied.text
    replay = client.post(f"/review-workers/assets/{asset.id}/comments/{parent.id}/replies",
                         headers=headers, json=reply_body)
    assert replay.status_code == 200 and replay.json()["comment_id"] == replied.json()["comment_id"]

    monkeypatch.setattr(rw.upload, "create_multipart_upload", lambda *_a, **_k: "upload-test")
    monkeypatch.setattr(rw.upload, "upload_guard_error", lambda *_a, **_k: None)
    upload_body = {"clip": "011_Walk_01", "candidate": "v02", "sha256": "b" * 64,
                   "svn_revision": 90, "idempotency_key": "upload-011-v2-unique",
                   "original_filename": "comparison.mp4", "file_size_bytes": 10_000}
    started = client.post("/review-workers/upload/initiate", headers=headers, json=upload_body)
    assert started.status_code == 200, started.text
    repeated = client.post("/review-workers/upload/initiate", headers=headers, json=upload_body)
    assert repeated.status_code == 200 and repeated.json()["version_id"] == started.json()["version_id"]
    assert repeated.json()["replayed"] is True
