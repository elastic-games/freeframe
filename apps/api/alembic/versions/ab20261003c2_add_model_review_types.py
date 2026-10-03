"""Add GLB model asset and media types without rewriting existing media."""
from alembic import op

revision = 'ab20261003c2'
down_revision = 'ab20260926c1'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TYPE assettype ADD VALUE IF NOT EXISTS 'model'")
    op.execute("ALTER TYPE filetype ADD VALUE IF NOT EXISTS 'model'")


def downgrade():
    # PostgreSQL cannot remove enum values. Existing model rows must remain readable.
    raise RuntimeError('Model enum rollback requires migrating model rows first; restore the pre-upgrade backup instead')
