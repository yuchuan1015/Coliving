from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from models.agent import Agent
from models.user import User
from schemas.ai_chat import (
    AgentBrief,
    AIConversationDetail,
    AIConversationOut,
    AIMessageOut,
    InitiateDMRequest,
    InitiateDMResponse,
)
from services import agent_service, ai_chat_service
from utils.deps import get_current_user, get_db

router = APIRouter(prefix="/api/ai-chat", tags=["ai-chat"])


def _agent_brief(agent: Agent) -> dict:
    return {"id": agent.id, "name": agent.name, "avatar_emoji": agent.avatar_emoji}


def _conv_to_out(db: Session, conv) -> dict:
    a = db.query(Agent).filter(Agent.id == conv.agent_a_id).first()
    b = db.query(Agent).filter(Agent.id == conv.agent_b_id).first()
    return {
        "id": conv.id,
        "agent_a": _agent_brief(a) if a else {"id": conv.agent_a_id, "name": "?", "avatar_emoji": "\U0001f916"},
        "agent_b": _agent_brief(b) if b else {"id": conv.agent_b_id, "name": "?", "avatar_emoji": "\U0001f916"},
        "status": conv.status,
        "turn_count": conv.turn_count,
        "ended_reason": conv.ended_reason,
        "created_at": conv.created_at,
        "last_message_at": conv.last_message_at,
    }


def _msg_to_out(db: Session, msg) -> dict:
    sender = db.query(Agent).filter(Agent.id == msg.sender_agent_id).first()
    return {
        "id": msg.id,
        "sender": _agent_brief(sender) if sender else {"id": msg.sender_agent_id, "name": "?", "avatar_emoji": "\U0001f916"},
        "content": msg.content,
        "action": msg.action,
        "created_at": msg.created_at,
    }


@router.post("/initiate", response_model=InitiateDMResponse)
def initiate_dm(
    body: InitiateDMRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from_agent = agent_service.get_user_agent(db, current_user.id)
    if not from_agent:
        raise HTTPException(status_code=404, detail="你還沒有 AI 室友")

    to_agent = db.query(Agent).filter(Agent.name == body.to_agent_name).first()
    if not to_agent:
        raise HTTPException(status_code=404, detail=f"找不到名叫「{body.to_agent_name}」的室友")
    if to_agent.id == from_agent.id:
        raise HTTPException(status_code=400, detail="不能私訊自己")

    conv = ai_chat_service.initiate_conversation(db, from_agent, to_agent, body.message)
    messages = ai_chat_service.get_messages(db, conv.id)

    return {
        "conversation": _conv_to_out(db, conv),
        "messages": [_msg_to_out(db, m) for m in messages],
    }


@router.get("/conversations", response_model=list[AIConversationOut])
def list_conversations(
    limit: int = Query(default=20, ge=1, le=50),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = agent_service.get_user_agent(db, current_user.id)
    if not agent:
        raise HTTPException(status_code=404, detail="你還沒有 AI 室友")

    convs = ai_chat_service.list_conversations(db, agent.id, limit)
    return [_conv_to_out(db, c) for c in convs]


@router.get("/{conversation_id}", response_model=AIConversationDetail)
def get_conversation_detail(
    conversation_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = agent_service.get_user_agent(db, current_user.id)
    if not agent:
        raise HTTPException(status_code=404, detail="你還沒有 AI 室友")

    conv = ai_chat_service.get_conversation(db, conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="找不到這個對話")
    if conv.agent_a_id != agent.id and conv.agent_b_id != agent.id:
        raise HTTPException(status_code=403, detail="你不是這個對話的參與者")

    messages = ai_chat_service.get_messages(db, conv.id)
    out = _conv_to_out(db, conv)
    out["messages"] = [_msg_to_out(db, m) for m in messages]
    return out
