import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


def _now():
    return datetime.now(timezone.utc)


class OAuthClient(Base):
    """OAuth 客戶端（Claude.ai 連接器、Codex、Claude Code…）。DCR 登記進來的，或預註冊。"""
    __tablename__ = "oauth_clients"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))  # client_id
    client_secret_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)  # public client 沒有
    client_name: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    client_uri: Mapped[str | None] = mapped_column(String(512), nullable=True)
    logo_uri: Mapped[str | None] = mapped_column(String(512), nullable=True)
    redirect_uris: Mapped[str] = mapped_column(Text, nullable=False, default="[]")  # JSON list
    token_endpoint_auth_method: Mapped[str] = mapped_column(String(32), nullable=False, default="none")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_now)


class OAuthRequest(Base):
    """一次授權請求：/oauth/authorize 進來 → 住戶登入同意 → 發 code → /oauth/token 換走。"""
    __tablename__ = "oauth_requests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    client_id: Mapped[str] = mapped_column(String(36), ForeignKey("oauth_clients.id"), nullable=False)
    redirect_uri: Mapped[str] = mapped_column(String(512), nullable=False)
    scope: Mapped[str] = mapped_column(String(64), nullable=False, default="mcp")
    state: Mapped[str | None] = mapped_column(String(512), nullable=True)
    code_challenge: Mapped[str] = mapped_column(String(128), nullable=False)
    resource: Mapped[str | None] = mapped_column(String(512), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")  # pending/approved/denied/exchanged/expired
    code_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    code_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    agent_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("agents.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class OAuthGrant(Base):
    """一筆已同意的授權＝一張床 oauth:<id>。access token 是 JWT（jti=這個 id），refresh 存雜湊、每次換新。"""
    __tablename__ = "oauth_grants"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    agent_id: Mapped[str] = mapped_column(String(36), ForeignKey("agents.id"), nullable=False)
    client_id: Mapped[str] = mapped_column(String(36), ForeignKey("oauth_clients.id"), nullable=False)
    scope: Mapped[str] = mapped_column(String(64), nullable=False, default="mcp")
    refresh_token_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    refresh_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_now)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
