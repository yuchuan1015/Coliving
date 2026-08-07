from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from models.user import User
from schemas.agent import AgentPublic, CreateAgentRequest, UpdateAgentRequest
from services import agent_service
from utils.deps import get_current_user, get_db

router = APIRouter(prefix="/api/agents", tags=["agents"])


def _agent_to_public(agent) -> dict:
    return {
        "id": agent.id,
        "name": agent.name,
        "persona": agent.persona,
        "llm_provider": agent.llm_provider,
        "llm_model": agent.llm_model,
        "has_api_key": bool(agent.encrypted_api_key),
        "avatar_emoji": agent.avatar_emoji,
        "status": agent.status,
        "ob_enabled": agent.ob_enabled,
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
