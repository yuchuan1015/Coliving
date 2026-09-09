"""相框的照片（2026-09-09 她定：一人最多 20 張，同時只擺 1 張）。
- 上傳的圖一律轉 WebP、長邊縮到 1600、丟掉 EXIF（含 GPS），一張大約 200～400KB。
- 檔案放在 uploads 外面的私人目錄，nginx 碰不到；網頁用簽章網址讀，室友走 MCP 直接看到圖。
"""
from __future__ import annotations

import hashlib
import hmac
import io
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from PIL import Image, ImageOps
from sqlalchemy.orm import Session

from config import settings
from models.photo import Photo
from models.user import User
from services import time_service

MAX_PHOTOS = 20
MAX_UPLOAD_BYTES = 12 * 1024 * 1024   # 進來的原檔上限
LONG_EDGE = 1600
QUALITY = 82
LINK_TTL = timedelta(hours=24)
ACCEPTED = {"image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"}

BASE_DIR = Path(os.environ.get("PHOTO_DIR", Path(__file__).resolve().parent.parent / "private_photos"))


class PhotoError(Exception):
    pass


def _dir_for(user_id: str) -> Path:
    d = BASE_DIR / user_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def path_of(photo: Photo) -> Path:
    return BASE_DIR / photo.user_id / photo.filename


def count(db: Session, user_id: str) -> int:
    return db.query(Photo).filter(Photo.user_id == user_id).count()


def add(db: Session, user: User, data: bytes, content_type: str, caption: str = "") -> Photo:
    if content_type not in ACCEPTED:
        raise PhotoError("只收圖片檔（JPG／PNG／WebP／GIF／HEIC）")
    if len(data) > MAX_UPLOAD_BYTES:
        raise PhotoError(f"檔案太大，最多 {MAX_UPLOAD_BYTES // 1024 // 1024}MB")
    if count(db, user.id) >= MAX_PHOTOS:
        raise PhotoError(f"相簿最多放 {MAX_PHOTOS} 張，要放新的請先刪一張")
    try:
        img = Image.open(io.BytesIO(data))
        img = ImageOps.exif_transpose(img)          # 照相機的方向轉正
        img = img.convert("RGB")                    # 順手把 EXIF（含 GPS）丟掉
        img.thumbnail((LONG_EDGE, LONG_EDGE))
    except Exception as e:  # noqa: BLE001
        raise PhotoError("這個檔案讀不出來，換一張試試") from e

    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=QUALITY, method=4)
    blob = buf.getvalue()

    name = f"{uuid.uuid4().hex}.webp"
    (_dir_for(user.id) / name).write_bytes(blob)

    photo = Photo(
        user_id=user.id,
        filename=name,
        caption=(caption or "").strip()[:200],
        width=img.width,
        height=img.height,
        bytes=len(blob),
        is_displayed=count(db, user.id) == 0,   # 第一張自動擺上去
    )
    db.add(photo)
    db.flush()
    return photo


def get(db: Session, user_id: str, photo_id: str) -> Photo | None:
    return db.query(Photo).filter(Photo.id == photo_id, Photo.user_id == user_id).first()


def list_photos(db: Session, user_id: str) -> list[Photo]:
    return db.query(Photo).filter(Photo.user_id == user_id).order_by(Photo.created_at.desc()).all()


def displayed(db: Session, user_id: str) -> Photo | None:
    return db.query(Photo).filter(Photo.user_id == user_id, Photo.is_displayed.is_(True)).first()


def display(db: Session, user_id: str, photo_id: str) -> Photo:
    """擺這張。同時只有一張擺著。"""
    target = get(db, user_id, photo_id)
    if not target:
        raise PhotoError("找不到這張照片")
    for p in db.query(Photo).filter(Photo.user_id == user_id, Photo.is_displayed.is_(True)).all():
        p.is_displayed = False
    target.is_displayed = True
    db.flush()
    return target


def clear_display(db: Session, user_id: str) -> None:
    """相框空著。"""
    for p in db.query(Photo).filter(Photo.user_id == user_id, Photo.is_displayed.is_(True)).all():
        p.is_displayed = False
    db.flush()


def set_caption(db: Session, user_id: str, photo_id: str, caption: str) -> Photo:
    p = get(db, user_id, photo_id)
    if not p:
        raise PhotoError("找不到這張照片")
    p.caption = (caption or "").strip()[:200]
    db.flush()
    return p


def delete(db: Session, user_id: str, photo_id: str) -> bool:
    p = get(db, user_id, photo_id)
    if not p:
        return False
    try:
        path_of(p).unlink(missing_ok=True)
    except OSError:
        pass
    was_displayed = p.is_displayed
    db.delete(p)
    db.flush()
    if was_displayed:  # 刪掉正在擺的那張 → 換最新的一張上去
        nxt = db.query(Photo).filter(Photo.user_id == user_id).order_by(Photo.created_at.desc()).first()
        if nxt:
            nxt.is_displayed = True
            db.flush()
    return True


# ── 簽章網址：<img> 標籤沒辦法帶 Authorization，所以給一條 24 小時內有效、猜不到的網址 ──

def sign(photo_id: str, user_id: str, expires_at: int) -> str:
    msg = f"photo|{photo_id}|{user_id}|{expires_at}".encode()
    return hmac.new(settings.jwt_secret.encode(), msg, hashlib.sha256).hexdigest()[:32]


def signed_url(photo: Photo) -> str:
    exp = int((datetime.now(timezone.utc) + LINK_TTL).timestamp())
    return f"/api/home/furniture/photos/{photo.id}/file?exp={exp}&sig={sign(photo.id, photo.user_id, exp)}"


def check_signature(photo: Photo, exp: str | int | None, sig: str | None) -> bool:
    try:
        exp_i = int(exp)
    except (TypeError, ValueError):
        return False
    if exp_i < int(datetime.now(timezone.utc).timestamp()):
        return False
    return bool(sig) and hmac.compare_digest(sign(photo.id, photo.user_id, exp_i), sig)


def to_dict(photo: Photo) -> dict:
    return {
        "id": photo.id,
        "caption": photo.caption,
        "is_displayed": photo.is_displayed,
        "width": photo.width,
        "height": photo.height,
        "bytes": photo.bytes,
        "url": signed_url(photo),
        "created_at": time_service.aware(photo.created_at).isoformat(),
    }
