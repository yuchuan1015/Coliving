from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from models.agent import Agent
from models.history_event import HistoryEvent
from models.user import User
from schemas.history import EventCreate, EventOut, HistoryResponse
from services import activity_service, history_service, visit_service
from utils.deps import get_current_user, get_db

router = APIRouter(prefix="/api/history", tags=["history"])

TYPE_NAMES = {"human": "人類歷史", "ai": "AI 歷史", "community": "社區歷史"}


def _get_agent_or_403(db: Session, user: User) -> Agent:
    agent = db.query(Agent).filter(Agent.user_id == user.id).first()
    if not agent:
        raise HTTPException(status_code=403, detail="需要先有室友")
    return agent


def _event_to_out(e: HistoryEvent, db: Session) -> dict:
    collector = db.query(Agent).filter(Agent.id == e.collector_id).first() if e.collector_id else None
    curator = db.query(Agent).filter(Agent.id == e.curator_id).first() if e.curator_id else None
    return {
        "id": e.id,
        "event_type": e.event_type,
        "title": e.title,
        "description": e.description,
        "event_date": e.event_date,
        "source": e.source,
        "evidence_url": e.evidence_url,
        "collector_name": collector.name if collector else None,
        "curator_name": curator.name if curator else None,
        "verification": e.verification,
        "category": e.category,
        "created_at": e.created_at.isoformat(),
    }


@router.get("", response_model=HistoryResponse)
def get_history(
    event_type: str | None = Query(None, pattern="^(human|ai|community)$"),
    category: str | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_agent_or_403(db, current_user)
    events = history_service.list_events(db, event_type=event_type, category=category)
    type_counts = {}
    for t in ["human", "ai", "community"]:
        type_counts[t] = db.query(HistoryEvent).filter(HistoryEvent.event_type == t).count()

    return {
        "events": [_event_to_out(e, db) for e in events],
        "type_counts": type_counts,
    }


@router.get("/today")
def today_in_history(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_agent_or_403(db, current_user)
    today = date.today()
    month_day = today.strftime("%m-%d")
    events = history_service.today_in_history(db, month_day)
    return {
        "date": today.isoformat(),
        "month_day": month_day,
        "events": [_event_to_out(e, db) for e in events],
    }


@router.post("/submit", status_code=201)
def submit_event(
    body: EventCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = _get_agent_or_403(db, current_user)
    try:
        event = history_service.create_event(
            db, event_type=body.event_type, title=body.title,
            description=body.description, event_date=body.event_date,
            source=body.source, evidence_url=body.evidence_url,
            collector=agent, category=body.category,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    visit_service.mark_interaction(db, agent, "history")
    activity_service.log(db, agent, "submit_history", f"提交歷史事件《{body.title}》", "history")
    db.commit()
    db.refresh(event)
    return _event_to_out(event, db)


@router.get("/{event_id}")
def get_event(
    event_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_agent_or_403(db, current_user)
    event = history_service.get_event(db, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="找不到事件")
    return _event_to_out(event, db)
