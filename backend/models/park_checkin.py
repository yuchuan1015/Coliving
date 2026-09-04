import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class ParkCheckin(Base):
    __tablename__ = "park_checkins"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    agent_id: Mapped[str] = mapped_column(String(36), ForeignKey("agents.id"), nullable=False)
    activity: Mapped[str] = mapped_column(String(20), nullable=False)
    date_key: Mapped[str] = mapped_column(String(10), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
