"""Project and folder bound credentials for animation review workers."""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

try:
    from ..database import Base
except ImportError:
    from database import Base


class ReviewWorker(Base):
    __tablename__ = "review_workers"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    key_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    organization_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    # Keep identities after provider retention GC; each request re-resolves them
    # and fails closed if the project or folder no longer exists.
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    folder_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ReviewWorkerOperation(Base):
    __tablename__ = "review_worker_operations"
    __table_args__ = (UniqueConstraint("worker_id", "operation_key", name="uq_review_worker_operation"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    worker_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("review_workers.id"), nullable=False)
    operation_key: Mapped[str] = mapped_column(String(160), nullable=False)
    operation: Mapped[str] = mapped_column(String(40), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    clip_id: Mapped[str | None] = mapped_column(String(80))
    candidate: Mapped[str | None] = mapped_column(String(8))
    media_sha256: Mapped[str | None] = mapped_column(String(64))
    asset_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    version_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    comment_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    svn_revision: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
