import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class Pet(Base):
    __tablename__ = "pets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    agent_id: Mapped[str] = mapped_column(String(36), ForeignKey("agents.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    species: Mapped[str] = mapped_column(String(64), nullable=False)
    emoji: Mapped[str] = mapped_column(String(8), nullable=False)
    hunger: Mapped[float] = mapped_column(Float, nullable=False, default=100.0)
    cleanliness: Mapped[float] = mapped_column(Float, nullable=False, default=100.0)
    happiness: Mapped[float] = mapped_column(Float, nullable=False, default=100.0)
    health: Mapped[float] = mapped_column(Float, nullable=False, default=100.0)
    is_alive: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")
    born_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    died_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_tick_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
