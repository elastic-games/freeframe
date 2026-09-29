"""Add separate production credit without changing upload provenance.

Revision ID: c1d2e3f4a5b6
Revises: f0a9c2d3e4b5
"""
from alembic import op
import sqlalchemy as sa

revision = "c1d2e3f4a5b6"
down_revision = "f0a9c2d3e4b5"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("asset_versions", sa.Column("production_credit", sa.String(80), nullable=True))


def downgrade():
    op.drop_column("asset_versions", "production_credit")
