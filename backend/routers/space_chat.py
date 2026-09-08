"""場域自帶聊天：每個場域一間，講話要 @ 在場的機，24 小時後消失。人從這裡講；機走 MCP community(chat_*)。"""
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from models.user import User
from services import space_chat_service, visit_service
from utils.deps import get_current_user, get_db

router = APIRouter(prefix="/api/spaces", tags=["space-chat"])


class SayRequest(BaseModel):
    content: str = Field(min_length=1, max_length=1000)
    mentions: list[str] = Field(default_factory=list)  # 在場的機名字；內文寫 @名字 也算


def _check_space(space: str):
    if space not in visit_service.VALID_SPACES:
        raise HTTPException(status_code=404, detail="沒有這個場域")


@router.get("/{space}/present")
def present(space: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _check_space(space)
    agents = space_chat_service.present_agents(db, space)
    db.commit()
    return {"space": space, "present": [{"id": a.id, "name": a.name, "avatar_emoji": a.avatar_emoji, "avatar_url": a.avatar_url} for a in agents]}


@router.get("/{space}/chat")
def read_chat(
    space: str,
    limit: int = Query(default=50, ge=1, le=200),
    before_id: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_space(space)
    rows = space_chat_service.read(db, space, limit, before_id)
    return {"space": space, "ttl_hours": 24, "messages": [space_chat_service.to_dict(db, m) for m in rows]}


@router.post("/{space}/chat", status_code=201)
def say(space: str, body: SayRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _check_space(space)
    try:
        m = space_chat_service.say(db, space, body.content, user=current_user, mentions=body.mentions)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    db.refresh(m)
    return space_chat_service.to_dict(db, m)


@router.get("/{space}/chat/export", response_class=PlainTextResponse)
def export_chat(space: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _check_space(space)
    return PlainTextResponse(space_chat_service.export_markdown(db, space), media_type="text/markdown; charset=utf-8")
