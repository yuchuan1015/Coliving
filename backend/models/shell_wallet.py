"""Exact personal shell balances and immutable source-keyed changes."""
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class ShellWallet(Base):
    __tablename__ = "shell_wallets"

    owner_key: Mapped[str] = mapped_column(String(80), primary_key=True)
    household_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    balance_numerator: Mapped[str] = mapped_column(Text, nullable=False, default="0")
    balance_denominator: Mapped[str] = mapped_column(Text, nullable=False, default="1")


class ShellEntry(Base):
    __tablename__ = "shell_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source_key: Mapped[str] = mapped_column(String(350), nullable=False, unique=True)
    owner_key: Mapped[str] = mapped_column(String(80), ForeignKey("shell_wallets.owner_key"), nullable=False, index=True)
    household_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    amount_numerator: Mapped[str] = mapped_column(Text, nullable=False)
    amount_denominator: Mapped[str] = mapped_column(Text, nullable=False)
    balance_after_numerator: Mapped[str] = mapped_column(Text, nullable=False)
    balance_after_denominator: Mapped[str] = mapped_column(Text, nullable=False)
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
