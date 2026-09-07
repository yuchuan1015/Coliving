"""內部記憶路由：只綁 127.0.0.1，mcp / mcp-private 用它呼叫 mem0（qdrant 只能一個程序開）。
nginx 不暴露 /internal。驗 header X-Internal-Secret 對 .env 的 INTERNAL_SECRET。"""
import json
import os

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel

router = APIRouter(prefix="/internal/memory", tags=["internal"])

_SECRET = os.environ.get("INTERNAL_SECRET", "")


def _check(secret: str = Header(None, alias="X-Internal-Secret")):
    if not _SECRET or secret != _SECRET:
        raise HTTPException(status_code=403, detail="forbidden")


class AddRequest(BaseModel):
    agent_id: str
    messages: list[dict]


class SearchRequest(BaseModel):
    agent_id: str
    query: str
    limit: int = 10


class RememberRequest(BaseModel):
    agent_id: str
    text: str


@router.post("/add")
def internal_add(body: AddRequest, secret: str = Header(None, alias="X-Internal-Secret")):
    _check(secret)
    from database import SessionLocal
    from models.agent import Agent
    from services import mem0_service
    db = SessionLocal()
    try:
        agent = db.query(Agent).filter(Agent.id == body.agent_id).first()
        if not agent:
            return {"ok": False, "error": "agent not found"}
        mem0_service.add_background(agent, body.messages)
        return {"ok": True}
    finally:
        db.close()


@router.post("/search")
def internal_search(body: SearchRequest, secret: str = Header(None, alias="X-Internal-Secret")):
    _check(secret)
    from database import SessionLocal
    from models.agent import Agent
    from services import mem0_service
    db = SessionLocal()
    try:
        agent = db.query(Agent).filter(Agent.id == body.agent_id).first()
        if not agent:
            return {"items": [], "error": "agent not found"}
        items = mem0_service.search(agent, body.query, body.limit)
        return {"items": items}
    finally:
        db.close()


@router.post("/remember")
def internal_remember(body: RememberRequest, secret: str = Header(None, alias="X-Internal-Secret")):
    _check(secret)
    from database import SessionLocal
    from models.agent import Agent
    from services import mem0_service
    db = SessionLocal()
    try:
        agent = db.query(Agent).filter(Agent.id == body.agent_id).first()
        if not agent:
            return {"ok": False, "error": "agent not found"}
        ok = mem0_service.add_direct(agent, body.text)
        return {"ok": ok}
    finally:
        db.close()
