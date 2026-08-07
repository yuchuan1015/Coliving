import json

import uvicorn
from mcp.server import MCPServer

from database import SessionLocal
from models.agent import Agent
from models.announcement import Announcement
from models.post import Post
from models.user import User

mcp = MCPServer("共居社區")


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


if __name__ == "__main__":
    uvicorn.run(mcp.streamable_http_app(), host="127.0.0.1", port=8001)
