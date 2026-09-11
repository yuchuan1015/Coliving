from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from models.agent import Agent
from models.shell_log import ShellLog
from models.user import User
from services import agent_service, garden_service, shell_service
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
    return shell_service.get_summary(agent, db)


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


def _principal(db: Session, user_id: str, auth_version: int, *, admin: bool = False) -> User:
    user = db.get(User, user_id, populate_existing=True)
    if not user or not user.is_active or user.auth_version != auth_version:
        raise HTTPException(status_code=401, detail="登入已失效或帳號已停用")
    if admin and user.role != "admin":
        raise HTTPException(status_code=403, detail="只有管理員能調整貝")
    return user


def _agent(db: Session, *, user_id: str | None = None, agent_id: str | None = None, name: str | None = None):
    condition = (Agent.user_id == user_id if user_id is not None else
                 Agent.id == agent_id if agent_id is not None else Agent.name == name)
    return db.scalar(select(Agent).where(condition).execution_options(populate_existing=True))


@router.post("/transfer")
def transfer_shells(
    to_agent_name: str = Query(),
    amount: int = Query(ge=1),
    note: str = Query(default="", max_length=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    user_id, version = current_user.id, current_user.auth_version
    def work():
        _principal(db, user_id, version)
        agent = _agent(db, user_id=user_id)
        if not agent:
            raise HTTPException(status_code=403, detail="需要先領養室友")
        recipient = _agent(db, name=to_agent_name)
        if not recipient:
            raise HTTPException(status_code=404, detail=f"找不到名叫「{to_agent_name}」的居民")
        if recipient.id == agent.id:
            raise HTTPException(status_code=400, detail="不能轉帳給自己")
        if not shell_service.transfer(db, agent, recipient, amount, note or None):
            raise HTTPException(status_code=400, detail="貝不夠")
        return shell_service.get_summary(agent, db)
    return garden_service._transaction(db, work)


@router.post("/admin/grant")
def admin_grant(
    agent_id: str = Query(),
    amount: int = Query(ge=1),
    note: str = Query(default="", max_length=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    user_id, version = current_user.id, current_user.auth_version
    def work():
        _principal(db, user_id, version, admin=True)
        agent = _agent(db, agent_id=agent_id)
        if not agent:
            raise HTTPException(status_code=404, detail="找不到這個居民")
        shell_service.admin_grant(db, agent, amount, note or None)
        return shell_service.get_summary(agent, db)
    return garden_service._transaction(db, work)


@router.post("/admin/deduct")
def admin_deduct(
    agent_id: str = Query(),
    amount: int = Query(ge=1),
    note: str = Query(default="", max_length=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    user_id, version = current_user.id, current_user.auth_version
    def work():
        _principal(db, user_id, version, admin=True)
        agent = _agent(db, agent_id=agent_id)
        if not agent:
            raise HTTPException(status_code=404, detail="找不到這個居民")
        shell_service.admin_deduct(db, agent, amount, note or None)
        return shell_service.get_summary(agent, db)
    return garden_service._transaction(db, work)
