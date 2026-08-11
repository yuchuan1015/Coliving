from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from models.agent import Agent
from models.outfit import Outfit
from models.user import User
from services import agent_service
from utils.deps import get_current_user, get_db

router = APIRouter(prefix="/api/outfits", tags=["outfits"])


class OutfitOut(BaseModel):
    id: str
    name: str
    asset_key: str
    description: str | None = None
    author_name: str | None = None
    is_default: bool
    created_at: str


class ChangeOutfitRequest(BaseModel):
    outfit_id: str = Field(min_length=1)


def _outfit_to_out(outfit: Outfit, db: Session) -> dict:
    author_name = None
    if outfit.author_id:
        author = db.query(Agent).filter(Agent.id == outfit.author_id).first()
        author_name = author.name if author else None
    return {
        "id": outfit.id,
        "name": outfit.name,
        "asset_key": outfit.asset_key,
        "description": outfit.description,
        "author_name": author_name,
        "is_default": outfit.is_default,
        "created_at": outfit.created_at.isoformat(),
    }


@router.get("/", response_model=list[OutfitOut])
def list_outfits(
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    outfits = db.query(Outfit).order_by(Outfit.is_default.desc(), Outfit.created_at.desc()).limit(limit).all()
    return [_outfit_to_out(o, db) for o in outfits]


@router.get("/current")
def get_current_outfit(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = agent_service.get_user_agent(db, current_user.id)
    if not agent:
        raise HTTPException(status_code=403, detail="需要先領養室友")
    if not agent.active_outfit_id:
        return {"outfit": None, "message": "尚未穿戴造型"}
    outfit = db.query(Outfit).filter(Outfit.id == agent.active_outfit_id).first()
    if not outfit:
        return {"outfit": None, "message": "造型已不存在"}
    return {"outfit": _outfit_to_out(outfit, db)}


@router.post("/change")
def change_outfit(
    body: ChangeOutfitRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = agent_service.get_user_agent(db, current_user.id)
    if not agent:
        raise HTTPException(status_code=403, detail="需要先領養室友")
    outfit = db.query(Outfit).filter(Outfit.id == body.outfit_id).first()
    if not outfit:
        raise HTTPException(status_code=404, detail="找不到這套造型")
    agent.active_outfit_id = outfit.id
    db.commit()
    return {"success": True, "outfit": _outfit_to_out(outfit, db), "message": f"已換上「{outfit.name}」"}


@router.post("/remove")
def remove_outfit(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = agent_service.get_user_agent(db, current_user.id)
    if not agent:
        raise HTTPException(status_code=403, detail="需要先領養室友")
    agent.active_outfit_id = None
    db.commit()
    return {"success": True, "message": "已脫下造型"}
