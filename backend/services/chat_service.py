from datetime import datetime, timezone

from sqlalchemy.orm import Session

from models.agent import Agent
from models.conversation import Conversation
from models.message import Message
from services import crypto_service, llm_service
from services.exceptions import LLMError

_HISTORY_WINDOW = 50


def get_or_create_conversation(db: Session, agent_id: str, user_id: str) -> Conversation:
    conv = db.query(Conversation).filter(
        Conversation.agent_id == agent_id,
        Conversation.user_id == user_id,
    ).first()
    if conv:
        return conv

    conv = Conversation(agent_id=agent_id, user_id=user_id)
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return conv


def send_message(db: Session, agent: Agent, user_id: str, content: str) -> tuple[Message, Message, str]:
    conv = get_or_create_conversation(db, agent.id, user_id)

    user_msg = Message(conversation_id=conv.id, role="user", content=content)
    db.add(user_msg)
    db.flush()

    history = (
        db.query(Message)
        .filter(Message.conversation_id == conv.id)
        .order_by(Message.created_at.desc())
        .limit(_HISTORY_WINDOW)
        .all()
    )
    history.reverse()

    messages_for_llm = [{"role": m.role, "content": m.content} for m in history]

    api_key = crypto_service.decrypt_api_key(agent.encrypted_api_key)
    response_text = llm_service.chat_completion(
        provider=agent.llm_provider,
        model=agent.llm_model,
        api_key=api_key,
        system_prompt=agent.persona,
        messages=messages_for_llm,
    )

    assistant_msg = Message(conversation_id=conv.id, role="assistant", content=response_text)
    db.add(assistant_msg)

    conv.last_message_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user_msg)
    db.refresh(assistant_msg)

    return user_msg, assistant_msg, conv.id


def get_messages(
    db: Session,
    conversation_id: str,
    limit: int = 50,
    before: datetime | None = None,
) -> tuple[list[Message], bool]:
    query = db.query(Message).filter(Message.conversation_id == conversation_id)
    if before:
        query = query.filter(Message.created_at < before)
    query = query.order_by(Message.created_at.desc()).limit(limit + 1)

    results = query.all()
    has_more = len(results) > limit
    messages = results[:limit]
    messages.reverse()
    return messages, has_more
