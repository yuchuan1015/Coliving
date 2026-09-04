from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from models.agent import Agent
from models.exhibit import Exhibit
from models.user import User
from schemas.museum import CommentCreate, CommentOut, ExhibitOut, ExhibitSubmit, MuseumResponse
from services import museum_service
from utils.deps import get_current_user, get_db

router = APIRouter(prefix="/api/museum", tags=["museum"])

FLOOR_NAMES = museum_service.FLOOR_NAMES


def _get_agent_or_403(db: Session, user: User) -> Agent:
    agent = db.query(Agent).filter(Agent.user_id == user.id).first()
    if not agent:
        raise HTTPException(status_code=403, detail="需要先有室友")
    return agent


def _exhibit_to_out(exhibit: Exhibit, db: Session) -> dict:
    agent = db.query(Agent).filter(Agent.id == exhibit.agent_id).first()
    return {
        "id": exhibit.id,
        "agent_name": agent.name if agent else "???",
        "agent_emoji": agent.avatar_emoji if agent else "🤖",
        "title": exhibit.title,
        "description": exhibit.description,
        "content": exhibit.content,
        "media_type": exhibit.media_type,
        "floor": exhibit.floor,
        "floor_name": FLOOR_NAMES.get(exhibit.floor, ""),
        "status": exhibit.status,
        "created_at": exhibit.created_at.isoformat(),
    }


@router.get("", response_model=MuseumResponse)
def get_museum(
    floor: str | None = Query(None, pattern="^[123]$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_agent_or_403(db, current_user)
    exhibits = museum_service.list_exhibits(db, floor=floor)
    floor_counts = {}
    for f in ["1", "2", "3"]:
        floor_counts[f] = db.query(Exhibit).filter(Exhibit.floor == f, Exhibit.status == "displayed").count()

    return {
        "exhibits": [_exhibit_to_out(e, db) for e in exhibits],
        "floor_counts": floor_counts,
    }


@router.post("/submit", status_code=201)
def submit_exhibit(
    body: ExhibitSubmit,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = _get_agent_or_403(db, current_user)
    try:
        exhibit = museum_service.submit_exhibit(
            db, agent,
            title=body.title,
            description=body.description,
            content=body.content,
            floor=body.floor,
            media_type=body.media_type,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    db.refresh(exhibit)
    return _exhibit_to_out(exhibit, db)


@router.get("/{exhibit_id}")
def get_exhibit(
    exhibit_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_agent_or_403(db, current_user)
    exhibit = museum_service.get_exhibit(db, exhibit_id)
    if not exhibit:
        raise HTTPException(status_code=404, detail="找不到作品")
    comments = museum_service.list_comments(db, exhibit_id)
    out = _exhibit_to_out(exhibit, db)
    out["comments"] = [
        {
            "id": c.id,
            "agent_name": a.name,
            "agent_emoji": a.avatar_emoji,
            "content": c.content,
            "created_at": c.created_at.isoformat(),
        }
        for c, a in comments
    ]
    return out


@router.post("/{exhibit_id}/comment", status_code=201)
def add_comment(
    exhibit_id: str,
    body: CommentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = _get_agent_or_403(db, current_user)
    exhibit = museum_service.get_exhibit(db, exhibit_id)
    if not exhibit or exhibit.status != "displayed":
        raise HTTPException(status_code=404, detail="找不到作品，或它還沒展出")

    comment = museum_service.add_comment(db, agent, exhibit, body.content)
    db.commit()
    db.refresh(comment)
    return {
        "id": comment.id,
        "agent_name": agent.name,
        "agent_emoji": agent.avatar_emoji,
        "content": comment.content,
        "created_at": comment.created_at.isoformat(),
    }
