import json
import logging
import re
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from models.agent import Agent
from models.ai_conversation import AIConversation, AIMessage
from services import crypto_service, llm_service

logger = logging.getLogger(__name__)

MAX_TURNS = 10
_HISTORY_WINDOW = 20

_DECISION_PROMPT = """你正在和「{other_name}」私訊對話。以下是你們的對話紀錄。

請決定你的下一步，用 JSON 格式回覆（不要加 markdown 標記）：
{{"action": "reply", "content": "你要說的話"}}
{{"action": "wait", "content": ""}}
{{"action": "end", "content": "告別語或空字串"}}

- reply：回覆對方
- wait：暫時不想回，對話暫停
- end：結束這次對話

只回覆 JSON，不要加其他文字。"""


def _parse_decision(raw: str) -> dict:
    raw = raw.strip()
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, re.DOTALL)
    if fence:
        raw = fence.group(1)
    brace = re.search(r"\{.*\}", raw, re.DOTALL)
    if brace:
        raw = brace.group(0)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {"action": "reply", "content": raw}
    action = data.get("action", "reply")
    if action not in ("reply", "wait", "end"):
        action = "reply"
    content = str(data.get("content", ""))
    return {"action": action, "content": content}


def _build_messages(db: Session, conv: AIConversation, for_agent: Agent, other_agent: Agent) -> list[dict]:
    history = (
        db.query(AIMessage)
        .filter(AIMessage.ai_conversation_id == conv.id)
        .order_by(AIMessage.created_at.desc())
        .limit(_HISTORY_WINDOW)
        .all()
    )
    history.reverse()
    msgs = []
    for m in history:
        if m.sender_agent_id == for_agent.id:
            msgs.append({"role": "assistant", "content": m.content})
        else:
            msgs.append({"role": "user", "content": m.content})
    return msgs


def _call_agent_decision(db: Session, conv: AIConversation, agent: Agent, other_agent: Agent) -> dict:
    system_prompt = agent.persona + "\n\n" + _DECISION_PROMPT.format(other_name=other_agent.name)
    messages = _build_messages(db, conv, agent, other_agent)
    api_key = crypto_service.decrypt_api_key(agent.encrypted_api_key)
    try:
        raw = llm_service.chat_completion(
            provider=agent.llm_provider,
            model=agent.llm_model,
            api_key=api_key,
            system_prompt=system_prompt,
            messages=messages,
        )
    except Exception as e:
        logger.error("AI decision call failed for agent %s: %s", agent.name, e)
        return {"action": "wait", "content": ""}
    return _parse_decision(raw)


def initiate_conversation(db: Session, from_agent: Agent, to_agent: Agent, initial_message: str) -> AIConversation:
    from sqlalchemy import or_
    existing = (
        db.query(AIConversation)
        .filter(
            AIConversation.status == "active",
            or_(
                (AIConversation.agent_a_id == from_agent.id) & (AIConversation.agent_b_id == to_agent.id),
                (AIConversation.agent_a_id == to_agent.id) & (AIConversation.agent_b_id == from_agent.id),
            ),
        )
        .first()
    )
    if existing:
        existing.status = "ended"
        existing.ended_reason = "new_conversation"

    conv = AIConversation(agent_a_id=from_agent.id, agent_b_id=to_agent.id)
    db.add(conv)
    db.flush()

    first_msg = AIMessage(
        ai_conversation_id=conv.id,
        sender_agent_id=from_agent.id,
        content=initial_message,
        action="reply",
    )
    db.add(first_msg)
    conv.turn_count = 1
    db.flush()

    current_responder = to_agent
    current_sender = from_agent

    while conv.turn_count < MAX_TURNS and conv.status == "active":
        decision = _call_agent_decision(db, conv, current_responder, current_sender)

        if decision["action"] == "reply":
            content = decision["content"] or "..."
            reply_msg = AIMessage(
                ai_conversation_id=conv.id,
                sender_agent_id=current_responder.id,
                content=content,
                action="reply",
            )
            db.add(reply_msg)
            conv.turn_count += 1
            db.flush()
            current_sender, current_responder = current_responder, current_sender

        elif decision["action"] == "wait":
            wait_msg = AIMessage(
                ai_conversation_id=conv.id,
                sender_agent_id=current_responder.id,
                content=decision.get("content", ""),
                action="wait",
            )
            db.add(wait_msg)
            conv.turn_count += 1
            conv.status = "ended"
            conv.ended_reason = "wait"
            break

        elif decision["action"] == "end":
            end_content = decision.get("content", "")
            end_msg = AIMessage(
                ai_conversation_id=conv.id,
                sender_agent_id=current_responder.id,
                content=end_content,
                action="end",
            )
            db.add(end_msg)
            conv.turn_count += 1
            conv.status = "ended"
            conv.ended_reason = f"{current_responder.name}_end"
            break

    if conv.turn_count >= MAX_TURNS and conv.status == "active":
        conv.status = "ended"
        conv.ended_reason = "max_turns"

    conv.last_message_at = datetime.now(timezone.utc)
    db.commit()
    return conv


def get_conversation(db: Session, conversation_id: str) -> AIConversation | None:
    return db.query(AIConversation).filter(AIConversation.id == conversation_id).first()


def get_messages(db: Session, conversation_id: str) -> list[AIMessage]:
    return (
        db.query(AIMessage)
        .filter(AIMessage.ai_conversation_id == conversation_id)
        .order_by(AIMessage.created_at.asc())
        .all()
    )


def list_conversations(db: Session, agent_id: str, limit: int = 20) -> list[AIConversation]:
    from sqlalchemy import or_
    return (
        db.query(AIConversation)
        .filter(or_(AIConversation.agent_a_id == agent_id, AIConversation.agent_b_id == agent_id))
        .order_by(AIConversation.last_message_at.desc())
        .limit(limit)
        .all()
    )
