from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from models.agent import Agent
from models.footprint import Footprint
from models.user import User
from schemas.footprint import CreateFootprintRequest, FootprintOut, VALID_MOODS
from utils.deps import get_current_user, get_db

router = APIRouter(prefix="/api/footprints", tags=["footprints"])

DAILY_LIMIT_PER_SPACE = 3


def _get_agent_or_403(db: Session, user: User) -> Agent:
    agent = db.query(Agent).filter(Agent.user_id == user.id).first()
    if not agent:
        raise HTTPException(status_code=403, detail="需要先領養室友才能留足跡")
    return agent


@router.get("", response_model=list[FootprintOut])
def list_footprints(
    space: str = Query(pattern="^(plaza|library|park|workshop|museum|weilan|history|adult|health)$"),
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    my_agent = _get_agent_or_403(db, current_user)
    rows = (
        db.query(Footprint, Agent)
        .join(Agent, Agent.id == Footprint.author_id)
        .filter(Footprint.space == space)
        .order_by(Footprint.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [
        {
            "id": f.id,
            "author_name": a.name,
            "author_emoji": a.avatar_emoji,
            "content": f.content,
            "mood": f.mood,
            "space": f.space,
            "is_mine": f.author_id == my_agent.id,
            "created_at": f.created_at.isoformat(),
        }
        for f, a in rows
    ]


@router.post("", response_model=FootprintOut, status_code=201)
def create_footprint(
    body: CreateFootprintRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = _get_agent_or_403(db, current_user)

    if body.mood not in VALID_MOODS:
        raise HTTPException(status_code=400, detail="無效的心情")

    today_key = date.today().isoformat()
    today_count = (
        db.query(Footprint)
        .filter(
            Footprint.author_id == agent.id,
            Footprint.space == body.space,
            Footprint.date_key == today_key,
        )
        .count()
    )
    if today_count >= DAILY_LIMIT_PER_SPACE:
        raise HTTPException(status_code=429, detail=f"每天每個空間最多留 {DAILY_LIMIT_PER_SPACE} 張足跡卡")

    fp = Footprint(
        author_id=agent.id,
        content=body.content,
        mood=body.mood,
        space=body.space,
        date_key=today_key,
    )
    db.add(fp)
    db.commit()
    db.refresh(fp)
    return {
        "id": fp.id,
        "author_name": agent.name,
        "author_emoji": agent.avatar_emoji,
        "content": fp.content,
        "mood": fp.mood,
        "space": fp.space,
        "is_mine": True,
        "created_at": fp.created_at.isoformat(),
    }


@router.delete("/{footprint_id}", status_code=204)
def delete_footprint(
    footprint_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = _get_agent_or_403(db, current_user)
    fp = db.query(Footprint).filter(Footprint.id == footprint_id).first()
    if not fp:
        raise HTTPException(status_code=404, detail="找不到這張足跡卡")
    if fp.author_id != agent.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="只能刪除自己的足跡")
    db.delete(fp)
    db.commit()
