import json

from datetime import datetime, timezone

import os
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from models.mcp_token import McpToken
from models.user import User
from schemas.agent import AgentPublic, CreateAgentRequest, UpdateAgentRequest
from services import bed_service, agent_service, auth_service
from services.llm_service import PROVIDERS, PRIVACY_DISCLAIMER
from utils.deps import get_current_user, get_db

router = APIRouter(prefix="/api/agents", tags=["agents"])


def _agent_to_public(agent, user=None) -> dict:
    """只用在「自己的」室友（create / mine / update），所以可以帶私訊碼。"""
    from services import ai_chat_service
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
        "avatar_url": agent.avatar_url,
        "display_brain": agent.display_brain,
        "memory_mcp": agent.memory_mcp,
        "memory_recall_tool": agent.memory_recall_tool,
        "status": agent.status,
        "ob_enabled": agent.ob_enabled,
        "external_mcps": ext_mcps,
        "active_skin_id": agent.active_skin_id,
        "dm_code": ai_chat_service.dm_code_for(agent, user) if user else None,  # 自己的私訊碼
        "dm_code_public": bool(agent.dm_code_public),  # 名錄上看不看得到
        "status_note": agent.status_note,               # 他自己掛的牌子，只有他能改（MCP home profile）
        "created_at": agent.created_at.isoformat(),
        "updated_at": agent.updated_at.isoformat() if agent.updated_at else None,
    }


@router.get("/providers")
def list_providers():
    """列出可用的 AI 供應商和免責聲明。前端用來渲染大腦設定頁。"""
    return {
        "providers": [{"key": k, "name": v["name"]} for k, v in PROVIDERS.items()],
        "disclaimer": PRIVACY_DISCLAIMER,
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
    user = db.query(User).filter(User.id == current_user.id).first()  # 領養時第一個日子剛寫進去，用這個 session 的
    # 領養就配第一把鑰匙（她定：一個 agent 一把固定鑰匙，貼進連接器一次就好）
    key = bed_service.issue_key(db, user.id, agent.id, label="第一把")
    db.commit()
    db.refresh(key)
    out = _agent_to_public(agent, user)
    out["first_key"] = {"token_id": key.id, "label": key.label, **bed_service.connect_info(key, user.username)}
    return out


@router.get("/mine", response_model=AgentPublic)
def get_my_agent(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = agent_service.get_user_agent(db, current_user.id)
    if not agent:
        raise HTTPException(status_code=404, detail="你還沒有 AI 室友")
    return _agent_to_public(agent, current_user)



AVATAR_DIR = "/opt/coliving/backend/uploads/avatars"
AVATAR_MAX_SIZE = 2 * 1024 * 1024  # 2MB
AVATAR_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}


@router.post("/mine/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """上傳照片頭像。最大 2MB，接受 jpg/png/webp/gif。有照片時前端優先顯示照片，沒有就顯示 emoji。"""
    agent = agent_service.get_user_agent(db, current_user.id)
    if not agent:
        raise HTTPException(status_code=404, detail="你還沒有 AI 室友")
    if file.content_type not in AVATAR_TYPES:
        raise HTTPException(status_code=400, detail="只接受 jpg / png / webp / gif")
    data = await file.read()
    if len(data) > AVATAR_MAX_SIZE:
        raise HTTPException(status_code=400, detail="檔案太大，最多 2MB")
    os.makedirs(AVATAR_DIR, exist_ok=True)
    # 副檔名照 content_type 決定，不信檔名（傳 avatar.html 也只會存成圖片副檔名）
    ext = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif"}[file.content_type]
    fname = f"{uuid.uuid4().hex}.{ext}"
    path = os.path.join(AVATAR_DIR, fname)
    with open(path, "wb") as f:
        f.write(data)
    # Delete old file if exists
    if agent.avatar_url:
        old_path = os.path.join(AVATAR_DIR, agent.avatar_url.rsplit("/", 1)[-1])
        if os.path.exists(old_path):
            os.remove(old_path)
    agent.avatar_url = f"/uploads/avatars/{fname}"
    db.commit()
    return {"avatar_url": agent.avatar_url}


@router.delete("/mine/avatar")
def delete_avatar(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """刪除照片頭像，回到只用 emoji。"""
    agent = agent_service.get_user_agent(db, current_user.id)
    if not agent:
        raise HTTPException(status_code=404, detail="你還沒有 AI 室友")
    if agent.avatar_url:
        old_path = os.path.join(AVATAR_DIR, agent.avatar_url.rsplit("/", 1)[-1])
        if os.path.exists(old_path):
            os.remove(old_path)
        agent.avatar_url = None
        db.commit()
    return {"avatar_url": None}


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
    row = bed_service.issue_key(db, current_user.id, agent.id, body.label if body else "")
    db.commit()
    db.refresh(row)
    return {**_token_to_out(row), **bed_service.connect_info(row, current_user.username)}


@router.get("/mine/mcp-tokens")
def list_mcp_tokens(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """列出鑰匙。沒作廢的每把都帶 mcp_token / connect_url / claude_code_cmd（同一把重新算出來的，隨時看得到、複製得到）。"""
    rows = db.query(McpToken).filter(McpToken.user_id == current_user.id).order_by(McpToken.created_at.desc()).all()
    out = []
    for t in rows:
        d = _token_to_out(t)
        if t.revoked_at is None:
            d.update(bed_service.connect_info(t, current_user.username))
        out.append(d)
    return out


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
    user = db.query(User).filter(User.id == current_user.id).first()
    return _agent_to_public(agent, user)
