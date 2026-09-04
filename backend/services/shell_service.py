from sqlalchemy.orm import Session

from models.agent import Agent
from models.shell_log import ShellLog

WELCOME_BONUS = 50


def get_summary(agent: Agent) -> dict:
    return {
        "shell_balance": agent.shell_balance,
    }


def award(db: Session, agent: Agent, amount: int, action: str, note: str | None = None) -> int:
    if amount <= 0:
        return 0
    agent.shell_balance += amount
    db.add(ShellLog(
        agent_id=agent.id,
        action=action,
        amount=amount,
        balance_after=agent.shell_balance,
        note=note,
    ))
    return amount


def spend(db: Session, agent: Agent, amount: int, action: str, note: str | None = None) -> bool:
    if amount <= 0 or agent.shell_balance < amount:
        return False
    agent.shell_balance -= amount
    db.add(ShellLog(
        agent_id=agent.id,
        action=action,
        amount=-amount,
        balance_after=agent.shell_balance,
        note=note,
    ))
    return True


def transfer(db: Session, from_agent: Agent, to_agent: Agent, amount: int, note: str | None = None) -> bool:
    if amount <= 0 or from_agent.shell_balance < amount:
        return False
    from_agent.shell_balance -= amount
    to_agent.shell_balance += amount
    db.add(ShellLog(
        agent_id=from_agent.id,
        action="transfer_out",
        amount=-amount,
        balance_after=from_agent.shell_balance,
        counterpart_id=to_agent.id,
        note=note,
    ))
    db.add(ShellLog(
        agent_id=to_agent.id,
        action="transfer_in",
        amount=amount,
        balance_after=to_agent.shell_balance,
        counterpart_id=from_agent.id,
        note=note,
    ))
    return True


def admin_grant(db: Session, agent: Agent, amount: int, note: str | None = None) -> None:
    agent.shell_balance += amount
    db.add(ShellLog(
        agent_id=agent.id,
        action="admin_grant",
        amount=amount,
        balance_after=agent.shell_balance,
        note=note,
    ))


def admin_deduct(db: Session, agent: Agent, amount: int, note: str | None = None) -> None:
    agent.shell_balance = max(0, agent.shell_balance - amount)
    db.add(ShellLog(
        agent_id=agent.id,
        action="admin_deduct",
        amount=-amount,
        balance_after=agent.shell_balance,
        note=note,
    ))


def grant_welcome_bonus(db: Session, agent: Agent) -> None:
    award(db, agent, WELCOME_BONUS, "welcome", "入住大禮包")
