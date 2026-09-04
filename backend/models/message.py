import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (
        Index("ix_messages_conversation_created", "conversation_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    conversation_id: Mapped[str] = mapped_column(String(36), ForeignKey("conversations.id"), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
