"""Dry-run or apply verified per-version production credits.

Run from the repository root after the production_credit migration. This never
changes created_by, comments, project membership, or user profiles. The manifest
must contain exact asset/version IDs; a mismatched record aborts the entire run.
"""
import argparse
import json
import re
import uuid
from pathlib import Path

from apps.api.database import SessionLocal
from apps.api.models.asset import Asset, AssetVersion, ProcessingStatus
from apps.api.models.review_worker import ReviewWorker
from apps.api.models.user import User


def require(condition, message):
    if not condition:
        raise ValueError(message)


def validate_manifest(data):
    require(data["worker"] == "elastic-5090", "unexpected worker")
    require(data["display_name"] == "Elastic 5090", "unexpected display name")
    require(data["expected_uploader_email"] == "vladimir.shumsky@gmail.com", "unexpected uploader")
    project_id = uuid.UUID(data["project_id"])
    folder_id = uuid.UUID(data["folder_id"])
    rows = data["versions"]
    require(bool(rows), "empty backfill")
    clips = [row["clip"] for row in rows]
    assets = [uuid.UUID(row["asset_id"]) for row in rows]
    versions = [uuid.UUID(row["version_id"]) for row in rows]
    require(len(clips) == len(set(clips)), "duplicate clip")
    require(len(assets) == len(set(assets)), "duplicate asset")
    require(len(versions) == len(set(versions)), "duplicate version")
    require(all(re.fullmatch(r"[0-9]{3}", clip) for clip in clips), "invalid clip")
    return project_id, folder_id


def backfill(data, apply=False, expected_count=None, session_factory=SessionLocal):
    project_id, folder_id = validate_manifest(data)
    rows = data["versions"]
    if apply and expected_count != len(rows):
        raise ValueError(f"--expected-count must be {len(rows)}")
    db = session_factory()
    try:
        worker = db.query(ReviewWorker).filter(ReviewWorker.name == data["worker"]).first()
        require(worker is not None, "worker missing")
        require(worker.project_id == project_id and worker.folder_id == folder_id, "worker scope changed")
        actor = db.query(User).filter(User.id == worker.user_id).first()
        require(actor is not None and actor.name == data["display_name"], "worker actor changed")
        checked = []
        for item in rows:
            asset_id = uuid.UUID(item["asset_id"])
            version_id = uuid.UUID(item["version_id"])
            asset = db.query(Asset).filter(Asset.id == asset_id).first()
            version = db.query(AssetVersion).filter(AssetVersion.id == version_id).first()
            require(asset is not None and version is not None, f"missing {item['clip']}")
            require(asset.project_id == project_id and asset.folder_id == folder_id, f"wrong folder {item['clip']}")
            require(asset.deleted_at is None and version.deleted_at is None, f"deleted {item['clip']}")
            require(version.asset_id == asset.id and version.version_number == 1, f"wrong version {item['clip']}")
            require(version.processing_status == ProcessingStatus.ready, f"not ready {item['clip']}")
            require(bool(re.match(rf"^{item['clip']}(?![0-9])", asset.name)), f"wrong title {item['clip']}")
            require("Keyfit" in asset.name, f"not a legacy keyfit {item['clip']}")
            uploader = db.query(User).filter(User.id == version.created_by).first()
            require(uploader is not None and uploader.email.lower() == data["expected_uploader_email"], f"uploader mismatch {item['clip']}")
            require(version.production_credit in (None, data["display_name"]), f"conflicting credit {item['clip']}")
            checked.append((item["clip"], version))
        changed = sum(version.production_credit is None for _, version in checked)
        if apply:
            for _, version in checked:
                version.production_credit = data["display_name"]
            db.commit()
        else:
            db.rollback()
        return {"checked": len(checked), "changed": changed if apply else 0,
                "would_change": changed, "applied": apply,
                "clips": [clip for clip, _ in checked]}
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--apply", action="store_true", help="write after all records pass validation")
    parser.add_argument("--expected-count", type=int, help="required when applying")
    args = parser.parse_args()
    data = json.loads(args.manifest.read_text(encoding="utf-8"))
    print(json.dumps(backfill(data, args.apply, args.expected_count), indent=2))


if __name__ == "__main__":
    main()
