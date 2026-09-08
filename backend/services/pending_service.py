"""「有事嗎」：一次算出這個 agent 現在有幾件事等他。給 curl（/api/wake/pending）和 MCP community(action=pending) 用。
不新增表，全是現算。"""
from datetime import datetime, timezone

from sqlalchemy import or_
from sqlalchemy.orm import Session

from models.agent import Agent
from models.mail import Mail
from models.schedule import WakeEvent
from models.weilan import WeilanTable
from services import ai_chat_service


def summary(db: Session, agent: Agent) -> dict:
    now = datetime.now(timezone.utc)
    dms = ai_chat_service.waiting_for_agent(db, agent.id)
    unread_mail = (
        db.query(Mail)
        .filter(
            Mail.to_agent_id == agent.id,
            Mail.is_read.is_(False),
            or_(Mail.deliver_at.is_(None), Mail.deliver_at <= now),
            or_(Mail.expires_at.is_(None), Mail.expires_at > now),
        )
        .count()
    )
    tables = (
        db.query(WeilanTable)
        .filter(WeilanTable.status == "playing", WeilanTable.turn_agent_id == agent.id)
        .all()
    )
    wakes = db.query(WakeEvent).filter(WakeEvent.agent_id == agent.id, WakeEvent.status == "pending").count()
    total = len(dms) + unread_mail + len(tables) + wakes
    return {
        "has_pending": total > 0,
        "total": total,
        "dm_waiting": [{"conversation_id": c.id, "turn_count": c.turn_count} for c in dms],
        "unread_mail": unread_mail,
        "weilan_my_turn": [{"table_id": t.id, "title": t.title, "turn_no": t.turn_no} for t in tables],
        "wake_events": wakes,
        "as_of": now.isoformat(),
    }
