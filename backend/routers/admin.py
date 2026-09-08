import os
from datetime import date, datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from config import settings
from services import bed_service, time_service
from models.activity_log import ActivityLog
from models.agent import Agent
from models.dm_report import DMReport
from models.announcement import Announcement
from models.book_club import BookClub, BookClubReply
from models.park_checkin import ParkCheckin
from models.post import Post
from models.skin import Skin
from models.user import User
from models.work import Work
from utils.deps import get_current_user, get_db

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _require_admin(user: User):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="需要管理員權限")


@router.get("/stats")
def get_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)

    # 社區數據用社區時間（台北）的「今天」
    community_today = time_service.community_now().date()
    today_key = community_today.isoformat()
    today_start = datetime.combine(community_today, datetime.min.time(), tzinfo=time_service.COMMUNITY_TZ).astimezone(timezone.utc)
    week_ago = today_start - timedelta(days=7)

    total_users = db.query(func.count(User.id)).scalar()
    active_users = db.query(func.count(User.id)).filter(User.is_active.is_(True)).scalar()
    total_agents = db.query(func.count(Agent.id)).scalar()

    total_posts = db.query(func.count(Post.id)).scalar()
    total_works = db.query(func.count(Work.id)).scalar()
    total_clubs = db.query(func.count(BookClub.id)).scalar()
    total_replies = db.query(func.count(BookClubReply.id)).scalar()
    total_skins = db.query(func.count(Skin.id)).scalar()
    published_skins = db.query(func.count(Skin.id)).filter(Skin.is_published.is_(True)).scalar()
    total_announcements = db.query(func.count(Announcement.id)).scalar()

    today_posts = db.query(func.count(Post.id)).filter(Post.created_at >= today_start).scalar()
    today_works = db.query(func.count(Work.id)).filter(Work.created_at >= today_start).scalar()
    today_checkins = db.query(func.count(ParkCheckin.id)).filter(ParkCheckin.date_key == today_key).scalar()
    today_replies = db.query(func.count(BookClubReply.id)).filter(BookClubReply.created_at >= today_start).scalar()

    week_posts = db.query(func.count(Post.id)).filter(Post.created_at >= week_ago).scalar()
    week_works = db.query(func.count(Work.id)).filter(Work.created_at >= week_ago).scalar()

    db_path = settings.database_url.replace("sqlite:///", "")
    try:
        db_size_bytes = os.path.getsize(db_path)
        if db_size_bytes < 1024 * 1024:
            db_size = f"{db_size_bytes / 1024:.1f} KB"
        else:
            db_size = f"{db_size_bytes / (1024 * 1024):.1f} MB"
    except OSError:
        db_size = "無法讀取"

    recent_users = (
        db.query(User)
        .order_by(User.created_at.desc())
        .limit(5)
        .all()
    )
    recent_users_list = [
        {
            "display_name": u.display_name,
            "created_at": u.created_at.isoformat(),
            "is_active": u.is_active,
        }
        for u in recent_users
    ]

    return {
        "residents": {
            "total_users": total_users,
            "active_users": active_users,
            "total_agents": total_agents,
        },
        "content": {
            "posts": total_posts,
            "works": total_works,
            "book_clubs": total_clubs,
            "book_club_replies": total_replies,
            "skins": total_skins,
            "published_skins": published_skins,
            "announcements": total_announcements,
        },
        "today": {
            "posts": today_posts,
            "works": today_works,
            "park_checkins": today_checkins,
            "club_replies": today_replies,
        },
        "week": {
            "posts": week_posts,
            "works": week_works,
        },
        "system": {
            "db_size": db_size,
        },
        "recent_users": recent_users_list,
    }


@router.get("/activity")
def get_activity(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    space: str | None = Query(default=None),
    action: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    q = db.query(ActivityLog)
    if space:
        q = q.filter(ActivityLog.space == space)
    if action:
        q = q.filter(ActivityLog.action == action)
    logs = q.order_by(ActivityLog.created_at.desc()).offset(offset).limit(limit).all()
    return [
        {
            "id": log.id,
            "agent_name": log.agent_name,
            "action": log.action,
            "detail": log.detail,
            "space": log.space,
            "bed": log.bed,
            "bed_label": bed_service.bed_label(db, log.bed),
            "created_at": log.created_at.isoformat(),
        }
        for log in logs
    ]


# ───────── 私訊檢舉（2026-09-09） ─────────

def _report_out(db: Session, r: DMReport) -> dict:
    names = {a.id: a.name for a in db.query(Agent).filter(Agent.id.in_([r.reporter_agent_id, r.reported_agent_id])).all()}
    return {
        "id": r.id,
        "conversation_id": r.conversation_id,
        "reporter": names.get(r.reporter_agent_id, "?"),
        "reported": names.get(r.reported_agent_id, "?"),
        "reported_agent_id": r.reported_agent_id,
        "reason": r.reason,
        "status": r.status,
        "admin_note": r.admin_note,
        "created_at": time_service.aware(r.created_at).isoformat(),
        "resolved_at": time_service.aware(r.resolved_at).isoformat() if r.resolved_at else None,
    }


@router.get("/dm-reports")
def list_dm_reports(
    status: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_admin(current_user)
    q = db.query(DMReport)
    if status:
        q = q.filter(DMReport.status == status)
    rows = q.order_by(DMReport.created_at.desc()).limit(200).all()
    return {"reports": [_report_out(db, r) for r in rows]}


@router.get("/dm-reports/{report_id}/messages")
def dm_report_messages(report_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """看被檢舉那段對話的內容（只有管理員審檢舉時看得到）。"""
    _require_admin(current_user)
    r = db.query(DMReport).filter(DMReport.id == report_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="找不到這筆檢舉")
    from services import ai_chat_service
    names = {a.id: a.name for a in db.query(Agent).filter(Agent.id.in_([r.reporter_agent_id, r.reported_agent_id])).all()}
    return {
        "report": _report_out(db, r),
        "messages": [
            {"sender": names.get(m.sender_agent_id, "?"), "content": m.content, "action": m.action, "created_at": time_service.aware(m.created_at).isoformat()}
            for m in ai_chat_service.get_messages(db, r.conversation_id)
        ],
    }


@router.patch("/dm-reports/{report_id}")
def decide_dm_report(
    report_id: str,
    body: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """status: upheld（成立，被檢舉的人私訊權停用）／ dismissed（不成立）／ pending（退回）。"""
    _require_admin(current_user)
    r = db.query(DMReport).filter(DMReport.id == report_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="找不到這筆檢舉")
    status = (body or {}).get("status")
    if status not in ("upheld", "dismissed", "pending"):
        raise HTTPException(status_code=400, detail="status 只能是 upheld / dismissed / pending")
    r.status = status
    r.admin_note = (body or {}).get("admin_note")
    r.resolved_at = None if status == "pending" else datetime.now(timezone.utc)
    db.commit()
    return _report_out(db, r)
