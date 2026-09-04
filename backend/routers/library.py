from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from models.agent import Agent
from models.book_club import BookClub, BookClubReply
from models.user import User
from models.work import Work
from schemas.library import (
    BookClubDetail,
    BookClubOut,
    BookClubReplyOut,
    CreateBookClubRequest,
    CreateReplyRequest,
    CreateWorkRequest,
    UpdateWorkRequest,
    WorkDetail,
    WorkOut,
)
from services import library_service
from utils.deps import get_current_user, get_db

router = APIRouter(prefix="/api/library", tags=["library"])

CATEGORY_LABELS = library_service.CATEGORY_LABELS


def _get_agent_or_403(db: Session, user: User) -> Agent:
    agent = db.query(Agent).filter(Agent.user_id == user.id).first()
    if not agent:
        raise HTTPException(status_code=403, detail="需要先領養室友才能使用圖書館")
    return agent


def _work_to_out(work: Work, agent: Agent, current_agent_id: str) -> dict:
    return {
        "id": work.id,
        "title": work.title,
        "category": work.category,
        "source": work.source,
        "author_name": agent.name,
        "author_emoji": agent.avatar_emoji,
        "word_count": len(work.content),
        "is_mine": work.author_id == current_agent_id,
        "created_at": work.created_at.isoformat(),
    }


def _work_to_detail(work: Work, agent: Agent, current_agent_id: str) -> dict:
    return {
        "id": work.id,
        "title": work.title,
        "content": work.content,
        "category": work.category,
        "source": work.source,
        "author_name": agent.name,
        "author_emoji": agent.avatar_emoji,
        "word_count": len(work.content),
        "is_mine": work.author_id == current_agent_id,
        "created_at": work.created_at.isoformat(),
        "updated_at": work.updated_at.isoformat() if work.updated_at else None,
    }


# ── Works ──


@router.get("/works", response_model=list[WorkOut])
def list_works(
    category: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    my_agent = _get_agent_or_403(db, current_user)
    rows = library_service.list_works(db, category=category, limit=limit, offset=offset)
    return [_work_to_out(w, a, my_agent.id) for w, a in rows]


@router.post("/works", response_model=WorkDetail, status_code=201)
def create_work(
    body: CreateWorkRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = _get_agent_or_403(db, current_user)
    try:
        work = library_service.create_work(
            db, agent, title=body.title, content=body.content,
            category=body.category, source=body.source,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    db.refresh(work)
    return _work_to_detail(work, agent, agent.id)


@router.get("/works/{work_id}", response_model=WorkDetail)
def get_work(
    work_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    my_agent = _get_agent_or_403(db, current_user)
    row = library_service.get_work(db, work_id)
    if not row:
        raise HTTPException(status_code=404, detail="找不到這篇作品")
    work, author = row
    return _work_to_detail(work, author, my_agent.id)


@router.patch("/works/{work_id}", response_model=WorkDetail)
def update_work(
    work_id: str,
    body: UpdateWorkRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = _get_agent_or_403(db, current_user)
    work = db.query(Work).filter(Work.id == work_id).first()
    if not work:
        raise HTTPException(status_code=404, detail="找不到這篇作品")
    if work.author_id != agent.id:
        raise HTTPException(status_code=403, detail="只能編輯自己的作品")
    library_service.update_work(db, work, title=body.title, content=body.content, category=body.category, source=body.source)
    db.commit()
    db.refresh(work)
    return _work_to_detail(work, agent, agent.id)


@router.delete("/works/{work_id}", status_code=204)
def delete_work(
    work_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = _get_agent_or_403(db, current_user)
    work = db.query(Work).filter(Work.id == work_id).first()
    if not work:
        raise HTTPException(status_code=404, detail="找不到這篇作品")
    if work.author_id != agent.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="只能刪除自己的作品")
    db.delete(work)
    db.commit()


# ── Book Clubs ──


@router.get("/clubs", response_model=list[BookClubOut])
def list_clubs(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    my_agent = _get_agent_or_403(db, current_user)
    rows = library_service.list_clubs(db, limit=limit, offset=offset)
    return [
        {
            "id": club.id,
            "book_title": club.book_title,
            "book_author": club.book_author,
            "topic": club.topic,
            "host_name": host.name,
            "host_emoji": host.avatar_emoji,
            "reply_count": cnt or 0,
            "is_mine": club.host_id == my_agent.id,
            "created_at": club.created_at.isoformat(),
        }
        for club, host, cnt in rows
    ]


@router.post("/clubs", response_model=BookClubOut, status_code=201)
def create_club(
    body: CreateBookClubRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = _get_agent_or_403(db, current_user)
    club = library_service.create_club(db, agent, book_title=body.book_title, topic=body.topic, book_author=body.book_author)
    db.commit()
    db.refresh(club)
    return {
        "id": club.id,
        "book_title": club.book_title,
        "book_author": club.book_author,
        "topic": club.topic,
        "host_name": agent.name,
        "host_emoji": agent.avatar_emoji,
        "reply_count": 0,
        "is_mine": True,
        "created_at": club.created_at.isoformat(),
    }


@router.get("/clubs/{club_id}", response_model=BookClubDetail)
def get_club(
    club_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    my_agent = _get_agent_or_403(db, current_user)
    row = library_service.get_club(db, club_id)
    if not row:
        raise HTTPException(status_code=404, detail="找不到這個讀書會")
    club, host = row
    replies_rows = library_service.list_replies(db, club_id)
    replies = [
        {
            "id": r.id,
            "author_name": a.name,
            "author_emoji": a.avatar_emoji,
            "content": r.content,
            "is_mine": r.author_id == my_agent.id,
            "created_at": r.created_at.isoformat(),
        }
        for r, a in replies_rows
    ]
    return {
        "id": club.id,
        "book_title": club.book_title,
        "book_author": club.book_author,
        "topic": club.topic,
        "host_name": host.name,
        "host_emoji": host.avatar_emoji,
        "is_mine": club.host_id == my_agent.id,
        "created_at": club.created_at.isoformat(),
        "replies": replies,
    }


@router.post("/clubs/{club_id}/reply", response_model=BookClubReplyOut, status_code=201)
def create_reply(
    club_id: str,
    body: CreateReplyRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = _get_agent_or_403(db, current_user)
    club = db.query(BookClub).filter(BookClub.id == club_id).first()
    if not club:
        raise HTTPException(status_code=404, detail="找不到這個讀書會")
    reply = library_service.create_reply(db, agent, club, body.content)
    db.commit()
    db.refresh(reply)
    return {
        "id": reply.id,
        "author_name": agent.name,
        "author_emoji": agent.avatar_emoji,
        "content": reply.content,
        "is_mine": True,
        "created_at": reply.created_at.isoformat(),
    }


@router.delete("/clubs/{club_id}", status_code=204)
def delete_club(
    club_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = _get_agent_or_403(db, current_user)
    club = db.query(BookClub).filter(BookClub.id == club_id).first()
    if not club:
        raise HTTPException(status_code=404, detail="找不到這個讀書會")
    if club.host_id != agent.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="只有主持人能刪除讀書會")
    library_service.delete_club(db, club)
    db.commit()
