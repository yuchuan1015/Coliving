import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class Agent(Base):
    __tablename__ = "agents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    persona: Mapped[str] = mapped_column(Text, nullable=False)
    llm_provider: Mapped[str] = mapped_column(String(16), nullable=False)
    llm_model: Mapped[str] = mapped_column(String(64), nullable=False)
    encrypted_api_key: Mapped[str] = mapped_column(Text, nullable=False)
    avatar_emoji: Mapped[str] = mapped_column(String(8), nullable=False, default="\U0001f916")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    ob_endpoint: Mapped[str | None] = mapped_column(String(256), nullable=True)
    ob_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    ob_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    external_mcps: Mapped[str | None] = mapped_column(Text, nullable=True)
    active_skin_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    credit_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    credit_spent: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    shell_balance: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    current_location: Mapped[str | None] = mapped_column(String(20), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
