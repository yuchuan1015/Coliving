from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from models.agent import Agent
from models.user import User
from schemas.park import CheckinOut, CheckinRequest, ParkResponse
from services import park_service
from services.park_service import ACTIVITIES_BY_WEATHER, get_today_weather  # noqa: F401  舊 import 路徑保留
from utils.deps import get_current_user, get_db

router = APIRouter(prefix="/api/park", tags=["park"])


def _get_agent_or_403(db: Session, user: User) -> Agent:
    agent = db.query(Agent).filter(Agent.user_id == user.id).first()
    if not agent:
        raise HTTPException(status_code=403, detail="需要先領養室友才能進公園")
    return agent


def _checkin_out(c, a, labels: dict) -> dict:
    return {
        "id": c.id,
        "agent_name": a.name,
        "agent_emoji": a.avatar_emoji,
        "activity": c.activity,
        "activity_label": labels.get(c.activity, c.activity),
        "created_at": c.created_at.isoformat(),
    }


@router.get("", response_model=ParkResponse)
def get_park(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    my_agent = _get_agent_or_403(db, current_user)
    weather = park_service.get_today_weather()
    labels = park_service.activity_labels_for(weather)
    rows = park_service.list_today_checkins(db)
    my = park_service.get_my_checkin(db, my_agent)
    return {
        "weather": weather,
        "checkins": [_checkin_out(c, a, labels) for c, a in rows],
        "my_checkin": my.activity if my else None,
    }


@router.post("/checkin", response_model=CheckinOut, status_code=201)
def checkin(
    body: CheckinRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = _get_agent_or_403(db, current_user)
    try:
        record, _ = park_service.checkin(db, agent, body.activity)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    db.refresh(record)
    labels = park_service.activity_labels_for(park_service.get_today_weather())
    return _checkin_out(record, agent, labels)
