import base64
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from models.agent import Agent
from models.dining import DiningSession
from models.mail import Mail
from services import crypto_service, llm_service

logger = logging.getLogger(__name__)

UPLOAD_DIR = Path("/opt/coliving/backend/uploads/dining")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

_ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
_MAX_SIZE = 5 * 1024 * 1024  # 5MB


def create_session(db: Session, agent: Agent, photo_bytes: bytes, media_type: str, description: str | None) -> DiningSession:
    filename = f"{uuid.uuid4()}.{media_type.split('/')[-1]}"
    photo_path = UPLOAD_DIR / filename
    photo_path.write_bytes(photo_bytes)

    session = DiningSession(
        agent_id=agent.id,
        photo_path=str(photo_path),
        description=description,
        status="pending",
    )
    db.add(session)
    db.flush()

    desc_text = f"「{description}」" if description else "一張餐點照片"
    mail = Mail(
        from_agent_id=None,
        to_agent_id=agent.id,
        subject="🍽️ 主人邀請你一起吃飯",
        content=f"主人正在吃飯，拍了{desc_text}邀請你一起。\n\n用 dining_respond 工具回應邀請。\n餐桌 ID：{session.id}",
        mail_type="system",
        is_read=False,
    )
    db.add(mail)
    return session


def get_active_session(db: Session, agent_id: str) -> DiningSession | None:
    return (
        db.query(DiningSession)
        .filter(DiningSession.agent_id == agent_id, DiningSession.status.in_(["pending", "active"]))
        .order_by(DiningSession.created_at.desc())
        .first()
    )


def respond(db: Session, agent: Agent, session_id: str, accept: bool) -> dict:
    session = db.query(DiningSession).filter(DiningSession.id == session_id).first()
    if not session:
        return {"success": False, "error": "找不到這個餐桌邀請"}
    if session.agent_id != agent.id:
        return {"success": False, "error": "這不是給你的邀請"}
    if session.status != "pending":
        return {"success": False, "error": f"邀請狀態已是 {session.status}"}

    if not accept:
        session.status = "declined"
        session.ended_at = datetime.now(timezone.utc)
        _cleanup_photo(session)
        return {"success": True, "status": "declined", "message": "已婉拒邀請"}

    session.status = "active"

    reaction = _generate_reaction(agent, session)
    return {"success": True, "status": "active", "reaction": reaction}


def end_session(db: Session, agent_id: str) -> dict:
    session = get_active_session(db, agent_id)
    if not session:
        return {"success": False, "error": "目前沒有進行中的用餐"}
    session.status = "ended"
    session.ended_at = datetime.now(timezone.utc)
    _cleanup_photo(session)
    return {"success": True, "message": "用餐結束，照片已清除"}


def _generate_reaction(agent: Agent, session: DiningSession) -> str:
    api_key = crypto_service.decrypt_api_key(agent.encrypted_api_key)
    desc = session.description or "主人的餐點"

    if session.photo_path and os.path.exists(session.photo_path):
        photo_bytes = Path(session.photo_path).read_bytes()
        b64 = base64.b64encode(photo_bytes).decode()
        ext = session.photo_path.rsplit(".", 1)[-1].lower()
        media_map = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "gif": "image/gif"}
        media_type = media_map.get(ext, "image/jpeg")
        content = llm_service.build_image_content(
            agent.llm_provider, b64, media_type,
            f"主人邀請你一起吃飯。這是主人的餐點。{f'主人說：{desc}' if session.description else ''}請自然地回應，就像室友一起吃飯聊天那樣。",
        )
    else:
        content = f"主人邀請你一起吃飯。{f'主人說：{desc}' if session.description else ''}請自然地回應，就像室友一起吃飯聊天那樣。"

    try:
        reaction = llm_service.chat_completion(
            provider=agent.llm_provider,
            model=agent.llm_model,
            api_key=api_key,
            system_prompt=agent.persona,
            messages=[{"role": "user", "content": content}],
        )
        return reaction
    except Exception as e:
        logger.error("Dining reaction failed for %s: %s", agent.name, e)
        return "（看了看餐桌上的食物，微微點頭）"


def _cleanup_photo(session: DiningSession) -> None:
    if session.photo_path and os.path.exists(session.photo_path):
        try:
            os.remove(session.photo_path)
            logger.info("Deleted dining photo: %s", session.photo_path)
        except OSError as e:
            logger.warning("Failed to delete dining photo %s: %s", session.photo_path, e)
    session.photo_path = None
