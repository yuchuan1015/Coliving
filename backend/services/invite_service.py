import secrets
import string
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from models.invite_code import InviteCode


def generate_code() -> str:
    chars = string.ascii_uppercase + string.digits
    return "".join(secrets.choice(chars) for _ in range(8))


def validate_and_consume(code: str, db: Session) -> InviteCode:
    invite = db.query(InviteCode).filter(InviteCode.code == code, InviteCode.is_active.is_(True)).first()

    if not invite:
        raise ValueError("邀請碼無效")

    if invite.used_count >= invite.max_uses:
        raise ValueError("邀請碼已用完")

    if invite.expires_at and invite.expires_at < datetime.now(timezone.utc):
        raise ValueError("邀請碼已過期")

    invite.used_count += 1
    if invite.used_count >= invite.max_uses:
        invite.is_active = False

    return invite
