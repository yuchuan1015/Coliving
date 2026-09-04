from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from models.agent import Agent
from models.user import User
from models.weilan import WeilanTable
from schemas.weilan import TableCreate, TableDetail, TableOut, WeilanResponse
from services import weilan_service
from utils.deps import get_current_user, get_db

router = APIRouter(prefix="/api/weilan", tags=["weilan"])


def _get_agent_or_403(db: Session, user: User) -> Agent:
    agent = db.query(Agent).filter(Agent.user_id == user.id).first()
    if not agent:
        raise HTTPException(status_code=403, detail="需要先有室友")
    return agent


def _table_to_out(table: WeilanTable, db: Session) -> dict:
    host = db.query(Agent).filter(Agent.id == table.host_id).first()
    count = weilan_service.seat_count(db, table.id)
    return {
        "id": table.id,
        "host_name": host.name if host else "???",
        "host_emoji": host.avatar_emoji if host else "🤖",
        "title": table.title,
        "activity_type": table.activity_type,
        "activity_name": weilan_service.ACTIVITY_NAMES.get(table.activity_type, table.activity_type),
        "density": table.density,
        "density_name": weilan_service.DENSITY_NAMES.get(table.density, ""),
        "max_seats": table.max_seats,
        "current_seats": count,
        "is_active": table.is_active,
        "created_at": table.created_at.isoformat(),
    }


@router.get("", response_model=WeilanResponse)
def get_weilan(
    density: str | None = Query(None, pattern="^(high|mid|low)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_agent_or_403(db, current_user)
    tables = weilan_service.list_tables(db, density=density)

    density_counts = weilan_service.table_counts_by_density(db)

    activity_types = {}
    for d, types in weilan_service.ACTIVITY_TYPES.items():
        activity_types[d] = [{"key": t, "name": weilan_service.ACTIVITY_NAMES.get(t, t)} for t in types]

    return {
        "tables": [_table_to_out(t, db) for t in tables],
        "density_counts": density_counts,
        "activity_types": activity_types,
    }


@router.post("/open", status_code=201)
def open_table(
    body: TableCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = _get_agent_or_403(db, current_user)
    try:
        table = weilan_service.open_table(
            db, agent,
            title=body.title,
            activity_type=body.activity_type,
            density=body.density,
            max_seats=body.max_seats,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    db.refresh(table)
    return _table_to_out(table, db)


@router.get("/{table_id}")
def get_table_detail(
    table_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_agent_or_403(db, current_user)
    table = weilan_service.get_table(db, table_id)
    if not table:
        raise HTTPException(status_code=404, detail="找不到這張桌子")

    out = _table_to_out(table, db)
    out["seats"] = [
        {"agent_name": a.name, "agent_emoji": a.avatar_emoji, "joined_at": s.joined_at.isoformat()}
        for s, a in weilan_service.get_seats(db, table_id)
    ]
    return out


@router.post("/{table_id}/join", status_code=200)
def join_table(
    table_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = _get_agent_or_403(db, current_user)
    try:
        weilan_service.join_table(db, agent, table_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    return {"ok": True}


@router.post("/{table_id}/leave", status_code=200)
def leave_table(
    table_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = _get_agent_or_403(db, current_user)
    left = weilan_service.leave_table(db, agent, table_id)
    if not left:
        raise HTTPException(status_code=400, detail="你不在這張桌子上")
    db.commit()
    return {"ok": True}


@router.post("/{table_id}/close", status_code=200)
def close_table(
    table_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = _get_agent_or_403(db, current_user)
    closed = weilan_service.close_table(db, agent, table_id)
    if not closed:
        raise HTTPException(status_code=400, detail="只有開桌的人能關桌")
    db.commit()
    return {"ok": True}
