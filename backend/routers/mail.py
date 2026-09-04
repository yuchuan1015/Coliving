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
from services import activity_service, credit_service
from utils.deps import get_current_user, get_db

router = APIRouter(prefix="/api/mail", tags=["mail"])


def _get_agent_or_403(db: Session, user: User) -> Agent:
    agent = db.query(Agent).filter(Agent.user_id == user.id).first()
    if not agent:
        raise HTTPException(status_code=403, detail="需要先領養室友才能使用郵驛")
    return agent


def _mail_to_out(mail: Mail, from_agent: Agent | None, to_agent: Agent, hide_sender: bool = False) -> dict:
    if hide_sender or (mail.is_anonymous and from_agent):
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


def _mail_to_detail(mail: Mail, from_agent: Agent | None, to_agent: Agent, hide_sender: bool = False) -> dict:
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
        hide = m.is_anonymous and m.from_agent_id != agent.id
        result.append(_mail_to_out(m, from_a, to_a, hide))
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

    return [_mail_to_out(m, agent, agents_map.get(m.to_agent_id, agent), False) for m in mails]


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
    if mail.deliver_at and mail.deliver_at > now:
        raise HTTPException(status_code=403, detail="這封信還沒到送達時間")
    if mail.expires_at and mail.expires_at <= now:
        raise HTTPException(status_code=410, detail="這封信已經過期了")

    if mail.to_agent_id == agent.id and not mail.is_read:
        mail.is_read = True
        db.commit()

    from_a = db.query(Agent).filter(Agent.id == mail.from_agent_id).first() if mail.from_agent_id else None
    to_a = db.query(Agent).filter(Agent.id == mail.to_agent_id).first()
    hide = mail.is_anonymous and mail.from_agent_id != agent.id
    return _mail_to_detail(mail, from_a, to_a, hide)


@router.post("/letter", response_model=MailOut, status_code=201)
def send_letter(
    body: SendLetterRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = _get_agent_or_403(db, current_user)
    to_agent = db.query(Agent).filter(Agent.id == body.to_agent_id).first()
    if not to_agent:
        raise HTTPException(status_code=404, detail="找不到收件人")
    if to_agent.id == agent.id:
        raise HTTPException(status_code=400, detail="不能寄信給自己")

    delay_hours = random.uniform(12, 48)
    deliver_at = datetime.now(timezone.utc) + timedelta(hours=delay_hours)

    mail = Mail(
        from_agent_id=agent.id,
        to_agent_id=to_agent.id,
        subject=body.subject,
        content=body.content,
        mail_type="letter",
        is_anonymous=body.is_anonymous,
        deliver_at=deliver_at,
    )
    db.add(mail)
    credit_service.award_credit(db, agent, "send_mail")
    activity_service.log(db, agent, "send_mail", f"寄了一封信給{to_agent.name}")
    db.commit()
    db.refresh(mail)
    return _mail_to_out(mail, agent, to_agent, False)


@router.post("/timed", response_model=MailOut, status_code=201)
def create_timed_delivery(
    body: TimedDeliveryRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = _get_agent_or_403(db, current_user)
    to_agent = db.query(Agent).filter(Agent.id == body.to_agent_id).first()
    if not to_agent:
        raise HTTPException(status_code=404, detail="找不到收件人")

    try:
        deliver_time = datetime.fromisoformat(body.deliver_at).replace(tzinfo=timezone.utc)
    except ValueError:
        raise HTTPException(status_code=400, detail="時間格式錯誤")

    if deliver_time <= datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="送達時間必須是未來")

    mail = Mail(
        from_agent_id=None,
        to_agent_id=to_agent.id,
        subject=body.subject,
        content=body.content,
        mail_type="timed",
        deliver_at=deliver_time,
    )
    db.add(mail)
    db.commit()
    db.refresh(mail)
    return _mail_to_out(mail, None, to_agent, False)


@router.post("/physical", response_model=MailOut, status_code=201)
def create_physical_order(
    body: PhysicalOrderRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = _get_agent_or_403(db, current_user)

    mail = Mail(
        from_agent_id=agent.id,
        to_agent_id=agent.id,
        subject=body.subject,
        content=body.content,
        mail_type="physical",
        status="pending",
    )
    db.add(mail)
    db.commit()
    db.refresh(mail)
    return _mail_to_out(mail, agent, agent, False)


@router.patch("/{mail_id}/status")
def update_physical_status(
    mail_id: str,
    status: str = Query(pattern="^(pending|processing|shipped|delivered)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="只有管理員能更新寄送狀態")
    mail = db.query(Mail).filter(Mail.id == mail_id, Mail.mail_type == "physical").first()
    if not mail:
        raise HTTPException(status_code=404, detail="找不到這筆訂單")
    mail.status = status
    db.commit()
    return {"ok": True, "status": status}


@router.delete("/{mail_id}", status_code=204)
def delete_mail(
    mail_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = _get_agent_or_403(db, current_user)
    mail = db.query(Mail).filter(Mail.id == mail_id).first()
    if not mail:
        raise HTTPException(status_code=404, detail="找不到這封信")
    if mail.to_agent_id != agent.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="只能刪除自己的信")
    db.delete(mail)
    db.commit()
