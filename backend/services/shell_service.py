"""Compatibility operations backed by the same exact wallet used by crop sales.

Mutations do not commit; the HTTP routes and other callers must hold the shared
wallet/garden transaction lock. Integer ShellLog rows remain for old clients;
ShellEntry is the authoritative exact ledger for new changes.
"""
from fractions import Fraction
from uuid import uuid4

from sqlalchemy.orm import Session, object_session

from models.agent import Agent
from models.shell_log import ShellLog
from services import shell_wallet

WELCOME_BONUS = 0


def get_summary(agent: Agent, db: Session | None = None) -> dict:
    session = db if db is not None else object_session(agent)
    if session is not None:
        return shell_wallet.summary(session, shell_wallet.actor_for_agent(agent))
    # Preserve the pre-wallet helper for detached legacy objects. All HTTP
    # callers pass a session and therefore return the authoritative fraction.
    value = Fraction(int(agent.shell_balance or 0))
    return {"shell_balance": int(value), "shell_balance_exact": str(value),
            "shell_balance_display": f"{int(value)}.00"}


def _positive_integer(amount) -> bool:
    return isinstance(amount, int) and not isinstance(amount, bool) and amount > 0


def _log(db, agent, amount, after, action, note=None, counterpart_id=None):
    integer = abs(amount.numerator) // amount.denominator
    if amount < 0:
        integer = -integer
    if amount.denominator != 1:
        note = ((note + "；") if note else "") + f"精確異動 {amount} 貝（整數欄位僅供舊版顯示）"
    db.add(ShellLog(agent_id=agent.id, action=action, amount=integer,
                    balance_after=after.numerator // after.denominator,
                    counterpart_id=counterpart_id, note=note))


def award(db: Session, agent: Agent, amount: int, action: str, note: str | None = None) -> int:
    """Legacy internal grant helper; normal welcome issuance has been disabled."""
    if not _positive_integer(amount):
        return 0
    after = shell_wallet.credit(db, shell_wallet.actor_for_agent(agent), amount,
                                source_key=f"legacy-award:{uuid4()}", action=action, note=note)
    _log(db, agent, Fraction(amount), after, action, note)
    return amount


def spend(db: Session, agent: Agent, amount: int, action: str, note: str | None = None) -> bool:
    actor = shell_wallet.actor_for_agent(agent)
    if not _positive_integer(amount) or shell_wallet.balance(db, actor) < amount:
        return False
    after = shell_wallet.debit(db, actor, amount, source_key=f"legacy-spend:{uuid4()}", action=action, note=note)
    _log(db, agent, Fraction(-amount), after, action, note)
    return True


def transfer(db: Session, from_agent: Agent, to_agent: Agent, amount: int, note: str | None = None) -> bool:
    if not _positive_integer(amount) or from_agent.id == to_agent.id:
        return False
    sender = shell_wallet.actor_for_agent(from_agent)
    recipient = shell_wallet.actor_for_agent(to_agent)
    if shell_wallet.balance(db, sender) < amount:
        return False
    shell_wallet.balance(db, recipient)  # Validate the recipient before any debit.
    source = f"legacy-transfer:{uuid4()}"
    sender_after = shell_wallet.debit(db, sender, amount, source_key=source + ":out", action="transfer_out", note=note)
    recipient_after = shell_wallet.credit(db, recipient, amount, source_key=source + ":in", action="transfer_in", note=note)
    _log(db, from_agent, Fraction(-amount), sender_after, "transfer_out", note, to_agent.id)
    _log(db, to_agent, Fraction(amount), recipient_after, "transfer_in", note, from_agent.id)
    return True


def admin_grant(db: Session, agent: Agent, amount: int, note: str | None = None) -> None:
    if not _positive_integer(amount):
        raise ValueError("管理補發數量須為正整數")
    after = shell_wallet.credit(db, shell_wallet.actor_for_agent(agent), amount,
                                source_key=f"admin-grant:{uuid4()}", action="admin_grant", note=note)
    _log(db, agent, Fraction(amount), after, "admin_grant", note)


def admin_deduct(db: Session, agent: Agent, amount: int, note: str | None = None) -> None:
    if not _positive_integer(amount):
        raise ValueError("管理扣除數量須為正整數")
    actor = shell_wallet.actor_for_agent(agent)
    available = shell_wallet.balance(db, actor)
    actual = min(Fraction(amount), available)
    if actual == 0:
        return
    after = shell_wallet.debit(db, actor, actual, source_key=f"admin-deduct:{uuid4()}", action="admin_deduct", note=note)
    _log(db, agent, -actual, after, "admin_deduct", note)


def grant_welcome_bonus(db: Session, agent: Agent) -> None:
    """Existing assets stay intact; adoption no longer creates new shells."""
    return None
