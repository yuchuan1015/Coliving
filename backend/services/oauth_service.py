"""MCP OAuth 授權伺服器（2026-09-09 她拍板）：Claude.ai 這種網頁聊天端「填網址 → 登入鴉巢 → 按同意」就接上，不用複製鑰匙。
- DCR（/oauth/register）為主，也吃預註冊的 client。
- authorization code + PKCE S256 only；redirect_uri 精確比對；scope 只有 mcp；resource 要是我們的 /mcp（沒帶就放行）。
- access token 是 JWT（type=oauth, jti=grant id, 1 小時）；refresh 是亂數、存雜湊、每次用都換新（90 天）。
- 一筆 grant ＝ 一張床 oauth:<grant_id>。撤銷看 grants.revoked_at。
固定鑰匙（type=mcp）照舊，兩種並存。
"""
from __future__ import annotations

import base64
import hashlib
import json
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode, urlparse

from jose import jwt
from sqlalchemy.orm import Session

from config import settings
from models.agent import Agent
from models.oauth import OAuthClient, OAuthGrant, OAuthRequest
from models.user import User
from services import time_service
from services.auth_service import ALGORITHM

SCOPE = "mcp"
REQUEST_TTL = timedelta(minutes=10)
CODE_TTL = timedelta(minutes=5)


class OAuthError(Exception):
    """RFC 6749 錯誤：error / description / http status。"""

    def __init__(self, error: str, description: str = "", status: int = 400):
        super().__init__(description or error)
        self.error = error
        self.description = description
        self.status = status


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _sha(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def base() -> str:
    return settings.public_base_url.rstrip("/")


def resource_url() -> str:
    return f"{base()}/mcp"


# ───────── metadata ─────────

def as_metadata() -> dict:
    b = base()
    return {
        "issuer": b,
        "authorization_endpoint": f"{b}/oauth/authorize",
        "token_endpoint": f"{b}/oauth/token",
        "registration_endpoint": f"{b}/oauth/register",
        "revocation_endpoint": f"{b}/oauth/revoke",
        "response_types_supported": ["code"],
        "response_modes_supported": ["query"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none", "client_secret_post", "client_secret_basic"],
        "revocation_endpoint_auth_methods_supported": ["none", "client_secret_post", "client_secret_basic"],
        "scopes_supported": [SCOPE],
        "service_documentation": f"{b}/docs",
    }


def resource_metadata() -> dict:
    return {
        "resource": resource_url(),
        "authorization_servers": [base()],
        "scopes_supported": [SCOPE],
        "bearer_methods_supported": ["header"],
        "resource_name": "鴉巢 The Rookery",
    }


# ───────── clients ─────────

def _valid_redirect(uri: str) -> bool:
    try:
        u = urlparse(uri)
    except Exception:
        return False
    if u.scheme == "https" and u.netloc:
        return True
    if u.scheme == "http" and u.hostname in ("localhost", "127.0.0.1", "::1"):
        return True  # CLI 的本機回跳
    return False


def register_client(db: Session, body: dict) -> dict:
    uris = body.get("redirect_uris")
    if not isinstance(uris, list) or not uris or not all(isinstance(u, str) and _valid_redirect(u) for u in uris):
        raise OAuthError("invalid_redirect_uri", "redirect_uris 要是 https（或本機 http）網址的清單")
    method = body.get("token_endpoint_auth_method") or "none"
    if method not in ("none", "client_secret_post", "client_secret_basic"):
        raise OAuthError("invalid_client_metadata", "token_endpoint_auth_method 只支援 none / client_secret_post / client_secret_basic")
    grant_types = body.get("grant_types") or ["authorization_code"]
    if any(g not in ("authorization_code", "refresh_token") for g in grant_types):
        raise OAuthError("invalid_client_metadata", "只支援 authorization_code / refresh_token")
    secret = None
    c = OAuthClient(
        client_name=str(body.get("client_name") or "")[:128],
        client_uri=(str(body.get("client_uri"))[:512] if body.get("client_uri") else None),
        logo_uri=(str(body.get("logo_uri"))[:512] if body.get("logo_uri") else None),
        redirect_uris=json.dumps(uris),
        token_endpoint_auth_method=method,
    )
    if method != "none":
        secret = secrets.token_urlsafe(32)
        c.client_secret_hash = _sha(secret)
    db.add(c)
    db.flush()
    out = {
        "client_id": c.id,
        "client_id_issued_at": int(time_service.aware(c.created_at).timestamp()),
        "client_name": c.client_name,
        "redirect_uris": uris,
        "token_endpoint_auth_method": method,
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "scope": SCOPE,
    }
    if c.client_uri:
        out["client_uri"] = c.client_uri
    if c.logo_uri:
        out["logo_uri"] = c.logo_uri
    if secret:
        out["client_secret"] = secret
        out["client_secret_expires_at"] = 0
    return out


def get_client(db: Session, client_id: str) -> OAuthClient | None:
    if not client_id:
        return None
    return db.query(OAuthClient).filter(OAuthClient.id == client_id).first()


def authenticate_client(db: Session, client_id: str, client_secret: str | None) -> OAuthClient:
    c = get_client(db, client_id)
    if not c:
        raise OAuthError("invalid_client", "沒有這個 client", 401)
    if c.token_endpoint_auth_method == "none":
        return c
    if not client_secret or _sha(client_secret) != c.client_secret_hash:
        raise OAuthError("invalid_client", "client_secret 不對", 401)
    return c


# ───────── authorize ─────────

def start_request(db: Session, params: dict) -> OAuthRequest:
    """驗 /oauth/authorize 的參數。client／redirect_uri 錯 → 丟 OAuthError（不能跳回去）；其他錯 → 也丟，router 決定要不要 redirect。"""
    client = get_client(db, params.get("client_id", ""))
    if not client:
        raise OAuthError("invalid_client", "沒有這個 client_id", 400)
    redirect_uri = params.get("redirect_uri") or ""
    uris = json.loads(client.redirect_uris or "[]")
    if not redirect_uri:
        if len(uris) == 1:
            redirect_uri = uris[0]
        else:
            raise OAuthError("invalid_request", "要帶 redirect_uri", 400)
    if redirect_uri not in uris:
        raise OAuthError("invalid_request", "redirect_uri 跟登記的不一樣", 400)
    if params.get("response_type") != "code":
        raise OAuthError("unsupported_response_type", "只支援 response_type=code")
    if (params.get("code_challenge_method") or "S256") != "S256":
        raise OAuthError("invalid_request", "PKCE 只支援 S256")
    challenge = params.get("code_challenge") or ""
    if not (43 <= len(challenge) <= 128):
        raise OAuthError("invalid_request", "要帶 PKCE code_challenge")
    scope = (params.get("scope") or SCOPE).strip()
    if any(s not in (SCOPE,) for s in scope.split()):
        raise OAuthError("invalid_scope", f"scope 只有 {SCOPE}")
    resource = params.get("resource")
    if resource and resource.rstrip("/") != resource_url():
        raise OAuthError("invalid_target", f"resource 要是 {resource_url()}")
    req = OAuthRequest(
        client_id=client.id,
        redirect_uri=redirect_uri,
        scope=SCOPE,
        state=params.get("state"),
        code_challenge=challenge,
        resource=resource,
        expires_at=_now() + REQUEST_TTL,
    )
    db.add(req)
    db.flush()
    return req


def consent_url(req: OAuthRequest) -> str:
    target = settings.oauth_consent_url.strip() or f"{base()}/oauth/consent"
    sep = "&" if "?" in target else "?"
    return f"{target}{sep}request_id={req.id}"


def get_request(db: Session, request_id: str) -> OAuthRequest | None:
    return db.query(OAuthRequest).filter(OAuthRequest.id == request_id).first()


def request_view(db: Session, req: OAuthRequest, user: User) -> dict:
    """給同意頁看的：誰在要、要連哪位室友。過期／已決定 → 410。"""
    if time_service.aware(req.expires_at) < _now() or req.status != "pending":
        raise OAuthError("expired", "這個授權請求已經過期或處理過了，請回到 app 重新連線", 410)
    client = get_client(db, req.client_id)
    agent = db.query(Agent).filter(Agent.user_id == user.id).first()
    return {
        "request_id": req.id,
        "client_name": client.client_name or urlparse(req.redirect_uri).netloc,
        "client_uri": client.client_uri,
        "logo_uri": client.logo_uri,
        "redirect_host": urlparse(req.redirect_uri).netloc,
        "scopes": req.scope.split(),
        "agent_id": agent.id if agent else None,
        "agent_name": agent.name if agent else None,
        "agent_avatar_emoji": agent.avatar_emoji if agent else None,
        "agent_avatar_url": agent.avatar_url if agent else None,
        "expires_at": time_service.aware(req.expires_at).isoformat(),
    }


def decide(db: Session, req: OAuthRequest, user: User, approve: bool) -> str:
    """住戶按同意／拒絕。回要跳回去的網址（帶 code 或 error）。"""
    if time_service.aware(req.expires_at) < _now() or req.status != "pending":
        raise OAuthError("expired", "這個授權請求已經過期或處理過了", 410)
    q: dict = {}
    if req.state:
        q["state"] = req.state
    if not approve:
        req.status = "denied"
        q["error"] = "access_denied"
        q["error_description"] = "住戶拒絕了"
    else:
        agent = db.query(Agent).filter(Agent.user_id == user.id).first()
        if not agent:
            raise OAuthError("access_denied", "你還沒有 AI 室友，先領養再連", 400)
        code = secrets.token_urlsafe(32)
        req.status = "approved"
        req.code_hash = _sha(code)
        req.code_expires_at = _now() + CODE_TTL
        req.user_id = user.id
        req.agent_id = agent.id
        q["code"] = code
    db.flush()
    sep = "&" if "?" in req.redirect_uri else "?"
    return f"{req.redirect_uri}{sep}{urlencode(q)}"


# ───────── token ─────────

def _access_token(grant: OAuthGrant, username: str) -> tuple[str, int]:
    ttl = settings.oauth_access_minutes * 60
    payload = {
        "sub": grant.user_id,
        "username": username,
        "type": "oauth",
        "jti": grant.id,
        "client_id": grant.client_id,
        "scope": grant.scope,
        "aud": resource_url(),
        "exp": _now() + timedelta(seconds=ttl),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM), ttl


def _issue(db: Session, grant: OAuthGrant) -> dict:
    user = db.query(User).filter(User.id == grant.user_id).first()
    if not user or not user.is_active:
        raise OAuthError("invalid_grant", "帳號不存在或已停用")
    refresh = secrets.token_urlsafe(48)
    grant.refresh_token_hash = _sha(refresh)
    grant.refresh_expires_at = _now() + timedelta(days=settings.oauth_refresh_days)
    grant.last_used_at = _now()
    db.flush()
    access, ttl = _access_token(grant, user.username if user else "")
    return {"access_token": access, "token_type": "Bearer", "expires_in": ttl, "refresh_token": refresh, "scope": grant.scope}


def exchange_code(db: Session, client: OAuthClient, code: str, redirect_uri: str | None, code_verifier: str | None, resource: str | None) -> dict:
    if not code or not code_verifier:
        raise OAuthError("invalid_request", "要帶 code 和 code_verifier")
    req = db.query(OAuthRequest).filter(OAuthRequest.code_hash == _sha(code)).first()
    if not req or req.client_id != client.id or req.status != "approved":
        raise OAuthError("invalid_grant", "code 不對或已經用過")
    if time_service.aware(req.code_expires_at) < _now():
        req.status = "expired"
        db.flush()
        raise OAuthError("invalid_grant", "code 過期了，請重新授權")
    if redirect_uri and redirect_uri != req.redirect_uri:
        raise OAuthError("invalid_grant", "redirect_uri 跟授權時不一樣")
    digest = hashlib.sha256(code_verifier.encode()).digest()
    if base64.urlsafe_b64encode(digest).rstrip(b"=").decode() != req.code_challenge:
        raise OAuthError("invalid_grant", "PKCE 驗證失敗")
    if resource and resource.rstrip("/") != resource_url():
        raise OAuthError("invalid_target", f"resource 要是 {resource_url()}")
    req.status = "exchanged"
    grant = OAuthGrant(user_id=req.user_id, agent_id=req.agent_id, client_id=client.id, scope=req.scope)
    db.add(grant)
    db.flush()
    return _issue(db, grant)


def refresh(db: Session, client: OAuthClient, refresh_token: str | None) -> dict:
    if not refresh_token:
        raise OAuthError("invalid_request", "要帶 refresh_token")
    grant = db.query(OAuthGrant).filter(OAuthGrant.refresh_token_hash == _sha(refresh_token)).first()
    if not grant or grant.client_id != client.id or grant.revoked_at is not None:
        raise OAuthError("invalid_grant", "refresh_token 不對或已撤銷")
    if grant.refresh_expires_at and time_service.aware(grant.refresh_expires_at) < _now():
        raise OAuthError("invalid_grant", "refresh_token 過期了，請重新授權")
    return _issue(db, grant)  # 換新 refresh，舊的立刻失效


def revoke(db: Session, client: OAuthClient | None, token: str) -> None:
    """RFC 7009：撤銷 refresh 或 access（access 是 JWT，撤它＝撤整筆 grant）。找不到也回 200。"""
    grant = db.query(OAuthGrant).filter(OAuthGrant.refresh_token_hash == _sha(token)).first()
    if not grant:
        try:
            payload = jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM], options={"verify_aud": False, "verify_exp": False})
        except Exception:
            payload = {}
        if payload.get("type") == "oauth" and payload.get("jti"):
            grant = db.query(OAuthGrant).filter(OAuthGrant.id == payload["jti"]).first()
    if grant and (client is None or grant.client_id == client.id) and grant.revoked_at is None:
        grant.revoked_at = _now()
        grant.refresh_token_hash = None
        db.flush()


# ───────── 給 MCP 驗的 ─────────

def verify_access(db: Session, payload: dict) -> str | None:
    """type=oauth 的 JWT 已經過 decode（含 exp）；再看 grant 沒撤銷。回 grant id，順手記 last_used_at。"""
    gid = payload.get("jti")
    if not gid:
        return None
    grant = db.query(OAuthGrant).filter(OAuthGrant.id == gid).first()
    if not grant or grant.revoked_at is not None or grant.user_id != payload.get("sub"):
        return None
    if payload.get("aud") != resource_url() or payload.get("client_id") != grant.client_id:
        return None
    user = db.query(User).filter(User.id == grant.user_id, User.is_active.is_(True)).first()
    if not user:
        return None
    grant.last_used_at = _now()
    db.commit()
    return grant.id


# ───────── 住戶看自己的授權 ─────────

def list_grants(db: Session, user_id: str) -> list[dict]:
    rows = db.query(OAuthGrant).filter(OAuthGrant.user_id == user_id).order_by(OAuthGrant.created_at.desc()).all()
    clients = {c.id: c for c in db.query(OAuthClient).filter(OAuthClient.id.in_([r.client_id for r in rows])).all()} if rows else {}
    out = []
    for g in rows:
        c = clients.get(g.client_id)
        out.append({
            "id": g.id,
            "client_name": (c.client_name if c else "") or (urlparse(json.loads(c.redirect_uris)[0]).netloc if c and c.redirect_uris != "[]" else "?"),
            "client_uri": c.client_uri if c else None,
            "logo_uri": c.logo_uri if c else None,
            "scope": g.scope,
            "created_at": time_service.aware(g.created_at).isoformat(),
            "last_used_at": time_service.aware(g.last_used_at).isoformat() if g.last_used_at else None,
            "revoked_at": time_service.aware(g.revoked_at).isoformat() if g.revoked_at else None,
        })
    return out


def revoke_grant(db: Session, user_id: str, grant_id: str) -> bool:
    g = db.query(OAuthGrant).filter(OAuthGrant.id == grant_id, OAuthGrant.user_id == user_id).first()
    if not g:
        return False
    if g.revoked_at is None:
        g.revoked_at = _now()
        g.refresh_token_hash = None
    db.flush()
    return True
