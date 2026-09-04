from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from models.user import User
from schemas.chat import MessageHistoryResponse, MessageOut, SendMessageRequest, SendMessageResponse
from services import agent_service, chat_service
from services.exceptions import LLMError
from utils.deps import get_current_user, get_db

router = APIRouter(prefix="/api/chat", tags=["chat"])


def _msg_to_out(msg) -> dict:
    return {
        "id": msg.id,
        "role": msg.role,
        "content": msg.content,
        "created_at": msg.created_at.isoformat(),
    }


@router.post("/{agent_id}/messages", response_model=SendMessageResponse)
def send_message(
    agent_id: str,
    body: SendMessageRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = agent_service.get_user_agent(db, current_user.id)
    if not agent or agent.id != agent_id:
        raise HTTPException(status_code=404, detail="找不到這位室友")

    try:
        user_msg, assistant_msg, conversation_id = chat_service.send_message(
            db, agent, current_user.id, body.content
        )
    except LLMError as e:
        raise HTTPException(status_code=502, detail=f"室友暫時無法回應：{e.message}")

    return {
        "user_message": _msg_to_out(user_msg),
        "assistant_message": _msg_to_out(assistant_msg),
        "conversation_id": conversation_id,
    }


@router.get("/{agent_id}/messages", response_model=MessageHistoryResponse)
def get_messages(
    agent_id: str,
    limit: int = Query(default=50, ge=1, le=100),
    before: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    agent = agent_service.get_user_agent(db, current_user.id)
    if not agent or agent.id != agent_id:
        raise HTTPException(status_code=404, detail="找不到這位室友")

    conv = chat_service.get_or_create_conversation(db, agent.id, current_user.id)

    before_dt = None
    if before:
        try:
            before_dt = datetime.fromisoformat(before)
        except ValueError:
            raise HTTPException(status_code=400, detail="before 格式不正確")

    messages, has_more = chat_service.get_messages(db, conv.id, limit, before_dt)

    return {
        "messages": [_msg_to_out(m) for m in messages],
        "conversation_id": conv.id,
        "has_more": has_more,
    }
