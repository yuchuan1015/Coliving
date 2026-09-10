"""Garden aggregates and exact stock accounting; all changes share one DB transaction."""
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


def utcnow():
    return datetime.now(timezone.utc)


class GardenWorld(Base):
    __tablename__ = "garden_world"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    epoch_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    seed: Mapped[str] = mapped_column(String(64), nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    public_productive_area_m2: Mapped[int] = mapped_column(Integer, default=480, nullable=False)


class GardenPlot(Base):
    __tablename__ = "garden_plots"
    __table_args__ = (UniqueConstraint("scope", "household_id", "number", name="uq_garden_household_plot"),)
    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    scope: Mapped[str] = mapped_column(String(16), nullable=False)
    household_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    state_json: Mapped[str | None] = mapped_column(Text)
    vote_json: Mapped[str | None] = mapped_column(Text)
    contributors_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    distribution_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    history_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    revision: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class GardenOperation(Base):
    __tablename__ = "garden_operations"
    actor_key: Mapped[str] = mapped_column(String(80), primary_key=True)
    request_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    response_json: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class GardenStock(Base):
    __tablename__ = "garden_stock"
    owner_key: Mapped[str] = mapped_column(String(80), primary_key=True)
    crop_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    household_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True, nullable=False)
    quantity_numerator: Mapped[str] = mapped_column(Text, default="0", nullable=False)
    quantity_denominator: Mapped[str] = mapped_column(Text, default="1", nullable=False)


class GardenLedger(Base):
    __tablename__ = "garden_ledger"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source_key: Mapped[str] = mapped_column(String(350), unique=True, nullable=False)
    owner_key: Mapped[str | None] = mapped_column(String(80), index=True)
    household_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    crop_id: Mapped[str] = mapped_column(String(64), nullable=False)
    planting_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    batch_id: Mapped[str | None] = mapped_column(String(150))
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    quantity_numerator: Mapped[str] = mapped_column(Text, nullable=False)
    quantity_denominator: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class GardenProgress(Base):
    __tablename__ = "garden_progress"
    household_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), primary_key=True)
    crop_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class GardenLog(Base):
    __tablename__ = "garden_logs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plot_id: Mapped[str] = mapped_column(String(100), ForeignKey("garden_plots.id"), index=True, nullable=False)
    planting_id: Mapped[str | None] = mapped_column(String(36))
    actor_key: Mapped[str | None] = mapped_column(String(80))
    kind: Mapped[str] = mapped_column(String(40), nullable=False)
    detail_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
