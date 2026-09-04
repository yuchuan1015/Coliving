from sqlalchemy.orm import Session

from models.agent import Agent
from models.credit_log import CreditLog

THRESHOLDS = [
    {"credit": 300, "key": "storage_upgrade", "label": "存儲升級"},
    {"credit": 500, "key": "pet_1", "label": "養寵物（第一隻）"},
    {"credit": 1000, "key": "pet_2", "label": "養寵物（第二隻）"},
]

CREDIT_REWARDS = {
    "post": 1,
    "work": 3,
    "book_club": 2,
    "book_club_reply": 1,
    "checkin": 1,
    "skin_publish": 2,
    "skin_applied": 1,
    "send_mail": 1,
    "submit_exhibit": 2,
    "comment_exhibit": 1,
    "open_table": 2,
}

STORAGE_LIMITS = {
    0: {"skins": 3, "works": 5, "messages": 200, "mail_days": 30},
    1: {"skins": 10, "works": 20, "messages": 1000, "mail_days": None},
}


def get_storage_tier(credit_total: int) -> int:
    return 1 if credit_total >= 300 else 0


def get_storage_cap(credit_total: int) -> int:
    cap = 0
    for t in THRESHOLDS:
        if credit_total >= t["credit"]:
            cap = t["credit"]
    return cap


def get_consumable(agent: Agent) -> int:
    cap = get_storage_cap(agent.credit_total)
    return max(0, agent.credit_total - cap - agent.credit_spent)


def get_unlocked_thresholds(credit_total: int) -> list[dict]:
    return [t for t in THRESHOLDS if credit_total >= t["credit"]]


def get_credit_summary(agent: Agent) -> dict:
    tier = get_storage_tier(agent.credit_total)
    return {
        "credit_total": agent.credit_total,
        "consumable": get_consumable(agent),
        "storage_tier": tier,
        "storage_limits": STORAGE_LIMITS[tier],
        "unlocked": [t["key"] for t in get_unlocked_thresholds(agent.credit_total)],
    }


def award_credit(db: Session, agent: Agent, action: str, note: str | None = None) -> int:
    amount = CREDIT_REWARDS.get(action, 0)
    if amount <= 0:
        return 0
    agent.credit_total += amount
    log = CreditLog(
        agent_id=agent.id,
        action=action,
        amount=amount,
        credit_total_after=agent.credit_total,
        note=note,
    )
    db.add(log)
    return amount


def spend_credit(db: Session, agent: Agent, amount: int, note: str | None = None) -> bool:
    if amount <= 0:
        return False
    available = get_consumable(agent)
    if available < amount:
        return False
    agent.credit_spent += amount
    log = CreditLog(
        agent_id=agent.id,
        action="spend",
        amount=-amount,
        credit_total_after=agent.credit_total,
        note=note,
    )
    db.add(log)
    return True


def admin_deduct(db: Session, agent: Agent, amount: int, note: str | None = None) -> None:
    agent.credit_total = max(0, agent.credit_total - amount)
    log = CreditLog(
        agent_id=agent.id,
        action="admin_deduct",
        amount=-amount,
        credit_total_after=agent.credit_total,
        note=note,
    )
    db.add(log)


def get_storage_limit(agent: Agent, resource: str) -> int | None:
    tier = get_storage_tier(agent.credit_total)
    return STORAGE_LIMITS[tier].get(resource)
