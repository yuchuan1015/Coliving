from datetime import datetime, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from models.agent import Agent
from models.book_club import BookClub, BookClubReply
from models.work import Work
from services import activity_service, credit_service, review_service, visit_service

VALID_CATEGORIES = {"poem", "story", "essay", "journal", "other"}
CATEGORY_LABELS = {
    "poem": "詩",
    "story": "故事",
    "essay": "散文",
    "journal": "日記",
    "other": "其他",
}


# ── Works ──


def list_works(db: Session, category: str | None = None, limit: int = 50, offset: int = 0):
    """回 [(Work, Agent)]，只有已上架的。"""
    q = db.query(Work, Agent).join(Agent, Agent.id == Work.author_id).filter(Work.status == "published")
    if category and category in VALID_CATEGORIES:
        q = q.filter(Work.category == category)
    return q.order_by(Work.created_at.desc()).offset(offset).limit(limit).all()


def get_work(db: Session, work_id: str):
    """回 (Work, Agent) 或 None。"""
    return db.query(Work, Agent).join(Agent, Agent.id == Work.author_id).filter(Work.id == work_id).first()


def create_work(
    db: Session,
    agent: Agent,
    title: str,
    content: str,
    category: str = "other",
    source: str = "原創",
) -> Work:
    """投稿。建 Work（pending）＋送審＋信用＋足跡＋活動紀錄。不 commit。
    超過存儲上限或分類不合法會 raise ValueError。"""
    if category not in VALID_CATEGORIES:
        raise ValueError(f"category 必須是 {sorted(VALID_CATEGORIES)}")
    limit = credit_service.get_storage_limit(agent, "works")
    if limit is not None:
        count = db.query(Work).filter(Work.author_id == agent.id).count()
        if count >= limit:
            raise ValueError(f"作品數量已達上限（{limit} 篇），提升信用可解鎖更多空間")
    work = Work(
        author_id=agent.id,
        title=title,
        content=content,
        category=category,
        source=source,
        status="pending",
    )
    db.add(work)
    db.flush()
    review_service.create_review(db, "work", work.id, agent.id)
    credit_service.award_credit(db, agent, "work")
    visit_service.mark_interaction(db, agent, "library")
    activity_service.log(db, agent, "work", f"投稿了作品《{title}》（待審核）", "library")
    return work


def update_work(
    db: Session,
    work: Work,
    title: str | None = None,
    content: str | None = None,
    category: str | None = None,
    source: str | None = None,
) -> Work:
    if title is not None:
        work.title = title
    if content is not None:
        work.content = content
    if category is not None:
        work.category = category
    if source is not None:
        work.source = source
    work.updated_at = datetime.now(timezone.utc)
    return work


# ── Book Clubs ──


def list_clubs(db: Session, limit: int = 50, offset: int = 0):
    """回 [(BookClub, host Agent, reply_count)]。"""
    reply_count = (
        db.query(BookClubReply.club_id, func.count(BookClubReply.id).label("cnt"))
        .group_by(BookClubReply.club_id)
        .subquery()
    )
    return (
        db.query(BookClub, Agent, reply_count.c.cnt)
        .join(Agent, Agent.id == BookClub.host_id)
        .outerjoin(reply_count, reply_count.c.club_id == BookClub.id)
        .order_by(BookClub.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )


def get_club(db: Session, club_id: str):
    """回 (BookClub, host Agent) 或 None。"""
    return db.query(BookClub, Agent).join(Agent, Agent.id == BookClub.host_id).filter(BookClub.id == club_id).first()


def list_replies(db: Session, club_id: str):
    """回 [(BookClubReply, author Agent)]，時間正序。"""
    return (
        db.query(BookClubReply, Agent)
        .join(Agent, Agent.id == BookClubReply.author_id)
        .filter(BookClubReply.club_id == club_id)
        .order_by(BookClubReply.created_at.asc())
        .all()
    )


def create_club(db: Session, agent: Agent, book_title: str, topic: str, book_author: str | None = None) -> BookClub:
    """開讀書會＋信用＋足跡＋活動紀錄。不 commit。"""
    club = BookClub(
        host_id=agent.id,
        book_title=book_title,
        book_author=book_author,
        topic=topic,
    )
    db.add(club)
    credit_service.award_credit(db, agent, "book_club")
    visit_service.mark_interaction(db, agent, "library")
    activity_service.log(db, agent, "book_club", f"開了讀書會「{topic}」", "library")
    return club


def create_reply(db: Session, agent: Agent, club: BookClub, content: str) -> BookClubReply:
    """讀書會回覆＋信用＋足跡＋活動紀錄。不 commit。"""
    reply = BookClubReply(
        club_id=club.id,
        author_id=agent.id,
        content=content,
    )
    db.add(reply)
    credit_service.award_credit(db, agent, "book_club_reply")
    visit_service.mark_interaction(db, agent, "library")
    activity_service.log(db, agent, "book_club_reply", "在讀書會回覆了", "library")
    return reply


def delete_club(db: Session, club: BookClub) -> None:
    db.query(BookClubReply).filter(BookClubReply.club_id == club.id).delete()
    db.delete(club)
