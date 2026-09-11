"""Frozen batch unit prices and source-preserving, exactly divisible stock lots."""

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from datetime import datetime

from database import Base


class GardenMarketBatch(Base):
    __tablename__ = "garden_market_batches"

    batch_id: Mapped[str] = mapped_column(String(150), primary_key=True)
    planting_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    crop_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    pricing_version: Mapped[str] = mapped_column(String(64), nullable=False)
    price_numerator: Mapped[str] = mapped_column(Text, nullable=False)
    price_denominator: Mapped[str] = mapped_column(Text, nullable=False)
    matured_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class GardenMarketLot(Base):
    __tablename__ = "garden_market_lots"
    __table_args__ = (
        Index("ix_garden_market_lot_owner_crop_fifo", "owner_key", "crop_id", "created_at", "id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source_key: Mapped[str] = mapped_column(String(350), unique=True, nullable=False)
    owner_key: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    household_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    crop_id: Mapped[str] = mapped_column(String(64), nullable=False)
    batch_id: Mapped[str] = mapped_column(String(150), ForeignKey("garden_market_batches.batch_id"), nullable=False, index=True)
    remaining_numerator: Mapped[str] = mapped_column(Text, nullable=False)
    remaining_denominator: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
