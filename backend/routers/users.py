from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from models.agent import Agent
from models.user import User
from schemas.user import AnchorRequest, ChangePasswordRequest, ResidentListResponse, ResidentWithAgent, UpdateMeRequest, UserMe
from services import ai_chat_service, auth_service, coordinate_service, time_service, weather_service
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
    """改自己的顯示名稱、時區、城市、出生年（只能填一次）、給室友的話。改時區會重算名下排程。"""
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="沒有提供要更新的欄位")
    user = db.query(User).filter(User.id == current_user.id).first()
    if "display_name" in updates:
        user.display_name = updates["display_name"]
    if "timezone" in updates:
        try:
            user.timezone = time_service.validate_timezone(updates["timezone"]) if updates["timezone"] else None
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        time_service.recompute_schedules_for_user(db, user)
    if "birth_year" in updates and updates["birth_year"] is not None:
        if user.birth_year is not None:
            raise HTTPException(status_code=400, detail="出生年份已經設定過了，不能改")
        user.birth_year = updates["birth_year"]
    if "note_to_agent" in updates:
        note = (updates["note_to_agent"] or "").strip()
        user.note_to_agent = note or None
    if "location_name" in updates:
        name = (updates["location_name"] or "").strip()
        if not name:
            user.location_name = user.location_lat = user.location_lon = None
        else:
            g = weather_service.geocode(name)
            if not g:
                raise HTTPException(status_code=400, detail=f"找不到「{name}」這個地方，換個寫法試試（例如城市的英文名）")
            user.location_name, user.location_lat, user.location_lon = g[2], g[0], g[1]
    db.commit()
    db.refresh(user)
    return _me(db, user)


@router.get("/me", response_model=UserMe)
def get_me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _me(db, current_user)


@router.post("/me/password")
def change_password(body: ChangePasswordRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == current_user.id).first()
    if not auth_service.verify_password(body.old_password, user.hashed_password):
        raise HTTPException(status_code=400, detail="目前的密碼不正確")
    if auth_service.verify_password(body.new_password, user.hashed_password):
        raise HTTPException(status_code=400, detail="新密碼不能和目前的密碼相同")
    changed = db.query(User).filter(User.id == user.id, User.hashed_password == user.hashed_password,
                                   User.auth_version == user.auth_version).update({
        User.hashed_password: auth_service.hash_password(body.new_password),
        User.auth_version: user.auth_version + 1,
    }, synchronize_session=False)
    if changed != 1:
        db.rollback()
        raise HTTPException(status_code=409, detail="密碼已變更，請重新登入")
    db.commit()
    return {"message": "密碼已更新，請用新密碼重新登入", "reauthenticate": True}


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
            agent_avatar_url=a.avatar_url if a else None,
            agent_brain=a.display_brain if a else None,
            agent_dm_code=(ai_chat_service.dm_code_for(a, u) if a and a.dm_code_public else None),
            agent_status_note=a.status_note if a else None,
            **coordinate_service.describe(db, u, viewer=current_user),
        )
        for u, a in rows
    ]
    return ResidentListResponse(residents=residents, total=len(residents))
