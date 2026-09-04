import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class Announcement(Base):
    __tablename__ = "announcements"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    author_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(128), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    is_pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
