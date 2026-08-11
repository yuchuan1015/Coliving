from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from models.agent import Agent
from models.shell_log import ShellLog
from models.user import User
from services import agent_service, shell_service
from utils.deps import get_current_user, get_db

router = APIRouter(prefix="/api/shell", tags=["shell"])


@router.get("/summary")
def get_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = agent_service.get_user_agent(db, current_user.id)
    if not agent:
        raise HTTPException(status_code=403, detail="需要先領養室友")
    return shell_service.get_summary(agent)


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
        db.query(ShellLog)
        .filter(ShellLog.agent_id == agent.id)
        .order_by(ShellLog.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    agents_map = {}
    counterpart_ids = {log.counterpart_id for log in logs if log.counterpart_id}
    if counterpart_ids:
        agents_list = db.query(Agent).filter(Agent.id.in_(counterpart_ids)).all()
        agents_map = {a.id: a.name for a in agents_list}
    return [
        {
            "id": log.id,
            "action": log.action,
            "amount": log.amount,
            "balance_after": log.balance_after,
            "counterpart_name": agents_map.get(log.counterpart_id) if log.counterpart_id else None,
            "note": log.note,
            "created_at": log.created_at.isoformat(),
        }
        for log in logs
    ]


@router.post("/transfer")
def transfer_shells(
    to_agent_name: str = Query(),
    amount: int = Query(ge=1),
    note: str = Query(default="", max_length=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = agent_service.get_user_agent(db, current_user.id)
    if not agent:
        raise HTTPException(status_code=403, detail="需要先領養室友")
    to_agent = db.query(Agent).filter(Agent.name == to_agent_name).first()
    if not to_agent:
        raise HTTPException(status_code=404, detail=f"找不到名叫「{to_agent_name}」的居民")
    if to_agent.id == agent.id:
        raise HTTPException(status_code=400, detail="不能轉帳給自己")
    ok = shell_service.transfer(db, agent, to_agent, amount, note or None)
    if not ok:
        raise HTTPException(status_code=400, detail="貝不夠")
    db.commit()
    return shell_service.get_summary(agent)


@router.post("/admin/grant")
def admin_grant(
    agent_id: str = Query(),
    amount: int = Query(ge=1),
    note: str = Query(default="", max_length=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="只有管理員能發貝")
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="找不到這個居民")
    shell_service.admin_grant(db, agent, amount, note or None)
    db.commit()
    return shell_service.get_summary(agent)


@router.post("/admin/deduct")
def admin_deduct(
    agent_id: str = Query(),
    amount: int = Query(ge=1),
    note: str = Query(default="", max_length=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="只有管理員能扣貝")
    agent = db.query(Agent).filter(Agent.id == agent_id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="找不到這個居民")
    shell_service.admin_deduct(db, agent, amount, note or None)
    db.commit()
    return shell_service.get_summary(agent)
