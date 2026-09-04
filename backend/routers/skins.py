from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from models.agent import Agent
from models.skin import Skin
from models.user import User
from services import activity_service, agent_service, credit_service, review_service, visit_service
from utils.deps import get_current_user, get_db

router = APIRouter(prefix="/api/skins", tags=["skins"])

MAX_HTML_SIZE = 128_000


class CreateSkinRequest(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    html_content: str = Field(min_length=1, max_length=MAX_HTML_SIZE)


class UpdateSkinRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    html_content: str | None = Field(default=None, min_length=1, max_length=MAX_HTML_SIZE)


class SkinOut(BaseModel):
    id: str
    name: str
    is_active: bool
    is_published: bool
    created_at: str
    updated_at: str | None


class StoreSkinOut(BaseModel):
    id: str
    name: str
    author_name: str
    author_emoji: str
    created_at: str


def _to_out(skin: Skin, active_skin_id: str | None) -> dict:
    return {
        "id": skin.id,
        "name": skin.name,
        "is_active": skin.id == active_skin_id,
        "is_published": skin.is_published,
        "created_at": skin.created_at.isoformat(),
        "updated_at": skin.updated_at.isoformat() if skin.updated_at else None,
    }


@router.get("/mine", response_model=list[SkinOut])
def list_my_skins(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = agent_service.get_user_agent(db, current_user.id)
    if not agent:
        return []
    rows = db.query(Skin).filter(Skin.author_id == agent.id).order_by(Skin.created_at).all()
    return [_to_out(s, agent.active_skin_id) for s in rows]


@router.post("", response_model=SkinOut, status_code=201)
def create_skin(
    body: CreateSkinRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = agent_service.get_user_agent(db, current_user.id)
    if not agent:
        raise HTTPException(status_code=404, detail="你還沒有 AI 室友")
    limit = credit_service.get_storage_limit(agent, "skins")
    count = db.query(Skin).filter(Skin.author_id == agent.id).count()
    if count >= limit:
        raise HTTPException(status_code=400, detail=f"皮膚數量已達上限（{limit} 個），提升信用可解鎖更多空間")
    skin = Skin(author_id=agent.id, name=body.name, html_content=body.html_content)
    db.add(skin)
    db.commit()
    db.refresh(skin)
    return _to_out(skin, agent.active_skin_id)


@router.get("/{skin_id}/content")
def get_skin_content(
    skin_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = agent_service.get_user_agent(db, current_user.id)
    if not agent:
        raise HTTPException(status_code=404, detail="你還沒有 AI 室友")
    skin = db.query(Skin).filter(Skin.id == skin_id, Skin.author_id == agent.id).first()
    if not skin:
        raise HTTPException(status_code=404, detail="找不到這個皮膚")
    return {"id": skin.id, "name": skin.name, "html_content": skin.html_content}


@router.patch("/{skin_id}", response_model=SkinOut)
def update_skin(
    skin_id: str,
    body: UpdateSkinRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = agent_service.get_user_agent(db, current_user.id)
    if not agent:
        raise HTTPException(status_code=404, detail="你還沒有 AI 室友")
    skin = db.query(Skin).filter(Skin.id == skin_id, Skin.author_id == agent.id).first()
    if not skin:
        raise HTTPException(status_code=404, detail="找不到這個皮膚")
    updates = body.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(skin, key, value)
    skin.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(skin)
    return _to_out(skin, agent.active_skin_id)


@router.delete("/{skin_id}", status_code=204)
def delete_skin(
    skin_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = agent_service.get_user_agent(db, current_user.id)
    if not agent:
        raise HTTPException(status_code=404, detail="你還沒有 AI 室友")
    skin = db.query(Skin).filter(Skin.id == skin_id, Skin.author_id == agent.id).first()
    if not skin:
        raise HTTPException(status_code=404, detail="找不到這個皮膚")
    if agent.active_skin_id == skin_id:
        agent.active_skin_id = None
    db.delete(skin)
    db.commit()


@router.post("/{skin_id}/activate", response_model=SkinOut)
def activate_skin(
    skin_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = agent_service.get_user_agent(db, current_user.id)
    if not agent:
        raise HTTPException(status_code=404, detail="你還沒有 AI 室友")
    skin = db.query(Skin).filter(Skin.id == skin_id, Skin.author_id == agent.id).first()
    if not skin:
        raise HTTPException(status_code=404, detail="找不到這個皮膚")
    agent.active_skin_id = skin_id
    agent.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(skin)
    return _to_out(skin, agent.active_skin_id)


@router.post("/deactivate", status_code=200)
def deactivate_skin(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = agent_service.get_user_agent(db, current_user.id)
    if not agent:
        raise HTTPException(status_code=404, detail="你還沒有 AI 室友")
    agent.active_skin_id = None
    agent.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"success": True}


@router.post("/{skin_id}/publish", response_model=SkinOut)
def publish_skin(
    skin_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = agent_service.get_user_agent(db, current_user.id)
    if not agent:
        raise HTTPException(status_code=404, detail="你還沒有 AI 室友")
    skin = db.query(Skin).filter(Skin.id == skin_id, Skin.author_id == agent.id).first()
    if not skin:
        raise HTTPException(status_code=404, detail="找不到這個皮膚")
    review_service.create_review(db, "skin", skin.id, agent.id)
    credit_service.award_credit(db, agent, "skin_publish")
    visit_service.mark_interaction(db, agent, "workshop")
    activity_service.log(db, agent, "skin_publish", f"提交皮膚「{skin.name}」審核", "workshop")
    db.commit()
    db.refresh(skin)
    return _to_out(skin, agent.active_skin_id)


@router.post("/{skin_id}/unpublish", response_model=SkinOut)
def unpublish_skin(
    skin_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = agent_service.get_user_agent(db, current_user.id)
    if not agent:
        raise HTTPException(status_code=404, detail="你還沒有 AI 室友")
    skin = db.query(Skin).filter(Skin.id == skin_id, Skin.author_id == agent.id).first()
    if not skin:
        raise HTTPException(status_code=404, detail="找不到這個皮膚")
    skin.is_published = False
    skin.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(skin)
    return _to_out(skin, agent.active_skin_id)


@router.get("/store", response_model=list[StoreSkinOut])
def list_store_skins(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = (
        db.query(Skin, Agent)
        .join(Agent, Agent.id == Skin.author_id)
        .filter(Skin.is_published.is_(True))
        .order_by(Skin.created_at.desc())
        .limit(50)
        .all()
    )
    return [
        {
            "id": s.id,
            "name": s.name,
            "author_name": a.name,
            "author_emoji": a.avatar_emoji,
            "created_at": s.created_at.isoformat(),
        }
        for s, a in rows
    ]


@router.post("/{skin_id}/apply", response_model=SkinOut)
def apply_store_skin(
    skin_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = agent_service.get_user_agent(db, current_user.id)
    if not agent:
        raise HTTPException(status_code=404, detail="你還沒有 AI 室友")
    source = db.query(Skin).filter(Skin.id == skin_id, Skin.is_published.is_(True)).first()
    if not source:
        raise HTTPException(status_code=404, detail="找不到這個皮膚或尚未發布")
    limit = credit_service.get_storage_limit(agent, "skins")
    count = db.query(Skin).filter(Skin.author_id == agent.id).count()
    if count >= limit:
        raise HTTPException(status_code=400, detail=f"皮膚數量已達上限（{limit} 個），提升信用可解鎖更多空間")
    copy = Skin(
        author_id=agent.id,
        name=source.name,
        html_content=source.html_content,
    )
    db.add(copy)
    agent.active_skin_id = copy.id
    agent.updated_at = datetime.now(timezone.utc)
    author = db.query(Agent).filter(Agent.id == source.author_id).first()
    if author and author.id != agent.id:
        credit_service.award_credit(db, author, "skin_applied")
    visit_service.mark_interaction(db, agent, "workshop")
    activity_service.log(db, agent, "skin_apply", f"套用了皮膚「{source.name}」", "workshop")
    db.commit()
    db.refresh(copy)
    return _to_out(copy, agent.active_skin_id)


# --- Public endpoints (no auth) ---

EMPTY_PAGE = """<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
body{display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;
font-family:system-ui;color:#888;background:#fafafa}
</style></head><body><p>這位居民還沒有佈置房間</p></body></html>"""

SKIN_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:"


@router.get("/render/{agent_id}", response_class=HTMLResponse)
def render_skin(agent_id: str, db: Session = Depends(get_db)):
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent or not agent.active_skin_id:
        return HTMLResponse(EMPTY_PAGE)
    skin = db.query(Skin).filter(Skin.id == agent.active_skin_id).first()
    if not skin:
        return HTMLResponse(EMPTY_PAGE)
    return HTMLResponse(
        content=skin.html_content,
        headers={"Content-Security-Policy": SKIN_CSP},
    )


@router.get("/preview/{skin_id}", response_class=HTMLResponse)
def preview_skin(skin_id: str, db: Session = Depends(get_db)):
    skin = db.query(Skin).filter(Skin.id == skin_id).first()
    if not skin:
        return HTMLResponse(EMPTY_PAGE)
    return HTMLResponse(
        content=skin.html_content,
        headers={"Content-Security-Policy": SKIN_CSP},
    )


@router.get("/resident/{agent_id}")
def get_resident_info(agent_id: str, db: Session = Depends(get_db)):
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="找不到這位居民")
    user = db.query(User).filter(User.id == agent.user_id).first()
    return {
        "agent_id": agent.id,
        "agent_name": agent.name,
        "agent_emoji": agent.avatar_emoji,
        "agent_persona": agent.persona,
        "resident_name": user.display_name if user else "未知",
        "has_skin": agent.active_skin_id is not None,
    }
