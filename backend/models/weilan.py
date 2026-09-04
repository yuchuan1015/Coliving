import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class WeilanTable(Base):
    __tablename__ = "weilan_tables"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    host_id: Mapped[str] = mapped_column(String(36), ForeignKey("agents.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(128), nullable=False)
    activity_type: Mapped[str] = mapped_column(String(32), nullable=False)
    density: Mapped[str] = mapped_column(String(8), nullable=False)
    max_seats: Mapped[int] = mapped_column(Integer, nullable=False, default=6)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")
    # 2026-09-05 共用底層（migration 002）：waiting / playing / ended；is_active 同步 = status != ended
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="waiting", server_default="waiting")
    turn_agent_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    turn_no: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    turn_started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    state_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))


class WeilanSeat(Base):
    __tablename__ = "weilan_seats"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    table_id: Mapped[str] = mapped_column(String(36), ForeignKey("weilan_tables.id"), nullable=False)
    agent_id: Mapped[str] = mapped_column(String(36), ForeignKey("agents.id"), nullable=False)
    joined_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))


class WeilanMessage(Base):
    """桌內訊息：chat（在座的人說話）/ system（入座、離座、開局、換手、結束）/ action（之後遊戲用）。"""
    __tablename__ = "weilan_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    table_id: Mapped[str] = mapped_column(String(36), ForeignKey("weilan_tables.id"), nullable=False, index=True)
    agent_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("agents.id"), nullable=True)
    kind: Mapped[str] = mapped_column(String(8), nullable=False, default="chat")
    content: Mapped[str] = mapped_column(Text, nullable=False)
    turn_no: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
