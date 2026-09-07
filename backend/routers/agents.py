import json

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from models.mcp_token import McpToken
from models.user import User
from schemas.agent import AgentPublic, CreateAgentRequest, UpdateAgentRequest
from services import agent_service, auth_service
from utils.deps import get_current_user, get_db

router = APIRouter(prefix="/api/agents", tags=["agents"])


def _agent_to_public(agent) -> dict:
    try:
        ext_mcps = json.loads(agent.external_mcps) if agent.external_mcps else []
    except (json.JSONDecodeError, TypeError):
        ext_mcps = []
    return {
        "id": agent.id,
        "name": agent.name,
        "persona": agent.persona,
        "llm_provider": agent.llm_provider,
        "llm_model": agent.llm_model,
        "has_api_key": bool(agent.encrypted_api_key),
        "avatar_emoji": agent.avatar_emoji,
        "display_brain": agent.display_brain,
        "memory_mcp": agent.memory_mcp,
        "memory_recall_tool": agent.memory_recall_tool,
        "status": agent.status,
        "ob_enabled": agent.ob_enabled,
        "external_mcps": ext_mcps,
        "active_skin_id": agent.active_skin_id,
        "created_at": agent.created_at.isoformat(),
        "updated_at": agent.updated_at.isoformat() if agent.updated_at else None,
    }


@router.post("", response_model=AgentPublic, status_code=201)
def create_agent(
    body: CreateAgentRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        agent = agent_service.create_agent(
            db=db,
            user_id=current_user.id,
            name=body.name,
            persona=body.persona,
            llm_provider=body.llm_provider,
            llm_model=body.llm_model,
            api_key=body.api_key,
            avatar_emoji=body.avatar_emoji,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _agent_to_public(agent)


@router.get("/mine", response_model=AgentPublic)
def get_my_agent(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = agent_service.get_user_agent(db, current_user.id)
    if not agent:
        raise HTTPException(status_code=404, detail="你還沒有 AI 室友")
    return _agent_to_public(agent)


class McpTokenRequest(BaseModel):
    label: str = Field(default="", max_length=32)  # 例：「CC 主窗」「cron 窗」「Telegram」


def _token_to_out(t: McpToken) -> dict:
    return {
        "token_id": t.id,
        "label": t.label,
        "created_at": t.created_at.isoformat(),
        "last_used_at": t.last_used_at.isoformat() if t.last_used_at else None,
        "revoked_at": t.revoked_at.isoformat() if t.revoked_at else None,
    }


@router.post("/mine/mcp-token")
def generate_mcp_token(
    body: McpTokenRequest | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """產一把鑰匙。不限數量；每把有 label，之後每筆寫入看得出是哪把做的。"""
    agent = agent_service.get_user_agent(db, current_user.id)
    if not agent:
        raise HTTPException(status_code=404, detail="你還沒有 AI 室友")
    row = McpToken(user_id=current_user.id, agent_id=agent.id, label=(body.label.strip() if body else ""))
    db.add(row)
    db.commit()
    db.refresh(row)
    token = auth_service.create_mcp_token(current_user.id, current_user.username, token_id=row.id)
    return {"mcp_token": token, **_token_to_out(row)}


@router.get("/mine/mcp-tokens")
def list_mcp_tokens(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = db.query(McpToken).filter(McpToken.user_id == current_user.id).order_by(McpToken.created_at.desc()).all()
    return [_token_to_out(t) for t in rows]


@router.delete("/mine/mcp-tokens/{token_id}", status_code=204)
def revoke_mcp_token(
    token_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """作廢一把鑰匙。用它的 MCP 呼叫立刻失效。"""
    row = db.query(McpToken).filter(McpToken.id == token_id, McpToken.user_id == current_user.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="找不到這把鑰匙")
    if row.revoked_at is None:
        row.revoked_at = datetime.now(timezone.utc)
        db.commit()


@router.patch("/{agent_id}", response_model=AgentPublic)
def update_agent(
    agent_id: str,
    body: UpdateAgentRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="沒有提供要更新的欄位")
    try:
        agent = agent_service.update_agent(db, agent_id, current_user.id, updates)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _agent_to_public(agent)
