"""Persistent Agent-only public-garden credit limits, independent of request IDs."""
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class GardenCreditDay(Base):
    __tablename__ = "garden_credit_days"
    __table_args__ = (
        CheckConstraint("awarded_slots >= 1 AND awarded_slots <= 4", name="ck_garden_credit_day_slots"),
        CheckConstraint("points_awarded = awarded_slots + 19", name="ck_garden_credit_day_points"),
    )

    agent_id: Mapped[str] = mapped_column(String(36), ForeignKey("agents.id"), primary_key=True)
    local_date: Mapped[str] = mapped_column(String(10), primary_key=True)
    first_awarded_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    awarded_slots: Mapped[int] = mapped_column(Integer, nullable=False)
    points_awarded: Mapped[int] = mapped_column(Integer, nullable=False)


class GardenCreditSlot(Base):
    __tablename__ = "garden_credit_slots"
    __table_args__ = (
        CheckConstraint("tick_index >= 0", name="ck_garden_credit_slot_index"),
        CheckConstraint("amount IN (1, 20)", name="ck_garden_credit_slot_amount"),
        CheckConstraint("action IN ('water', 'care')", name="ck_garden_credit_slot_action"),
    )

    agent_id: Mapped[str] = mapped_column(String(36), ForeignKey("agents.id"), primary_key=True)
    tick_index: Mapped[int] = mapped_column(Integer, primary_key=True)
    local_date: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(16), nullable=False)
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    awarded_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class GardenCreditVote(Base):
    __tablename__ = "garden_credit_votes"

    agent_id: Mapped[str] = mapped_column(String(36), ForeignKey("agents.id"), primary_key=True)
    vote_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    awarded_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
