"""Reserved pet requests and immutable, actor-scoped operation receipts."""
from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


def utcnow():
    return datetime.now(timezone.utc)


class PetWish(Base):
    __tablename__ = "pet_wishes"
    __table_args__ = (
        CheckConstraint("status IN ('pending','preparing','arrived')", name="ck_pet_wish_status"),
        CheckConstraint("version >= 1", name="ck_pet_wish_version"),
        CheckConstraint("(status = 'arrived' AND pet_id IS NOT NULL AND arrived_at IS NOT NULL "
                        "AND arrival_receipt_id IS NOT NULL) OR "
                        "(status IN ('pending','preparing') AND pet_id IS NULL AND arrived_at IS NULL "
                        "AND arrival_receipt_id IS NULL)", name="ck_pet_wish_fulfillment"),
        Index("ix_pet_wish_owner_created", "user_id", "created_at", "id"),
        Index("ix_pet_wish_agent_reservation", "agent_id", "status", "pet_id"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    agent_id: Mapped[str] = mapped_column(String(36), ForeignKey("agents.id"), nullable=False)
    requested_name: Mapped[str] = mapped_column(String(64), nullable=False)
    requested_species: Mapped[str] = mapped_column(String(64), nullable=False)
    appearance_description: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    asset_key: Mapped[str | None] = mapped_column(String(128))
    preparation_note: Mapped[str] = mapped_column(Text, nullable=False, default="")
    pet_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("pets.id"), unique=True)
    arrived_at: Mapped[datetime | None] = mapped_column(DateTime)
    # Resolve after the wish exists, avoiding a cyclic schema dependency.
    arrival_receipt_id: Mapped[str | None] = mapped_column(String(36))
    arrival_request_hash: Mapped[str | None] = mapped_column(String(64))


class PetWishReceipt(Base):
    __tablename__ = "pet_wish_receipts"
    __table_args__ = (
        UniqueConstraint("actor_user_id", "operation", "client_request_id", name="uq_pet_wish_receipt_key"),
        CheckConstraint("operation IN ('create','arrive')", name="ck_pet_wish_receipt_operation"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    actor_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    operation: Mapped[str] = mapped_column(String(16), nullable=False)
    client_request_id: Mapped[str] = mapped_column(String(128), nullable=False)
    wish_id: Mapped[str] = mapped_column(String(36), ForeignKey("pet_wishes.id"), nullable=False, index=True)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    response_json: Mapped[str] = mapped_column(Text, nullable=False)
    accepted_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
