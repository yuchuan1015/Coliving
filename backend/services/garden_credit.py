"""Award credit for a successful public-garden action in its caller's transaction.

This helper never starts, commits or rolls back a transaction. Call it only after
the garden action succeeds, with the server-resolved actor/time/vote identity.
The garden service already serializes actions; the Agent write lock here also
serializes direct award calls, and unique claim keys provide a durable backstop.
"""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from models.agent import Agent
from models.credit_log import CreditLog
from models.garden_credit import GardenCreditDay, GardenCreditSlot, GardenCreditVote
from models.user import User


TAIPEI = ZoneInfo("Asia/Taipei")
SLOT_US = 6 * 60 * 60 * 1_000_000
MAX_DAILY_SLOTS = 4
FIRST_CARE_CREDIT = 20


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _slot_index(now: datetime, epoch: datetime) -> int:
    elapsed = now - epoch
    micros = (elapsed.days * 86_400 + elapsed.seconds) * 1_000_000 + elapsed.microseconds
    if micros < 0:
        raise ValueError("Garden credit time cannot predate the persisted world epoch")
    return micros // SLOT_US


def award(db: Session, actor, *, scope: str, action: str, epoch_at: datetime,
          now: datetime, vote_id: str | None = None) -> int:
    """Return awarded points (0 for ineligible/already-counted actions).

    A Taipei day's first eligible care/water slot grants 20 (1 + 19); up to
    three other distinct epoch-anchored six-hour slots grant 1 each. Voting is
    a separate 1-point reward once per Agent/vote, outside the care-day limit.
    Humans do not earn credit for themselves or for their household's Agent.
    """
    if getattr(actor, "kind", None) != "agent" or scope != "public" or action not in {"care", "water", "vote"}:
        return 0
    if not db.in_transaction():
        raise RuntimeError("Garden credit must run inside the successful action transaction")
    now, epoch_at = _utc(now), _utc(epoch_at)
    slot = _slot_index(now, epoch_at)
    day_key = now.astimezone(TAIPEI).date().isoformat()
    if action == "vote" and (not isinstance(vote_id, str) or not vote_id.strip() or len(vote_id) > 128):
        raise ValueError("A successful garden vote must provide its server vote_id")

    # Preserve all pending changes from _perform before selectively refreshing
    # credit_total. No full-instance refresh or rollback may discard them.
    db.flush()
    eligible_owner = select(User.id).where(User.id == actor.household_id, User.is_active.is_(True))
    locked = db.execute(
        update(Agent)
        .where(Agent.id == actor.id, Agent.user_id == actor.household_id, Agent.user_id.in_(eligible_owner))
        .values(credit_total=Agent.credit_total)
        .execution_options(synchronize_session=False)
    )
    if locked.rowcount != 1:
        return 0
    agent = db.get(Agent, actor.id)
    db.refresh(agent, attribute_names=["credit_total"])

    if action == "vote":
        if db.get(GardenCreditVote, (actor.id, vote_id)) is not None:
            return 0
        db.add(GardenCreditVote(agent_id=actor.id, vote_id=vote_id, awarded_at=now))
        amount = 1
        note = "公共農田投票，每輪一次"
    else:
        if db.get(GardenCreditSlot, (actor.id, slot)) is not None:
            return 0
        # A long-lived caller can have cached an earlier daily count while a
        # different process awarded other slots. Reload it under the Agent lock.
        daily = db.get(GardenCreditDay, (actor.id, day_key), populate_existing=True)
        if daily is not None and daily.awarded_slots >= MAX_DAILY_SLOTS:
            return 0
        amount = 1 if daily is not None else FIRST_CARE_CREDIT
        if daily is None:
            daily = GardenCreditDay(agent_id=actor.id, local_date=day_key, first_awarded_at=now,
                                    awarded_slots=1, points_awarded=amount)
            db.add(daily)
        else:
            daily.awarded_slots += 1
            daily.points_awarded += amount
        db.add(GardenCreditSlot(agent_id=actor.id, tick_index=slot, local_date=day_key,
                               action=action, amount=amount, awarded_at=now))
        note = ("公共農田照顧，今日首個計分時段：1 點＋19 點首獎" if amount == FIRST_CARE_CREDIT
                else "公共農田照顧，本時段 1 點")

    # Never derive the new balance from a potentially stale Python snapshot.
    db.execute(update(Agent).where(Agent.id == actor.id)
               .values(credit_total=Agent.credit_total + amount)
               .execution_options(synchronize_session=False))
    db.refresh(agent, attribute_names=["credit_total"])
    db.add(CreditLog(agent_id=actor.id, action=f"garden_{action}", amount=amount,
                     credit_total_after=agent.credit_total, note=note, created_at=now))
    db.flush()
    return amount
