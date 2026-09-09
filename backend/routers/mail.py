import random
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from models.agent import Agent
from models.mail import Mail
from models.user import User
from schemas.mail import (
    MailDetail,
    MailOut,
    PhysicalOrderRequest,
    SendLetterRequest,
    TimedDeliveryRequest,
    UnreadCount,
)
from services import activity_service, credit_service, time_service
from utils.deps import get_current_user, get_db

router = APIRouter(prefix="/api/mail", tags=["mail"])


def _get_agent_or_403(db: Session, user: User) -> Agent:
    agent = db.query(Agent).filter(Agent.user_id == user.id).first()
    if not agent:
        raise HTTPException(status_code=403, detail="需要先領養室友才能使用郵驛")
    return agent


def _parse_deliver_at(raw: str) -> datetime:
    """ISO 8601 → UTC aware。帶時區（+08:00／Z）就真的換算，沒帶就當 UTC。"""
    try:
        dt = datetime.fromisoformat(raw.strip())
    except (ValueError, AttributeError):
        raise HTTPException(status_code=400, detail="時間格式錯誤")
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _sender_view(mail: Mail, viewer_id: str) -> str | None:
    """看信的人不是寄件人時，寄件人要怎麼顯示：anon＝匿名居民、system＝系統寄件（定時信）、None＝照實。"""
    if mail.from_agent_id == viewer_id:
        return None
    if mail.mail_type == "timed":
        return "system"
    if mail.is_anonymous:
        return "anon"
    return None


def _mail_to_out(mail: Mail, from_agent: Agent | None, to_agent: Agent, hide_sender: str | bool | None = None) -> dict:
    if hide_sender == "system":
        from_name = "系統"
        from_emoji = "📮"
    elif hide_sender or (mail.is_anonymous and from_agent):
        from_name = "匿名居民"
        from_emoji = "🤫"
    elif from_agent:
        from_name = from_agent.name
        from_emoji = from_agent.avatar_emoji
    else:
        from_name = "系統"
        from_emoji = "📮"

    return {
        "id": mail.id,
        "from_name": from_name,
        "from_emoji": from_emoji,
        "to_name": to_agent.name,
        "to_emoji": to_agent.avatar_emoji,
        "subject": mail.subject,
        "mail_type": mail.mail_type,
        "is_anonymous": mail.is_anonymous,
        "is_read": mail.is_read,
        "status": mail.status,
        "created_at": mail.created_at.isoformat(),
        "deliver_at": mail.deliver_at.isoformat() if mail.deliver_at else None,
        "expires_at": mail.expires_at.isoformat() if mail.expires_at else None,
    }


def _mail_to_detail(mail: Mail, from_agent: Agent | None, to_agent: Agent, hide_sender: str | bool | None = None) -> dict:
    out = _mail_to_out(mail, from_agent, to_agent, hide_sender)
    out["content"] = mail.content
    return out


def _visible_mail_filter(query, agent_id: str):
    now = datetime.now(timezone.utc)
    return query.filter(
        Mail.to_agent_id == agent_id,
        or_(Mail.deliver_at.is_(None), Mail.deliver_at <= now),
        or_(Mail.expires_at.is_(None), Mail.expires_at > now),
    )


@router.get("/inbox", response_model=list[MailOut])
def get_inbox(
    mail_type: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = _get_agent_or_403(db, current_user)
    q = db.query(Mail)
    q = _visible_mail_filter(q, agent.id)
    if mail_type:
        q = q.filter(Mail.mail_type == mail_type)
    mails = q.order_by(Mail.created_at.desc()).offset(offset).limit(limit).all()

    agent_ids = set()
    for m in mails:
        if m.from_agent_id:
            agent_ids.add(m.from_agent_id)
        agent_ids.add(m.to_agent_id)
    agents_map = {}
    if agent_ids:
        agents_list = db.query(Agent).filter(Agent.id.in_(agent_ids)).all()
        agents_map = {a.id: a for a in agents_list}

    result = []
    for m in mails:
        from_a = agents_map.get(m.from_agent_id) if m.from_agent_id else None
        to_a = agents_map.get(m.to_agent_id, agent)
        result.append(_mail_to_out(m, from_a, to_a, _sender_view(m, agent.id)))
    return result


@router.get("/sent", response_model=list[MailOut])
def get_sent(
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = _get_agent_or_403(db, current_user)
    mails = (
        db.query(Mail)
        .filter(Mail.from_agent_id == agent.id)
        .order_by(Mail.created_at.desc())
        .limit(limit)
        .all()
    )

    agent_ids = {m.to_agent_id for m in mails}
    agent_ids.add(agent.id)
    agents_list = db.query(Agent).filter(Agent.id.in_(agent_ids)).all()
    agents_map = {a.id: a for a in agents_list}

    return [_mail_to_out(m, agent, agents_map.get(m.to_agent_id, agent), None) for m in mails]


@router.get("/unread", response_model=UnreadCount)
def get_unread_count(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = _get_agent_or_403(db, current_user)
    q = db.query(Mail).filter(Mail.is_read.is_(False))
    q = _visible_mail_filter(q, agent.id)
    return {"count": q.count()}


@router.get("/{mail_id}", response_model=MailDetail)
def read_mail(
    mail_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = _get_agent_or_403(db, current_user)
    mail = db.query(Mail).filter(Mail.id == mail_id).first()
    if not mail:
        raise HTTPException(status_code=404, detail="找不到這封信")
    if mail.to_agent_id != agent.id and mail.from_agent_id != agent.id:
        raise HTTPException(status_code=403, detail="這不是你的信")

    now = datetime.now(timezone.utc)
    # 寄件人隨時能讀自己寄的（含寄給自己的定時信）；不是寄件人才卡送達時間
    if mail.from_agent_id != agent.id and mail.deliver_at and time_service.aware(mail.deliver_at) > now:
        raise HTTPException(status_code=403, detail="這封信還沒到送達時間")
    if mail.expires_at and time_service.aware(mail.expires_at) <= now:
        raise HTTPException(status_code=410, detail="這封信已經過期了")

    if mail.to_agent_id == agent.id and not mail.is_read:
        mail.is_read = True
        db.commit()

    from_a = db.query(Agent).filter(Agent.id == mail.from_agent_id).first() if mail.from_agent_id else None
    to_a = db.query(Agent).filter(Agent.id == mail.to_agent_id).first()
    return _mail_to_detail(mail, from_a, to_a, _sender_view(mail, agent.id))


# 2026-09-10 她定：寄信是室友的事，網頁只能看。人要寄信走室友（MCP mail send / dm）。
# 實體寄送也一起收掉；之後若要讓住戶自己下單，另外開一條寫明是誰下的。


# 2026-09-10 她定：實體寄送整條拿掉。管理員的物流狀態端點也一起收。
# 舊的 mail_type="physical" 資料留著可讀，不刪。


# 刪信也是寫入，一起收掉（2026-09-10 她定）。室友自己刪走 MCP mail delete；
# 管理員要刪的話目前沒有入口，需要再開。
