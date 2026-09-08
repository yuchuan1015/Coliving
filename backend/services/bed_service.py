"""床位（bed）：這筆寫入是哪張床做的。紀錄，不是位階（2026-09-07 鑰匙工單）。

值：mcp:<token_id>（外接床位，用哪把鑰匙）/ mcp:legacy（沒有 jti 的舊鑰匙）/ site（站上用 api_key 跑的那張床）
    / schedule（排程）/ web（人從前端）。
用 ContextVar 帶著走：MCP 驗完鑰匙就 set，REST 預設 web，activity_service.log 自動記。
"""
from __future__ import annotations

from contextvars import ContextVar
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from models.mcp_token import McpToken

_current_bed: ContextVar[str] = ContextVar("current_bed", default="web")

FIXED_LABELS = {"site": "站上", "schedule": "排程", "web": "網頁", "mcp:legacy": "舊鑰匙"}


def set_bed(bed: str) -> None:
    _current_bed.set(bed)


def get_bed() -> str:
    return _current_bed.get()


def mcp_bed(token_id: str | None) -> str:
    return f"mcp:{token_id}" if token_id else "mcp:legacy"


def bed_label(db: Session, bed: str | None) -> str | None:
    """給人看的名字：鑰匙的 label，或固定床位的中文。"""
    if not bed:
        return None
    if bed in FIXED_LABELS:
        return FIXED_LABELS[bed]
    if bed.startswith("mcp:"):
        t = db.query(McpToken).filter(McpToken.id == bed[4:]).first()
        return t.label or "未命名鑰匙" if t else "已刪除的鑰匙"
    return bed


def verify_token_row(db: Session, token_id: str | None) -> bool:
    """有 jti 的鑰匙要在表裡且沒作廢；沒 jti 的舊鑰匙放行（相容）。順手記 last_used_at。"""
    if not token_id:
        return True
    t = db.query(McpToken).filter(McpToken.id == token_id).first()
    if not t or t.revoked_at is not None:
        return False
    t.last_used_at = datetime.now(timezone.utc)
    db.commit()
    return True


# ───────── 鑰匙的樣子（2026-09-09 她定：一把固定鑰匙，嵌進連線，換窗不用重拿） ─────────

def oauth_bed(grant_id: str) -> str:
    return f"oauth:{grant_id}"


def token_string(row: McpToken, username: str) -> str:
    """把表裡這把鑰匙重新算出來（同 jti、同到期），給主人看／複製。"""
    from services import auth_service, time_service
    return auth_service.create_mcp_token(row.user_id, username, token_id=row.id, issued_at=time_service.aware(row.created_at))


def connect_info(row: McpToken, username: str) -> dict:
    from config import settings
    tok = token_string(row, username)
    base = settings.public_base_url.rstrip("/")
    return {
        "mcp_token": tok,
        "connect_url": f"{base}/mcp?token={tok}",  # Claude.ai 連接器：貼這條就好
        "claude_code_cmd": f'claude mcp add --transport http rookery {base}/mcp --header "Authorization: Bearer {tok}"',  # Claude Code：跑一次，之後所有窗共用
    }


def issue_key(db: Session, user_id: str, agent_id: str, label: str = "") -> McpToken:
    row = McpToken(user_id=user_id, agent_id=agent_id, label=(label or "").strip()[:32])
    db.add(row)
    db.flush()
    return row
