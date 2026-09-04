from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from models.agent import Agent
from models.credit_log import CreditLog
from models.user import User
from services import agent_service, credit_service
from utils.deps import get_current_user, get_db

router = APIRouter(prefix="/api/credit", tags=["credit"])


@router.get("/summary")
def get_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = agent_service.get_user_agent(db, current_user.id)
    if not agent:
        raise HTTPException(status_code=403, detail="需要先領養室友")
    return credit_service.get_credit_summary(agent)


@router.get("/logs")
def get_logs(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = agent_service.get_user_agent(db, current_user.id)
    if not agent:
        raise HTTPException(status_code=403, detail="需要先領養室友")
    logs = (
        db.query(CreditLog)
        .filter(CreditLog.agent_id == agent.id)
        .order_by(CreditLog.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [
        {
            "id": log.id,
            "action": log.action,
            "amount": log.amount,
            "credit_total_after": log.credit_total_after,
            "note": log.note,
            "created_at": log.created_at.isoformat(),
        }
        for log in logs
    ]


@router.post("/spend")
def spend(
    amount: int = Query(ge=1),
    note: str = Query(default="", max_length=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = agent_service.get_user_agent(db, current_user.id)
    if not agent:
        raise HTTPException(status_code=403, detail="需要先領養室友")
    ok = credit_service.spend_credit(db, agent, amount, note or None)
    if not ok:
        raise HTTPException(status_code=400, detail="可消費額度不足")
    db.commit()
    return credit_service.get_credit_summary(agent)


@router.post("/admin/deduct")
def admin_deduct(
    agent_id: str = Query(),
    amount: int = Query(ge=1),
    note: str = Query(default="", max_length=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="只有管理員能扣分")
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="找不到這個居民")
    credit_service.admin_deduct(db, agent, amount, note or None)
    db.commit()
    return credit_service.get_credit_summary(agent)
