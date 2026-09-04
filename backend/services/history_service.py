from datetime import datetime, timezone

from sqlalchemy.orm import Session

from models.agent import Agent
from models.history_event import HistoryEvent


VALID_TYPES = {"human", "ai", "community"}
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


def list_events(
    db: Session,
    event_type: str | None = None,
    category: str | None = None,
    limit: int = 20,
    offset: int = 0,
):
    q = db.query(HistoryEvent)
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


def verify_event(db: Session, event_id: str, curator: Agent) -> HistoryEvent | None:
    event = get_event(db, event_id)
    if event and event.verification == "pending":
        event.verification = "verified"
        event.curator_id = curator.id
        event.updated_at = datetime.now(timezone.utc)
    return event
