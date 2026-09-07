"""住戶的記憶管理：列表、搜尋、刪除單條、匯出全部。
mem0 只活在 api 程序，這些路由直接呼叫 mem0_service。
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from models.agent import Agent
from models.user import User
from services import agent_service, mem0_service
from utils.deps import get_current_user, get_db

router = APIRouter(prefix="/api/memory", tags=["memory"])


def _get_agent_or_403(db: Session, user: User) -> Agent:
    agent = db.query(Agent).filter(Agent.user_id == user.id).first()
    if not agent:
        raise HTTPException(status_code=403, detail="需要先有室友")
    return agent


def _require_mem0(agent: Agent) -> None:
    if not mem0_service.is_enabled():
        raise HTTPException(status_code=503, detail="社區記憶系統未開啟")
    if not mem0_service.should_use(agent):
        raise HTTPException(status_code=400, detail="這個室友使用自帶的記憶系統，不用社區的 mem0")


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    limit: int = Field(default=10, ge=1, le=50)


class RememberRequest(BaseModel):
    text: str = Field(min_length=1, max_length=5000)


@router.get("")
def list_memories(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """列出這個住戶的所有記憶（mem0 存的）。"""
    agent = _get_agent_or_403(db, current_user)
    _require_mem0(agent)
    items = mem0_service.get_all(agent)
    return {"items": items, "count": len(items)}


@router.post("/search")
def search_memories(
    body: SearchRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """搜記憶，回最相關的幾條。"""
    agent = _get_agent_or_403(db, current_user)
    _require_mem0(agent)
    items = mem0_service.search(agent, body.query, body.limit)
    return {"items": items, "count": len(items), "query": body.query}


@router.post("/remember")
def remember(
    body: RememberRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """手動存一條記憶。"""
    agent = _get_agent_or_403(db, current_user)
    _require_mem0(agent)
    ok = mem0_service.add_direct(agent, body.text.strip())
    if not ok:
        raise HTTPException(status_code=500, detail="寫入失敗")
    return {"ok": True, "message": "已記住"}


@router.delete("/{memory_id}")
def delete_memory(
    memory_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """刪一條記憶。"""
    agent = _get_agent_or_403(db, current_user)
    _require_mem0(agent)
    ok = mem0_service.delete_one(agent, memory_id)
    if not ok:
        raise HTTPException(status_code=404, detail="找不到這條記憶")
    return {"ok": True}


@router.get("/export")
def export_memories(
    format: str = Query(default="json", pattern="^(json|markdown)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """匯出全部記憶。format=json 回 JSON；format=markdown 回 markdown 文字。"""
    agent = _get_agent_or_403(db, current_user)
    _require_mem0(agent)
    items = mem0_service.get_all(agent)
    if format == "markdown":
        lines = [f"# {agent.name} 的記憶\n"]
        for it in items:
            ts = it.get("created_at", "")[:10] if it.get("created_at") else ""
            lines.append(f"- [{ts}] {it.get('text', '')}")
        return {"format": "markdown", "content": "\n".join(lines), "count": len(items)}
    return {"format": "json", "items": items, "count": len(items)}
