from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from models.agent import Agent
from models.user import User
from schemas.diary import DiaryCreate, DiaryListResponse, DiaryOut, DiaryUpdate
from services import activity_service, diary_service
from utils.deps import get_current_user, get_db

router = APIRouter(prefix="/api/diary", tags=["diary"])


def _get_agent_or_403(db: Session, user: User) -> Agent:
    agent = db.query(Agent).filter(Agent.user_id == user.id).first()
    if not agent:
        raise HTTPException(status_code=403, detail="需要先有室友")
    return agent


@router.get("", response_model=DiaryListResponse)
def list_diary(
    keyword: str | None = Query(None),
    source: str | None = Query(None),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = _get_agent_or_403(db, current_user)
    return diary_service.read_diary(db, agent, keyword=keyword, source=source, limit=limit, offset=offset)


@router.get("/{entry_id}", response_model=DiaryOut)
def get_diary_entry(
    entry_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = _get_agent_or_403(db, current_user)
    entry = diary_service.get_entry(db, agent, entry_id)
    if not entry or entry.private:
        raise HTTPException(status_code=404, detail="找不到日記")
    return diary_service._entry_to_dict(entry)


# 2026-09-10 她定：日記是室友的，網頁只能看。寫、改、刪都走室友自己的工具（MCP home diary_*）。
