#!/usr/bin/env python3
"""Explicit operator provisioning; never called from a browser or GET handler."""
import argparse
import json
import re
import sys
import uuid
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from apps.api.database import SessionLocal
from apps.api.models.user import User, UserStatus
from apps.api.models.project import Project, ProjectMember, ProjectRole

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--studio-actor', type=uuid.UUID, required=True)
parser.add_argument('--organization', type=uuid.UUID, required=True)
parser.add_argument('--project-key', required=True)
parser.add_argument('--project-id', type=uuid.UUID, required=True)
parser.add_argument('--name', required=True)
parser.add_argument('--create', action='store_true', help='Explicitly create the exact project if absent')
args = parser.parse_args()
if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,63}', args.project_key) or not args.name.strip() or len(args.name) > 255:
    parser.error('Invalid configured project key or name')
with SessionLocal() as db:
    user = db.query(User).filter(User.id == args.studio_actor, User.deleted_at.is_(None)).first()
    if not user or user.status != UserStatus.active or not (user.preferences or {}).get('studio_sso'):
        parser.error('Exact active Studio SSO actor must already exist; no email or name mapping is performed')
    project = db.query(Project).filter(Project.id == args.project_id).first()
    if project:
        member = db.query(ProjectMember).filter(ProjectMember.project_id == project.id, ProjectMember.user_id == user.id, ProjectMember.deleted_at.is_(None)).first()
        if project.deleted_at or not member or member.role != ProjectRole.owner:
            parser.error('Existing project must be live and have this exact actor as owner')
    else:
        if not args.create:
            parser.error('Project absent. Review the exact assignment and use --create to provision it')
        project = Project(id=args.project_id, name=args.name.strip(), created_by=user.id, is_public=False)
        db.add(project)
        db.flush()
        db.add(ProjectMember(project_id=project.id, user_id=user.id, role=ProjectRole.owner))
        db.commit()
print(json.dumps({'organizationId': str(args.organization), 'projectKey': args.project_key, 'freeframeProjectId': str(args.project_id)}))
