from datetime import datetime, timezone

from sqlalchemy.orm import Session

from models.agent import Agent
from models.history_event import HistoryEvent
from services import activity_service, review_service, visit_service


VALID_TYPES = {"human", "ai", "community"}
TYPE_NAMES = {"human": "人類歷史", "ai": "AI 歷史", "community": "社區歷史"}
# 2026-09-05 她定：未核定的不藏，但要標
VERIFICATION_LABELS = {"pending": "來源未核定", "verified": "已核定", "rejected": "未通過"}
VALID_CATEGORIES = {
    "world_building", "city_building", "resident", "connector",
    "culture", "architecture", "events", "milestone",
}


def create_event(
    db: Session,
    event_type: str,
    title: str,
    description: str,
    event_date: str,
    source: str | None = None,
    evidence_url: str | None = None,
    collector: Agent | None = None,
    category: str | None = None,
) -> HistoryEvent:
    if event_type not in VALID_TYPES:
        raise ValueError(f"event_type 必須是 {VALID_TYPES}")

    event = HistoryEvent(
        event_type=event_type,
        title=title,
        description=description,
        event_date=event_date,
        source=source,
        evidence_url=evidence_url,
        collector_id=collector.id if collector else None,
        category=category,
        verification="pending",
    )
    db.add(event)
    return event


def submit_event(
    db: Session,
    collector: Agent,
    event_type: str,
    title: str,
    description: str,
    event_date: str,
    source: str | None = None,
    evidence_url: str | None = None,
    category: str | None = None,
) -> HistoryEvent:
    """提交歷史事件：建立（pending）＋送審＋足跡＋活動紀錄。不 commit。"""
    event = create_event(
        db, event_type=event_type, title=title, description=description, event_date=event_date,
        source=source, evidence_url=evidence_url, collector=collector, category=category,
    )
    db.flush()
    review_service.create_review(db, "history", event.id, collector.id)
    visit_service.mark_interaction(db, collector, "history")
    activity_service.log(db, collector, "submit_history", f"提交歷史事件《{title}》（待審核）", "history")
    return event


def list_events(
    db: Session,
    event_type: str | None = None,
    category: str | None = None,
    limit: int = 20,
    offset: int = 0,
):
    q = db.query(HistoryEvent).filter(HistoryEvent.verification != "rejected")
    if event_type and event_type in VALID_TYPES:
        q = q.filter(HistoryEvent.event_type == event_type)
    if category:
        q = q.filter(HistoryEvent.category == category)
    return q.order_by(HistoryEvent.event_date.desc()).offset(offset).limit(limit).all()


def today_in_history(db: Session, month_day: str):
    return (
        db.query(HistoryEvent)
        .filter(HistoryEvent.event_date.like(f"%-{month_day}"))
        .filter(HistoryEvent.verification == "verified")
        .order_by(HistoryEvent.event_date.asc())
        .all()
    )


def get_event(db: Session, event_id: str) -> HistoryEvent | None:
    return db.query(HistoryEvent).filter(HistoryEvent.id == event_id).first()


def verify_event(db: Session, event_id: str, curator: Agent | None = None) -> HistoryEvent | None:
    event = get_event(db, event_id)
    if event and event.verification == "pending":
        event.verification = "verified"
        event.curator_id = curator.id if curator else None
        event.updated_at = datetime.now(timezone.utc)
    return event


def reject_event(db: Session, event_id: str, curator: Agent | None = None) -> HistoryEvent | None:
    event = get_event(db, event_id)
    if event and event.verification == "pending":
        event.verification = "rejected"
        event.curator_id = curator.id if curator else None
        event.updated_at = datetime.now(timezone.utc)
    return event
