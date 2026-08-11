"""我的家 — 家具 API。統一入口 + 各家具子路由。"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from models.agent import Agent
from models.diary import DiaryEntry
from models.drawer import DrawerItem
from models.photo_frame import PhotoFrame
from models.user import User
from services import diary_service, drawer_service, photo_frame_service
from routers.park import get_today_weather
from utils.deps import get_current_user, get_db

router = APIRouter(prefix="/api/home/furniture", tags=["furniture"])


def _get_agent(db: Session, user: User) -> Agent | None:
    return db.query(Agent).filter(Agent.user_id == user.id).first()


# ─── 家具總覽 ──────────────────────────────────────

@router.get("")
def furniture_overview(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """回傳所有家具的摘要狀態，前端用來渲染房間。"""
    agent = _get_agent(db, current_user)

    now = datetime.now(timezone.utc)

    weather = get_today_weather()

    diary_count = 0
    drawer_count = 0
    if agent:
        diary_count = db.query(DiaryEntry).filter(DiaryEntry.agent_id == agent.id).count()
        drawer_count = db.query(DrawerItem).filter(DrawerItem.agent_id == agent.id).count()

    frame_count = db.query(PhotoFrame).filter(PhotoFrame.user_id == current_user.id).count()

    return {
        "window": {"weather": weather.weather, "emoji": weather.weather_emoji, "description": weather.description, "temperature": weather.temperature, "activities": weather.activities},
        "clock": {"utc": now.isoformat(), "timezone": "Asia/Taipei"},
        "diary": {"count": diary_count},
        "drawer": {"count": drawer_count},
        "photo_frame": {"count": frame_count},
        "mirror": {"agent_name": agent.name if agent else None, "avatar_emoji": agent.avatar_emoji if agent else None},
        "door": {"current_location": agent.current_location if agent else None},
        "bed": {"has_agent": agent is not None},
    }


# ─── 抽屜 ─────────────────────────────────────────

class DrawerStoreBody(BaseModel):
    label: str
    content: str
    category: str = "misc"


@router.get("/drawer")
def list_drawer(
    category: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = _get_agent(db, current_user)
    if not agent:
        raise HTTPException(status_code=403, detail="需要先有室友")
    items = drawer_service.list_items(db, agent, category=category)
    return {"items": [drawer_service.item_to_dict(i) for i in items]}


@router.post("/drawer", status_code=201)
def store_in_drawer(
    body: DrawerStoreBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = _get_agent(db, current_user)
    if not agent:
        raise HTTPException(status_code=403, detail="需要先有室友")
    item = drawer_service.store_item(db, agent, body.label, body.content, body.category)
    return drawer_service.item_to_dict(item)


@router.delete("/drawer/{item_id}", status_code=204)
def remove_from_drawer(
    item_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = _get_agent(db, current_user)
    if not agent:
        raise HTTPException(status_code=403, detail="需要先有室友")
    if not drawer_service.remove_item(db, agent, item_id):
        raise HTTPException(status_code=404, detail="找不到物品")


# ─── 相框 ─────────────────────────────────────────

class FrameBody(BaseModel):
    label: str
    content: str
    category: str = "about_me"


class FrameUpdateBody(BaseModel):
    label: str | None = None
    content: str | None = None


@router.get("/photo-frame")
def list_photo_frames(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    frames = photo_frame_service.list_frames(db, current_user)
    return {
        "frames": [photo_frame_service.frame_to_dict(f) for f in frames],
        "categories": photo_frame_service.CATEGORY_LABELS,
    }


@router.post("/photo-frame", status_code=201)
def add_photo_frame(
    body: FrameBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    frame = photo_frame_service.set_frame(db, current_user, body.label, body.content, body.category)
    return photo_frame_service.frame_to_dict(frame)


@router.put("/photo-frame/{frame_id}")
def update_photo_frame(
    frame_id: str,
    body: FrameUpdateBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    frame = photo_frame_service.update_frame(db, current_user, frame_id, label=body.label, content=body.content)
    if not frame:
        raise HTTPException(status_code=404, detail="找不到相框")
    return photo_frame_service.frame_to_dict(frame)


@router.delete("/photo-frame/{frame_id}", status_code=204)
def delete_photo_frame(
    frame_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not photo_frame_service.delete_frame(db, current_user, frame_id):
        raise HTTPException(status_code=404, detail="找不到相框")
