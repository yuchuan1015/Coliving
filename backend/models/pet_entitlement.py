"""Explicit first-pet exceptions, bound to a stable Agent ID, never a name."""
from datetime import datetime, timezone

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class PetEntitlement(Base):
    __tablename__ = "pet_entitlements"
    __table_args__ = (CheckConstraint("minimum_slots = 1", name="ck_first_pet_exception_only"),)
    agent_id: Mapped[str] = mapped_column(String(36), ForeignKey("agents.id"), primary_key=True)
    minimum_slots: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    granted_at: Mapped[datetime] = mapped_column(DateTime, nullable=False,
        default=lambda: datetime.now(timezone.utc))
