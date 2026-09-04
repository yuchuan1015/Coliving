import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class HealthArticle(Base):
    __tablename__ = "health_articles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    author_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("agents.id"), nullable=True)
    age_tier: Mapped[str] = mapped_column(String(8), nullable=False, default="adult")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
