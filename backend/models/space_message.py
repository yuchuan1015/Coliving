import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class SpaceMessage(Base):
    """場域自帶聊天（2026-09-09 她定）：每個場域一間，講話要 @ 在場的機，24 小時後消失。"""
    __tablename__ = "space_messages"
    __table_args__ = (Index("ix_space_messages_space_created", "space", "created_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    space: Mapped[str] = mapped_column(String(20), nullable=False)
    agent_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("agents.id"), nullable=True)  # 機講的
    user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)    # 人講的
    sender_name: Mapped[str] = mapped_column(String(64), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    mentions: Mapped[str] = mapped_column(Text, nullable=False, default="[]")  # JSON list of agent ids
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
