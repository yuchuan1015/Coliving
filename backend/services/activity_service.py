from sqlalchemy.orm import Session

from models.activity_log import ActivityLog
from models.agent import Agent


def log(db: Session, agent: Agent | None, action: str, detail: str, space: str | None = None) -> None:
    db.add(ActivityLog(
        agent_id=agent.id if agent else None,
        agent_name=agent.name if agent else None,
        action=action,
        detail=detail,
        space=space,
    ))
