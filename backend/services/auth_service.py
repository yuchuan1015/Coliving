from datetime import datetime, timedelta, timezone

import bcrypt
from jose import JWTError, jwt

from config import settings

ALGORITHM = "HS256"


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_access_token(user_id: str, username: str, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_access_expire_minutes)
    payload = {
        "sub": user_id,
        "username": username,
        "role": role,
        "type": "access",
        "exp": expire,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=settings.jwt_refresh_expire_days)
    payload = {
        "sub": user_id,
        "type": "refresh",
        "exp": expire,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def create_mcp_token(user_id: str, username: str, token_id: str | None = None, issued_at: datetime | None = None) -> str:
    """token_id = mcp_tokens.id，放進 jti；驗鑰匙時對表、記最後使用、可作廢。
    有 jti 的鑰匙：exp = 建立時間 + mcp_key_days，傳 issued_at（= 表裡的 created_at）就能隨時把同一把鑰匙重新算出來給主人看，不用存明文。"""
    if token_id:
        base = issued_at or datetime.now(timezone.utc)
        expire = base + timedelta(days=settings.mcp_key_days)
    else:
        expire = datetime.now(timezone.utc) + timedelta(days=settings.mcp_token_expire_days)
    payload = {
        "sub": user_id,
        "username": username,
        "type": "mcp",
        "exp": expire,
    }
    if token_id:
        payload["jti"] = token_id
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
    except JWTError:
        return {}
