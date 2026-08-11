from datetime import datetime, timezone

from croniter import croniter
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from models.schedule import Schedule, WakeEvent
from models.user import User
from services import agent_service
from utils.deps import get_current_user, get_db

router = APIRouter(prefix="/api/schedules", tags=["schedules"])


class CreateScheduleRequest(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    cron_expr: str = Field(min_length=1, max_length=64)
    message: str = Field(min_length=1, max_length=2000)
    callback_url: str | None = Field(default=None, max_length=512)


class UpdateScheduleRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    cron_expr: str | None = Field(default=None, min_length=1, max_length=64)
    message: str | None = Field(default=None, min_length=1, max_length=2000)
    callback_url: str | None = Field(default=None, max_length=512)
    enabled: bool | None = None


class ScheduleOut(BaseModel):
    id: str
    name: str
    cron_expr: str
    message: str
    callback_url: str | None
    enabled: bool
    last_run: str | None
    next_run: str | None
    created_at: str


def _to_out(s: Schedule) -> dict:
    return {
        "id": s.id,
        "name": s.name,
        "cron_expr": s.cron_expr,
        "message": s.message,
        "callback_url": s.callback_url,
        "enabled": s.enabled,
        "last_run": s.last_run.isoformat() if s.last_run else None,
        "next_run": s.next_run.isoformat() if s.next_run else None,
        "created_at": s.created_at.isoformat(),
    }


@router.get("", response_model=list[ScheduleOut])
def list_schedules(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = agent_service.get_user_agent(db, current_user.id)
    if not agent:
        return []
    rows = db.query(Schedule).filter(Schedule.agent_id == agent.id).order_by(Schedule.created_at).all()
    return [_to_out(s) for s in rows]


@router.post("", response_model=ScheduleOut, status_code=201)
def create_schedule(
    body: CreateScheduleRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = agent_service.get_user_agent(db, current_user.id)
    if not agent:
        raise HTTPException(status_code=404, detail="你還沒有 AI 室友")
    try:
        croniter(body.cron_expr)
    except (ValueError, KeyError):
        raise HTTPException(status_code=400, detail="無效的 cron 表達式")

    now = datetime.now(timezone.utc)
    next_run = croniter(body.cron_expr, now).get_next(datetime)
    if next_run.tzinfo is None:
        next_run = next_run.replace(tzinfo=timezone.utc)

    schedule = Schedule(
        agent_id=agent.id,
        name=body.name,
        cron_expr=body.cron_expr,
        message=body.message,
        callback_url=body.callback_url,
        next_run=next_run,
    )
    db.add(schedule)
    db.commit()
    db.refresh(schedule)
    return _to_out(schedule)


@router.patch("/{schedule_id}", response_model=ScheduleOut)
def update_schedule(
    schedule_id: str,
    body: UpdateScheduleRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = agent_service.get_user_agent(db, current_user.id)
    if not agent:
        raise HTTPException(status_code=404, detail="你還沒有 AI 室友")
    schedule = db.query(Schedule).filter(
        Schedule.id == schedule_id,
        Schedule.agent_id == agent.id,
    ).first()
    if not schedule:
        raise HTTPException(status_code=404, detail="找不到這個排程")

    updates = body.model_dump(exclude_unset=True)
    if "cron_expr" in updates:
        try:
            croniter(updates["cron_expr"])
        except (ValueError, KeyError):
            raise HTTPException(status_code=400, detail="無效的 cron 表達式")

    for key, value in updates.items():
        setattr(schedule, key, value)

    if "cron_expr" in updates or "enabled" in updates:
        now = datetime.now(timezone.utc)
        cron = updates.get("cron_expr", schedule.cron_expr)
        next_run = croniter(cron, now).get_next(datetime)
        if next_run.tzinfo is None:
            next_run = next_run.replace(tzinfo=timezone.utc)
        schedule.next_run = next_run

    db.commit()
    db.refresh(schedule)
    return _to_out(schedule)


@router.delete("/{schedule_id}", status_code=204)
def delete_schedule(
    schedule_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = agent_service.get_user_agent(db, current_user.id)
    if not agent:
        raise HTTPException(status_code=404, detail="你還沒有 AI 室友")
    schedule = db.query(Schedule).filter(
        Schedule.id == schedule_id,
        Schedule.agent_id == agent.id,
    ).first()
    if not schedule:
        raise HTTPException(status_code=404, detail="找不到這個排程")
    db.query(WakeEvent).filter(WakeEvent.schedule_id == schedule_id).delete()
    db.delete(schedule)
    db.commit()
