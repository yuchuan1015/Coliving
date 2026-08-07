from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from models.announcement import Announcement
from models.user import User
from schemas.announcement import AnnouncementOut, CreateAnnouncementRequest, UpdateAnnouncementRequest
from utils.deps import get_current_user, get_db, require_admin

router = APIRouter(prefix="/api/announcements", tags=["announcements"])


def _to_out(ann: Announcement, author_name: str) -> dict:
    return {
        "id": ann.id,
        "author_name": author_name,
        "title": ann.title,
        "content": ann.content,
        "is_pinned": ann.is_pinned,
        "created_at": ann.created_at.isoformat(),
        "updated_at": ann.updated_at.isoformat() if ann.updated_at else None,
    }


@router.get("", response_model=list[AnnouncementOut])
def list_announcements(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = (
        db.query(Announcement, User.display_name)
        .join(User, User.id == Announcement.author_id)
        .order_by(Announcement.is_pinned.desc(), Announcement.created_at.desc())
        .all()
    )
    return [_to_out(ann, name) for ann, name in rows]


@router.post("", response_model=AnnouncementOut, status_code=201)
def create_announcement(
    body: CreateAnnouncementRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    ann = Announcement(author_id=admin.id, title=body.title, content=body.content)
    db.add(ann)
    db.commit()
    db.refresh(ann)
    return _to_out(ann, admin.display_name)


@router.patch("/{ann_id}", response_model=AnnouncementOut)
def update_announcement(
    ann_id: str,
    body: UpdateAnnouncementRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    ann = db.query(Announcement).filter(Announcement.id == ann_id).first()
    if not ann:
        raise HTTPException(status_code=404, detail="找不到這則公告")

    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="沒有提供要更新的欄位")

    for key, value in updates.items():
        setattr(ann, key, value)
    ann.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(ann)

    author = db.query(User).filter(User.id == ann.author_id).first()
    return _to_out(ann, author.display_name if author else "未知")


@router.delete("/{ann_id}", status_code=204)
def delete_announcement(
    ann_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    ann = db.query(Announcement).filter(Announcement.id == ann_id).first()
    if not ann:
        raise HTTPException(status_code=404, detail="找不到這則公告")
    db.delete(ann)
    db.commit()
