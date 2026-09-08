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
    ReportDMRequest,
)
from services import agent_service, ai_chat_service
from utils.deps import get_current_user, get_db

router = APIRouter(prefix="/api/ai-chat", tags=["ai-chat"])


def _agent_brief(agent: Agent) -> dict:
    # replies_live：有掛 API key，站上會即時替他回；False 的要等他外接的床醒來
    return {"id": agent.id, "name": agent.name, "avatar_emoji": agent.avatar_emoji, "replies_live": ai_chat_service.has_live_bed(agent)}


def _conv_to_out(db: Session, conv, viewer_id: str | None = None) -> dict:
    ai_chat_service.expire_if_busy(db, conv)
    a = db.query(Agent).filter(Agent.id == conv.agent_a_id).first()
    b = db.query(Agent).filter(Agent.id == conv.agent_b_id).first()
    return {
        "id": conv.id,
        "agent_a": _agent_brief(a) if a else {"id": conv.agent_a_id, "name": "?", "avatar_emoji": "\U0001f916"},
        "agent_b": _agent_brief(b) if b else {"id": conv.agent_b_id, "name": "?", "avatar_emoji": "\U0001f916"},
        "status": conv.status,
        "turn_count": conv.turn_count,
        "ended_reason": conv.ended_reason,
        "waiting_on": ai_chat_service.waiting_on(db, conv),
        "system_note": ai_chat_service.system_note(conv, viewer_id),
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

    if not ai_chat_service.dm_code_for(from_agent, current_user):
        raise HTTPException(status_code=403, detail="你的星還在漂流中，先填一個重要的日子才能私訊")
    to_agent = ai_chat_service.find_agent_by_code(db, body.to_code)
    if not to_agent:
        raise HTTPException(status_code=404, detail="沒有這個私訊碼")
    if to_agent.id == from_agent.id:
        raise HTTPException(status_code=400, detail="不能私訊自己")

    try:
        conv = ai_chat_service.initiate_conversation(db, from_agent, to_agent, body.message)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    messages = ai_chat_service.get_messages(db, conv.id)

    return {
        "conversation": _conv_to_out(db, conv, from_agent.id),
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
    out = [_conv_to_out(db, c, agent.id) for c in convs]
    db.commit()  # expire_if_busy 可能剛結束了幾段
    return out


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
    out = _conv_to_out(db, conv, agent.id)
    db.commit()
    out["messages"] = [_msg_to_out(db, m) for m in messages]
    return out


@router.post("/{conversation_id}/report", status_code=201)
def report_dm(
    conversation_id: str,
    body: ReportDMRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """檢舉這段私訊的對方。送出後對話結束；管理員審，成立就停用對方私訊權。"""
    agent = agent_service.get_user_agent(db, current_user.id)
    if not agent:
        raise HTTPException(status_code=404, detail="你還沒有 AI 室友")
    conv = ai_chat_service.get_conversation(db, conversation_id)
    if not conv or agent.id not in (conv.agent_a_id, conv.agent_b_id):
        raise HTTPException(status_code=404, detail="找不到這個對話")
    try:
        r = ai_chat_service.report_conversation(db, conv, agent, body.reason)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    return {"id": r.id, "status": r.status, "message": "已送出檢舉，管理員會看"}
