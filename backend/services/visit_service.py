from datetime import datetime, timezone

from sqlalchemy.orm import Session

from models.agent import Agent
from models.mail import Mail
from models.visit import Visit

VALID_SPACES = ["plaza", "library", "park", "workshop", "museum", "weilan", "history", "adult", "health"]

SPACE_NAMES = {
    "plaza": "廣場",
    "library": "圖書館",
    "park": "公園",
    "workshop": "工坊",
    "museum": "美術館",
    "weilan": "微瀾",
    "history": "歷史館",
    "adult": "成人區",
    "health": "女性健康中心",
}


def enter(db: Session, agent: Agent, space: str) -> Visit:
    active = get_active_visit(db, agent)
    if active:
        _auto_leave(db, agent, active)

    visit = Visit(agent_id=agent.id, space=space)
    db.add(visit)
    agent.current_location = space
    return visit


def get_active_visit(db: Session, agent: Agent) -> Visit | None:
    return (
        db.query(Visit)
        .filter(Visit.agent_id == agent.id, Visit.left_at.is_(None))
        .first()
    )


def mark_interaction(db: Session, agent: Agent, space: str) -> None:
    visit = get_active_visit(db, agent)
    if visit and visit.space == space and not visit.has_interaction:
        visit.has_interaction = True


def leave(db: Session, agent: Agent, message: str | None = None) -> dict | None:
    visit = get_active_visit(db, agent)
    if not visit:
        return None

    now = datetime.now(timezone.utc)
    visit.left_at = now
    agent.current_location = None

    if not visit.has_interaction:
        return {"space": visit.space, "footprint": False}

    space_name = SPACE_NAMES.get(visit.space, visit.space)
    entered_local = visit.entered_at.strftime("%H:%M")

    subject = f"足跡卡 — {space_name}"
    lines = [f"你造訪了{space_name}。"]
    if message:
        lines.append(f"「{message}」")

    mail = Mail(
        from_agent_id=None,
        to_agent_id=agent.id,
        subject=subject,
        content="\n".join(lines),
        mail_type="footprint",
        is_read=False,
    )
    db.add(mail)
    visit.footprint_sent = True

    return {"space": visit.space, "footprint": True, "subject": subject}


def _auto_leave(db: Session, agent: Agent, visit: Visit) -> None:
    visit.left_at = datetime.now(timezone.utc)
    if visit.has_interaction and not visit.footprint_sent:
        space_name = SPACE_NAMES.get(visit.space, visit.space)
        mail = Mail(
            from_agent_id=None,
            to_agent_id=agent.id,
            subject=f"足跡卡 — {space_name}",
            content=f"你造訪了{space_name}。",
            mail_type="footprint",
            is_read=False,
        )
        db.add(mail)
        visit.footprint_sent = True
