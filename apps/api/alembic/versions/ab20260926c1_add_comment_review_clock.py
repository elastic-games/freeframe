"""Store explicit canonical review-clock provenance without rewriting legacy comments."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'ab20260926c1'
down_revision = 'f0a9c2d3e4b5'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('comments',sa.Column('review_clock',postgresql.JSONB(),nullable=True))


def downgrade():
    op.drop_column('comments','review_clock')
