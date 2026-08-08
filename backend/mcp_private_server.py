import json

import uvicorn
from mcp.server import MCPServer
from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.auth.settings import AuthSettings
from mcp.server.transport_security import TransportSecuritySettings

from database import SessionLocal
from mcp_token_verifier import ColiveTokenVerifier
from models.agent import Agent
from models.announcement import Announcement
from models.post import Post
from models.user import User
from services import agent_service, chat_service

mcp = MCPServer(
    "共居社區-私人",
    token_verifier=ColiveTokenVerifier(),
    auth=AuthSettings(
        issuer_url="https://therookery.duckdns.org",
        resource_server_url="https://therookery.duckdns.org/mcp-auth",
    ),
)


def _current_user_id() -> str:
    token = get_access_token()
    if not token:
        raise ValueError("未認證")
    return token.client_id


@mcp.tool()
def community_status() -> str:
    """取得社區狀態：居民數、AI 室友數、社區階段。"""
    db = SessionLocal()
    try:
        resident_count = db.query(User).filter(User.is_active.is_(True)).count()
        agent_count = db.query(Agent).count()
        return json.dumps({
            "resident_count": resident_count,
            "agent_count": agent_count,
            "phase": 4,
            "message": "社區已開放公共區域與 MCP 介面",
        }, ensure_ascii=False)
    finally:
        db.close()


@mcp.tool()
def announcements(limit: int = 10) -> str:
    """取得最新公告，置頂優先。"""
    db = SessionLocal()
    try:
        rows = (
            db.query(Announcement, User.display_name)
            .join(User, User.id == Announcement.author_id)
            .order_by(Announcement.is_pinned.desc(), Announcement.created_at.desc())
            .limit(limit)
            .all()
        )
        result = [
            {
                "title": a.title,
                "content": a.content,
                "author": name,
                "is_pinned": a.is_pinned,
                "created_at": a.created_at.isoformat(),
            }
            for a, name in rows
        ]
        return json.dumps(result, ensure_ascii=False)
    finally:
        db.close()


@mcp.tool()
def posts(limit: int = 20) -> str:
    """取得最新留言板訊息。匿名留言不顯示作者。"""
    db = SessionLocal()
    try:
        rows = (
            db.query(Post, User.display_name)
            .join(User, User.id == Post.author_id)
            .order_by(Post.created_at.desc())
            .limit(limit)
            .all()
        )
        result = [
            {
                "author": "匿名居民" if p.is_anonymous else name,
                "content": p.content,
                "created_at": p.created_at.isoformat(),
            }
            for p, name in rows
        ]
        return json.dumps(result, ensure_ascii=False)
    finally:
        db.close()


@mcp.tool()
def residents() -> str:
    """列出所有居民與其 AI 室友資訊。"""
    db = SessionLocal()
    try:
        rows = (
            db.query(User, Agent)
            .outerjoin(Agent, Agent.user_id == User.id)
            .filter(User.is_active.is_(True))
            .order_by(User.created_at)
            .all()
        )
        result = [
            {
                "display_name": u.display_name,
                "role": u.role,
                "agent_name": a.name if a else None,
                "agent_emoji": a.avatar_emoji if a else None,
            }
            for u, a in rows
        ]
        return json.dumps(result, ensure_ascii=False)
    finally:
        db.close()


@mcp.tool()
def post_message(content: str, is_anonymous: bool = False) -> str:
    """在社區留言板發布一則留言。"""
    user_id = _current_user_id()
    db = SessionLocal()
    try:
        post = Post(author_id=user_id, content=content, is_anonymous=is_anonymous)
        db.add(post)
        db.commit()
        db.refresh(post)
        return json.dumps({
            "success": True,
            "post_id": post.id,
            "message": "留言發布成功",
        }, ensure_ascii=False)
    finally:
        db.close()


@mcp.tool()
def chat_with_agent(message: str) -> str:
    """跟你的 AI 室友聊天，傳送訊息並取得回應。"""
    user_id = _current_user_id()
    db = SessionLocal()
    try:
        agent = agent_service.get_user_agent(db, user_id)
        if not agent:
            return json.dumps({"success": False, "error": "你還沒有 AI 室友"}, ensure_ascii=False)
        _, assistant_msg, _ = chat_service.send_message(db, agent, user_id, message)
        return json.dumps({
            "success": True,
            "response": assistant_msg.content,
        }, ensure_ascii=False)
    except Exception as e:
        return json.dumps({"success": False, "error": str(e)}, ensure_ascii=False)
    finally:
        db.close()


if __name__ == "__main__":
    security = TransportSecuritySettings(enable_dns_rebinding_protection=False)
    uvicorn.run(mcp.streamable_http_app(transport_security=security), host="127.0.0.1", port=8002)
