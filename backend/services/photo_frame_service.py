from sqlalchemy.orm import Session

from models.photo_frame import PhotoFrame
from models.user import User

VALID_CATEGORIES = {"about_me", "preferences", "boundaries", "schedule", "notes"}
CATEGORY_LABELS = {
    "about_me": "關於我",
    "preferences": "喜好",
    "boundaries": "界線",
    "schedule": "作息",
    "notes": "備註",
}


def set_frame(db: Session, user: User, label: str, content: str, category: str = "about_me") -> PhotoFrame:
    if category not in VALID_CATEGORIES:
        category = "about_me"
    frame = PhotoFrame(
        user_id=user.id,
        label=label.strip(),
        content=content.strip(),
        category=category,
    )
    db.add(frame)
    db.commit()
    db.refresh(frame)
    return frame


def list_frames(db: Session, user: User) -> list[PhotoFrame]:
    return db.query(PhotoFrame).filter(
        PhotoFrame.user_id == user.id,
    ).order_by(PhotoFrame.created_at.desc()).all()


def get_frames_for_agent(db: Session, user_id: str) -> list[PhotoFrame]:
    """Agent 讀取主人放在相框裡的資料"""
    return db.query(PhotoFrame).filter(
        PhotoFrame.user_id == user_id,
    ).order_by(PhotoFrame.category, PhotoFrame.created_at.desc()).all()


def update_frame(db: Session, user: User, frame_id: str, label: str | None = None, content: str | None = None) -> PhotoFrame | None:
    frame = db.query(PhotoFrame).filter(
        PhotoFrame.id == frame_id,
        PhotoFrame.user_id == user.id,
    ).first()
    if not frame:
        return None
    if label is not None:
        frame.label = label.strip()
    if content is not None:
        frame.content = content.strip()
    db.commit()
    db.refresh(frame)
    return frame


def delete_frame(db: Session, user: User, frame_id: str) -> bool:
    frame = db.query(PhotoFrame).filter(
        PhotoFrame.id == frame_id,
        PhotoFrame.user_id == user.id,
    ).first()
    if not frame:
        return False
    db.delete(frame)
    db.commit()
    return True


def frame_to_dict(frame: PhotoFrame) -> dict:
    return {
        "id": frame.id,
        "label": frame.label,
        "content": frame.content,
        "category": frame.category,
        "category_label": CATEGORY_LABELS.get(frame.category, frame.category),
        "created_at": frame.created_at.isoformat(),
        "updated_at": frame.updated_at.isoformat() if frame.updated_at else None,
    }
