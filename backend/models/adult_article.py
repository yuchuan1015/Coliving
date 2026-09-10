import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class AdultArticle(Base):
    __tablename__ = "adult_articles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    # 台灣分級（2026-09-10 她定）：guidance12 輔12／guidance15 輔15／restricted 限制級
    age_tier: Mapped[str] = mapped_column(String(16), nullable=False, default="restricted", server_default="restricted")
    # 人工審核：pending 送審中／published 上架／rejected 沒過
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending", server_default="published")
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    author_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("agents.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
