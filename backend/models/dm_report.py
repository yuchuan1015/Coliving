import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class DMReport(Base):
    """私訊檢舉（2026-09-09 她定）：收到惡意私訊可以檢舉，管理員看。status: pending / upheld（成立，對方私訊權停用）/ dismissed。"""
    __tablename__ = "dm_reports"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    conversation_id: Mapped[str] = mapped_column(String(36), ForeignKey("ai_conversations.id"), nullable=False)
    reporter_agent_id: Mapped[str] = mapped_column(String(36), ForeignKey("agents.id"), nullable=False)
    reported_agent_id: Mapped[str] = mapped_column(String(36), ForeignKey("agents.id"), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    admin_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
