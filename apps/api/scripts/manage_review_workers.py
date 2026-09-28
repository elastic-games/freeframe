"""Issue, rotate, or revoke one Redchain review-worker key.

Run from the repository root with the API runtime environment configured. Each
node generates its own key locally and reports only its SHA-256 digest for issue
or rotation. The server never handles the raw key.
"""
import argparse
import re
import uuid
from datetime import datetime, timezone

from apps.api.database import SessionLocal
from apps.api.models.folder import Folder
from apps.api.models.project import Project, ProjectMember, ProjectRole
from apps.api.models.review_worker import ReviewWorker
from apps.api.models.user import User, UserStatus

NODES = ("local-mac", "elastic-5090", "elastic-minim4", "elastic-razer-3080", "elastic-2070")
NODE_DISPLAY_NAMES = {
    "local-mac": "Local Mac",
    "elastic-5090": "Elastic 5090",
    "elastic-minim4": "Elastic MiniM4",
    "elastic-razer-3080": "Elastic Razer 3080",
    "elastic-2070": "Elastic 2070",
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("issue", "rotate", "revoke", "list"))
    parser.add_argument("--node", choices=NODES)
    parser.add_argument("--project-id", type=uuid.UUID)
    parser.add_argument("--organization-id", type=uuid.UUID)
    parser.add_argument("--folder-id", type=uuid.UUID)
    parser.add_argument("--key-hash")
    args = parser.parse_args()
    if args.action != "list" and not args.node:
        parser.error("--node is required")
    if args.action == "issue" and (not args.organization_id or not args.project_id or not args.folder_id):
        parser.error("issue requires --organization-id, --project-id and --folder-id from the canonical Studio binding")
    if args.action in ("issue", "rotate") and not (args.key_hash and re.fullmatch(r"[0-9a-f]{64}", args.key_hash)):
        parser.error("--key-hash must be the SHA-256 digest generated on that node")
    db = SessionLocal()
    try:
        if args.action == "list":
            for row in db.query(ReviewWorker).order_by(ReviewWorker.name).all():
                print(row.name, row.id, "revoked" if row.revoked_at else "active",
                      row.project_id, row.folder_id, row.user_id)
            return
        worker = db.query(ReviewWorker).filter(ReviewWorker.name == args.node).first()
        if args.action == "issue":
            if worker:
                parser.error("node already exists; use rotate")
            project = db.query(Project).filter(Project.id == args.project_id,
                           Project.deleted_at.is_(None)).first()
            folder = db.query(Folder).filter(Folder.id == args.folder_id,
                          Folder.project_id == args.project_id,
                          Folder.deleted_at.is_(None)).first()
            if not project or not folder or project.name != "Giant & Ghosts" or folder.name != "Redchain":
                parser.error("binding must resolve to the live Giant & Ghosts / Redchain folder")
            email = f"{args.node}@review-workers.invalid"
            if db.query(User).filter(User.email == email).first():
                parser.error("worker actor already exists; inspect before retrying")
            actor = User(email=email, name=NODE_DISPLAY_NAMES[args.node],
                         password_hash=None, status=UserStatus.active,
                         email_verified=False, preferences={"review_worker": True})
            db.add(actor)
            db.flush()
            db.add(ProjectMember(project_id=project.id, user_id=actor.id,
                                 role=ProjectRole.editor, invited_by=project.created_by))
            worker = ReviewWorker(name=args.node, project_id=project.id,
                                  organization_id=args.organization_id,
                                  folder_id=folder.id, user_id=actor.id)
            db.add(worker)
        elif not worker:
            parser.error("worker not found")
        elif args.action == "revoke":
            worker.revoked_at = datetime.now(timezone.utc)
            db.commit()
            print(args.node, "revoked")
            return
        elif worker.revoked_at:
            parser.error("worker is revoked; inspect before reissuing")
        worker.key_hash = args.key_hash
        db.commit()
        print(args.node, worker.id, args.action, "credential hash enrolled")
    finally:
        db.close()


if __name__ == "__main__":
    main()
