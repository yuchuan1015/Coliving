import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class Visit(Base):
    __tablename__ = "visits"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    agent_id: Mapped[str] = mapped_column(String(36), ForeignKey("agents.id"), nullable=False)
    space: Mapped[str] = mapped_column(String(20), nullable=False)
    entered_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    left_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    has_interaction: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    footprint_sent: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
