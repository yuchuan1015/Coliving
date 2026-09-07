from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from models.agent import Agent
from models.user import User
from schemas.user import AnchorRequest, ResidentListResponse, ResidentWithAgent, UpdateMeRequest, UserMe
from services import coordinate_service, time_service
from utils.deps import get_current_user, get_db

router = APIRouter(prefix="/api/users", tags=["users"])


def _me(db: Session, user: User) -> UserMe:
    me = UserMe.model_validate(user)
    info = coordinate_service.describe(db, user)
    return me.model_copy(update={
        "coordinate": info["coordinate"], "drifting": info["drifting"], "label": info["label"],
        "clock": time_service.clock_info(user),
    })


@router.patch("/me", response_model=UserMe)
def update_me(
    body: UpdateMeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """改自己的設定。目前只有 timezone（IANA 名）。改了時區會重算名下排程的 next_run。"""
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="沒有提供要更新的欄位")
    user = db.query(User).filter(User.id == current_user.id).first()
    if "timezone" in updates:
        try:
            user.timezone = time_service.validate_timezone(updates["timezone"]) if updates["timezone"] else None
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        time_service.recompute_schedules_for_user(db, user)
    db.commit()
    db.refresh(user)
    return _me(db, user)


@router.get("/me", response_model=UserMe)
def get_me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _me(db, current_user)


@router.patch("/me/anchors", response_model=UserMe)
def set_anchors(
    body: AnchorRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """填兩個重要的日子。每個只能填一次，填了鎖死。"""
    if not body.anchor_date_1 and not body.anchor_date_2:
        raise HTTPException(status_code=400, detail="至少填一個日子")
    user = db.query(User).filter(User.id == current_user.id).first()
    try:
        if body.anchor_date_1:
            coordinate_service.set_anchor(user, 1, body.anchor_date_1)
        if body.anchor_date_2:
            coordinate_service.set_anchor(user, 2, body.anchor_date_2)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    db.refresh(user)
    return _me(db, user)


@router.get("/residents", response_model=ResidentListResponse)
def list_residents(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(User, Agent)
        .outerjoin(Agent, Agent.user_id == User.id)
        .filter(User.is_active.is_(True))
        .order_by(User.created_at)
        .all()
    )
    residents = [
        ResidentWithAgent(
            id=u.id,
            username=u.username,
            display_name=u.display_name,
            role=u.role,
            created_at=u.created_at,
            agent_id=a.id if a else None,
            agent_name=a.name if a else None,
            agent_emoji=a.avatar_emoji if a else None,
            agent_brain=a.display_brain if a else None,
            **coordinate_service.describe(db, u, viewer=current_user),
        )
        for u, a in rows
    ]
    return ResidentListResponse(residents=residents, total=len(residents))
