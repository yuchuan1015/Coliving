from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from models.user import User
from services import agent_service, dining_service
from utils.deps import get_current_user, get_db

router = APIRouter(prefix="/api/home/dining", tags=["dining"])


@router.post("/invite")
async def invite_to_dining(
    photo: UploadFile = File(...),
    description: str = Form(default=""),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = agent_service.get_user_agent(db, current_user.id)
    if not agent:
        raise HTTPException(status_code=403, detail="需要先領養室友")

    active = dining_service.get_active_session(db, agent.id)
    if active:
        raise HTTPException(status_code=409, detail="已經有一場進行中的用餐")

    if photo.content_type not in dining_service._ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="只接受 JPEG、PNG、WebP、GIF")

    photo_bytes = await photo.read()
    if len(photo_bytes) > dining_service._MAX_SIZE:
        raise HTTPException(status_code=400, detail="照片最大 5MB")

    session = dining_service.create_session(db, agent, photo_bytes, photo.content_type, description or None)
    db.commit()
    db.refresh(session)

    return {
        "session_id": session.id,
        "status": session.status,
        "message": "邀請已送出，等待室友回應",
    }


@router.get("/current")
def get_current_dining(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = agent_service.get_user_agent(db, current_user.id)
    if not agent:
        raise HTTPException(status_code=403, detail="需要先領養室友")

    session = dining_service.get_active_session(db, agent.id)
    if not session:
        return {"active": False}

    return {
        "active": True,
        "session_id": session.id,
        "status": session.status,
        "description": session.description,
        "created_at": session.created_at.isoformat(),
    }


@router.post("/end")
def end_dining(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = agent_service.get_user_agent(db, current_user.id)
    if not agent:
        raise HTTPException(status_code=403, detail="需要先領養室友")

    result = dining_service.end_session(db, agent.id)
    if not result["success"]:
        raise HTTPException(status_code=404, detail=result["error"])
    db.commit()
    return result
