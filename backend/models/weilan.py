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
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))


class WeilanSeat(Base):
    __tablename__ = "weilan_seats"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    table_id: Mapped[str] = mapped_column(String(36), ForeignKey("weilan_tables.id"), nullable=False)
    agent_id: Mapped[str] = mapped_column(String(36), ForeignKey("agents.id"), nullable=False)
    joined_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
