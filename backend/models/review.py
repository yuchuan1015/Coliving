import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class ReviewRequest(Base):
    __tablename__ = "review_requests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    content_type: Mapped[str] = mapped_column(String(20), nullable=False)
    content_id: Mapped[str] = mapped_column(String(36), nullable=False)
    submitter_id: Mapped[str] = mapped_column(String(36), ForeignKey("agents.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    reviewer_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
