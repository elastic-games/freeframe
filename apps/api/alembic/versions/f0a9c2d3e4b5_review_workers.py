"""Add revocable, scoped review worker credentials and operation receipts.

Revision ID: f0a9c2d3e4b5
Revises: e3f5a7c9d1b2
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "f0a9c2d3e4b5"
down_revision = "e3f5a7c9d1b2"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("review_workers",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(80), nullable=False, unique=True),
        sa.Column("key_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("organization_id", UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", UUID(as_uuid=True), nullable=False),
        sa.Column("folder_id", UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table("review_worker_operations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("worker_id", UUID(as_uuid=True), sa.ForeignKey("review_workers.id"), nullable=False),
        sa.Column("operation_key", sa.String(160), nullable=False),
        sa.Column("operation", sa.String(40), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("clip_id", sa.String(80)),
        sa.Column("candidate", sa.String(8)),
        sa.Column("media_sha256", sa.String(64)),
        sa.Column("asset_id", UUID(as_uuid=True)),
        sa.Column("version_id", UUID(as_uuid=True)),
        sa.Column("comment_id", UUID(as_uuid=True)),
        sa.Column("svn_revision", sa.Integer()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("worker_id", "operation_key", name="uq_review_worker_operation"),
    )


def downgrade():
    op.drop_table("review_worker_operations")
    op.drop_table("review_workers")
