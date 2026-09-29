import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from apps.api.models.asset import AssetVersion, ProcessingStatus
from apps.api.routers import upload
from apps.api.schemas.asset import AssetVersionResponse
from apps.api.schemas.upload import InitiateUploadRequest
from apps.api.scripts.backfill_production_credits import backfill, validate_manifest


def _fixture():
    project_id, folder_id, asset_id, version_id, uploader_id, worker_id = [uuid.uuid4() for _ in range(6)]
    manifest = {
        "project_id": str(project_id), "folder_id": str(folder_id),
        "worker": "elastic-5090", "display_name": "Elastic 5090",
        "expected_uploader_email": "vladimir.shumsky@gmail.com",
        "versions": [{"clip": "020", "asset_id": str(asset_id), "version_id": str(version_id)}],
    }
    worker = SimpleNamespace(project_id=project_id, folder_id=folder_id, user_id=worker_id)
    actor = SimpleNamespace(name="Elastic 5090")
    asset = SimpleNamespace(id=asset_id, project_id=project_id, folder_id=folder_id,
                            name="020_Move_01 Keyfit v01", deleted_at=None)
    version = SimpleNamespace(id=version_id, asset_id=asset_id, version_number=1,
                              processing_status=ProcessingStatus.ready, deleted_at=None,
                              created_by=uploader_id, production_credit=None)
    uploader = SimpleNamespace(email="vladimir.shumsky@gmail.com")
    return manifest, worker, actor, asset, version, uploader


def _session(*rows):
    db = MagicMock()
    db.query.return_value.filter.return_value.first.side_effect = rows
    return db


def test_backfill_keeps_original_uploader_and_requires_exact_expected_count():
    manifest, worker, actor, asset, version, uploader = _fixture()
    original_uploader_id = version.created_by
    db = _session(worker, actor, asset, version, uploader)
    with pytest.raises(ValueError, match="expected-count"):
        backfill(manifest, apply=True, expected_count=2, session_factory=lambda: db)
    assert db.commit.call_count == 0

    db = _session(worker, actor, asset, version, uploader)
    result = backfill(manifest, apply=True, expected_count=1, session_factory=lambda: db)
    assert result["changed"] == 1
    assert version.production_credit == "Elastic 5090"
    assert version.created_by == original_uploader_id
    db.commit.assert_called_once()


def test_backfill_aborts_without_a_partial_write_on_scope_mismatch():
    manifest, worker, actor, asset, version, uploader = _fixture()
    asset.folder_id = uuid.uuid4()
    db = _session(worker, actor, asset, version, uploader)
    with pytest.raises(ValueError, match="wrong folder"):
        backfill(manifest, apply=True, expected_count=1, session_factory=lambda: db)
    db.rollback.assert_called_once()
    db.commit.assert_not_called()
    assert version.production_credit is None


def test_manifest_rejects_duplicate_version_ids():
    manifest, *_ = _fixture()
    manifest["versions"].append({**manifest["versions"][0], "clip": "021"})
    with pytest.raises(ValueError, match="duplicate asset"):
        validate_manifest(manifest)


def test_version_response_exposes_credit_separately_from_created_by():
    _, _, _, _, version, _ = _fixture()
    version.production_credit = "Elastic 5090"
    version.created_at = datetime.now(timezone.utc)
    response = AssetVersionResponse.model_validate(version, from_attributes=True)
    assert response.production_credit == "Elastic 5090"
    assert response.created_by == version.created_by


def test_worker_upload_stores_node_credit_but_browser_upload_does_not():
    def initiate(operation):
        db = MagicMock()
        db.query.return_value.filter.return_value.first.side_effect = [object(), object()]
        db.add.side_effect = lambda obj: setattr(obj, "id", uuid.uuid4()) if not getattr(obj, "id", None) else None
        body = InitiateUploadRequest(
            project_id=uuid.uuid4(), folder_id=uuid.uuid4(),
            asset_name="020 Keyfit", original_filename="020.mp4",
            mime_type="video/mp4", file_size_bytes=100,
        )
        actor = SimpleNamespace(id=uuid.uuid4(), name="Elastic 5090")
        with patch.object(upload, "upload_guard_error", return_value=None), \
             patch.object(upload, "require_project_role"), \
             patch.object(upload, "next_version_number", return_value=1), \
             patch.object(upload, "create_multipart_upload", return_value="upload-id"):
            upload._initiate_upload(body, db, actor, operation=operation)
        return next(call.args[0] for call in db.add.call_args_list
                    if isinstance(call.args[0], AssetVersion))

    assert initiate(SimpleNamespace()).production_credit == "Elastic 5090"
    assert initiate(None).production_credit is None
