"""Exact shell accounting shared by crop sales and legacy shell operations.

Mutations do not commit. Callers hold the same transaction lock as garden sales
(SQLite BEGIN IMMEDIATE) before reading or changing a balance. The first agent
write imports its existing integer balance once; human wallets start at zero.
All later reads/writes use the rational wallet. The old Agent integer is a floor
mirror only, never a second source of currency.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from fractions import Fraction

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.agent import Agent
from models.shell_wallet import ShellEntry, ShellWallet
from models.user import User


@dataclass(frozen=True)
class WalletActor:
    kind: str
    id: str
    household_id: str

    @property
    def key(self):
        return f"{self.kind}:{self.id}"


def actor_for_agent(agent: Agent) -> WalletActor:
    return WalletActor("agent", agent.id, agent.user_id)


def _fraction(value) -> Fraction:
    if isinstance(value, bool) or not isinstance(value, (int, str, Fraction)):
        raise ValueError("貝數量須為整數或精確分數")
    try:
        return Fraction(value)
    except (ValueError, ZeroDivisionError) as exc:
        raise ValueError("無效的貝數量") from exc


def _owner(db: Session, actor) -> tuple[str, Agent | None]:
    if actor.kind not in {"user", "agent"} or not actor.id or not actor.household_id:
        raise ValueError("無效的貝錢包身分")
    key = f"{actor.kind}:{actor.id}"
    if actor.key != key:
        raise ValueError("貝錢包身分不一致")
    if actor.kind == "agent":
        agent = db.scalar(select(Agent).where(Agent.id == actor.id).execution_options(populate_existing=True))
        if agent is None or agent.user_id != actor.household_id:
            raise ValueError("室友不屬於這個家戶")
        return key, agent
    if actor.id != actor.household_id or db.get(User, actor.id) is None:
        raise ValueError("人類錢包不屬於這個家戶")
    return key, None


def _amount(row: ShellWallet) -> Fraction:
    value = Fraction(int(row.balance_numerator), int(row.balance_denominator))
    if value < 0:
        raise ValueError("貝錢包餘額異常")
    return value


def _legacy(agent: Agent | None) -> Fraction:
    return Fraction(int(agent.shell_balance or 0)) if agent is not None else Fraction()


def balance(db: Session, actor) -> Fraction:
    """Read without creating a wallet or entry; old agent assets stay available."""
    key, agent = _owner(db, actor)
    row = db.scalar(select(ShellWallet).where(ShellWallet.owner_key == key).execution_options(populate_existing=True))
    if row is None:
        value = _legacy(agent)
        if value < 0:
            raise ValueError("舊貝餘額異常")
        return value
    if row.household_id != actor.household_id:
        raise ValueError("錢包不屬於這個家戶")
    return _amount(row)


def _display(value: Fraction) -> str:
    # Exact half-up to two decimal places; Decimal context/float size cannot
    # truncate a repeating fraction or a large legacy balance.
    cents = (value.numerator * 200 + value.denominator) // (2 * value.denominator)
    return f"{cents // 100}.{cents % 100:02d}"


def summary(db: Session, actor) -> dict:
    value = balance(db, actor)
    return {"shell_balance": value.numerator // value.denominator,
            "shell_balance_exact": str(value), "shell_balance_display": _display(value)}


def change(db: Session, actor, amount, *, source_key: str, action: str,
           note: str | None = None, now: datetime | None = None) -> Fraction:
    """Record one signed change. Caller locks/commits; repeats cannot reissue."""
    amount = _fraction(amount)
    if amount == 0:
        raise ValueError("貝異動須非零")
    if not isinstance(source_key, str) or not source_key.strip() or len(source_key) > 350:
        raise ValueError("貝異動需要穩定且不超過350字的來源編號")
    if not isinstance(action, str) or not action.strip() or len(action) > 40:
        raise ValueError("無效的貝異動類型")
    key, agent = _owner(db, actor)
    existing = db.scalar(select(ShellEntry).where(ShellEntry.source_key == source_key))
    if existing is not None:
        previous = Fraction(int(existing.amount_numerator), int(existing.amount_denominator))
        if (existing.owner_key, existing.household_id, previous, existing.action) != (key, actor.household_id, amount, action):
            raise ValueError("貝異動來源編號已用於不同內容")
        return balance(db, actor)
    row = db.scalar(select(ShellWallet).where(ShellWallet.owner_key == key).with_for_update()
                    .execution_options(populate_existing=True))
    if row is not None and row.household_id != actor.household_id:
        raise ValueError("錢包不屬於這個家戶")
    before = _amount(row) if row is not None else _legacy(agent)
    after = before + amount
    if before < 0 or after < 0:
        raise ValueError("貝不夠")
    mirror = after.numerator // after.denominator
    if agent is not None and mirror > 9_223_372_036_854_775_807:
        raise ValueError("貝餘額超過相容欄位可保存範圍")
    if row is None:
        row = ShellWallet(owner_key=key, household_id=actor.household_id,
                          balance_numerator=str(before.numerator), balance_denominator=str(before.denominator))
        db.add(row)
        db.flush()
    row.balance_numerator = str(after.numerator)
    row.balance_denominator = str(after.denominator)
    if agent is not None:
        agent.shell_balance = mirror
    db.add(ShellEntry(source_key=source_key, owner_key=key, household_id=actor.household_id,
                      action=action, amount_numerator=str(amount.numerator), amount_denominator=str(amount.denominator),
                      balance_after_numerator=str(after.numerator), balance_after_denominator=str(after.denominator),
                      note=note, created_at=now or datetime.now(timezone.utc)))
    db.flush()
    return after


def credit(db: Session, actor, amount, *, source_key: str, action: str,
           note: str | None = None, now: datetime | None = None) -> Fraction:
    amount = _fraction(amount)
    if amount <= 0:
        raise ValueError("入帳貝數量須為正數")
    return change(db, actor, amount, source_key=source_key, action=action, note=note, now=now)


def debit(db: Session, actor, amount, *, source_key: str, action: str,
          note: str | None = None, now: datetime | None = None) -> Fraction:
    amount = _fraction(amount)
    if amount <= 0:
        raise ValueError("扣帳貝數量須為正數")
    return change(db, actor, -amount, source_key=source_key, action=action, note=note, now=now)
