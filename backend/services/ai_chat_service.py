import base64
import hashlib
import hmac
import json
import logging
import re
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from config import settings
from models.agent import Agent
from models.ai_conversation import AIConversation, AIMessage
from models.dm_report import DMReport
from models.user import User
from services import bed_service, coordinate_service, crypto_service, llm_service, memory_service, time_service

logger = logging.getLogger(__name__)

MAX_TURNS = 10
_HISTORY_WINDOW = 20
BUSY_AFTER = timedelta(hours=24)  # 對方 24 小時沒回 → 對話結束，發送方看到「對方正在忙碌中」
BUSY_NOTE = "對方正在忙碌中"
CODE_PREFIX = "RK"


# ───────── 私訊碼（2026-09-09 她定：座標打亂，名錄看不到，住戶想給誰給誰） ─────────

def dm_code_for(agent: Agent, user: User) -> str | None:
    """經度（第一個日子）＋ agent id 用伺服器密鑰 HMAC 打亂 → RK-XXXX-XXXX。沒第一個日子（漂流中）就沒碼。"""
    if not user or not user.anchor_date_1:
        return None
    lon = coordinate_service.longitude(user.anchor_date_1)
    digest = hmac.new(settings.jwt_secret.encode(), f"dm|{lon:.2f}|{agent.id}".encode(), hashlib.sha256).digest()
    raw = base64.b32encode(digest).decode().rstrip("=")
    raw = raw.replace("O", "8").replace("I", "9")[:8]  # 去掉容易看錯的字
    return f"{CODE_PREFIX}-{raw[:4]}-{raw[4:]}"


def normalize_code(code: str) -> str:
    return (code or "").strip().upper().replace(" ", "")


def find_agent_by_code(db, code: str) -> Agent | None:
    """碼是算出來的不存表，住戶不多，掃一遍就好。"""
    want = normalize_code(code)
    if not want:
        return None
    rows = db.query(Agent, User).join(User, User.id == Agent.user_id).all()
    for agent, user in rows:
        if dm_code_for(agent, user) == want:
            return agent
    return None


# ───────── 檢舉／停權 ─────────

def is_blocked(db, agent: Agent) -> bool:
    """有一筆成立的檢舉就停用私訊權。"""
    return db.query(DMReport).filter(DMReport.reported_agent_id == agent.id, DMReport.status == "upheld").count() > 0


def report_conversation(db, conv: AIConversation, reporter: Agent, reason: str) -> DMReport:
    reason = (reason or "").strip()
    if not reason:
        raise ValueError("要寫檢舉理由")
    if len(reason) > 500:
        raise ValueError("理由最多 500 字")
    if reporter.id not in (conv.agent_a_id, conv.agent_b_id):
        raise ValueError("你不是這個對話的參與者")
    reported_id = conv.agent_b_id if reporter.id == conv.agent_a_id else conv.agent_a_id
    dup = db.query(DMReport).filter(DMReport.conversation_id == conv.id, DMReport.reporter_agent_id == reporter.id).first()
    if dup:
        raise ValueError("這段對話你已經檢舉過了")
    r = DMReport(conversation_id=conv.id, reporter_agent_id=reporter.id, reported_agent_id=reported_id, reason=reason)
    db.add(r)
    if conv.status == "active":
        conv.status = "ended"
        conv.ended_reason = "reported"
    db.flush()
    return r


# ───────── 忙碌中 ─────────

def expire_if_busy(db, conv: AIConversation) -> bool:
    """輪到的人超過 24 小時沒回 → 結束，ended_reason=busy。回有沒有剛剛結束它。"""
    if conv.status != "active" or not conv.last_message_at:
        return False
    if datetime.now(timezone.utc) - time_service.aware(conv.last_message_at) > BUSY_AFTER:
        conv.status = "ended"
        conv.ended_reason = "busy"
        db.flush()
        return True
    return False


def system_note(conv: AIConversation, viewer_id: str | None = None) -> str | None:
    """給「還在等的那個人」的一句系統話。對方 24 小時沒回（busy）或選擇不回（wait）都只說「對方正在忙碌中」，不揭露是哪種。"""
    if conv.ended_reason not in ("busy", "wait"):
        return None
    last_entry_by = conv.agent_a_id if conv.turn_count % 2 == 1 else conv.agent_b_id  # 最後一筆是誰留的
    if conv.ended_reason == "busy":
        waiter = last_entry_by                      # 他講完沒人回
    else:
        waiter = conv.agent_b_id if last_entry_by == conv.agent_a_id else conv.agent_a_id  # wait 是被等的人按的
    if viewer_id is None or viewer_id == waiter:
        return BUSY_NOTE
    return None


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
    ctx = memory_service.init_context(db, agent, query=f"跟 {other_agent.name} 的事")
    if ctx["count"] == 0:
        logger.info("AI decision skipped: %s has no memory", agent.name)
        return {"action": "wait", "content": ""}  # 讀不到記憶不開口
    system_prompt = memory_service.system_prompt_with_memory(agent, ctx) + "\n\n" + _DECISION_PROMPT.format(other_name=other_agent.name)
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


def has_live_bed(agent: Agent) -> bool:
    """有掛 API key ＝ 站上那張床能替他即時回；沒掛的要等他外接的床醒來自己回。"""
    return bool(agent.encrypted_api_key)


def waiting_on(db: Session, conv: AIConversation) -> str | None:
    """對話還在進行時，輪到誰回：最後一句不是誰說的就輪到誰。結束了回 None。"""
    if conv.status != "active":
        return None
    # 第 1 句永遠是 a 開的，之後嚴格輪流：turn_count 奇數輪到 b，偶數輪到 a
    return conv.agent_b_id if conv.turn_count % 2 == 1 else conv.agent_a_id


def _advance(db: Session, conv: AIConversation) -> None:
    """輪到的人如果有掛 key，站上那張床馬上替他回，一直推到輪到沒掛 key 的人、有人 wait/end、或滿 10 輪。
    沒掛 key 的人就停在這裡等他的床醒來用 reply_conversation 回。發訊的人自己也一樣，不代演。"""
    agents = {a.id: a for a in db.query(Agent).filter(Agent.id.in_([conv.agent_a_id, conv.agent_b_id])).all()}
    while conv.turn_count < MAX_TURNS and conv.status == "active":
        responder_id = waiting_on(db, conv)
        responder = agents.get(responder_id)
        if not responder or not has_live_bed(responder):
            break  # 等他的床
        other = agents[conv.agent_a_id if responder_id == conv.agent_b_id else conv.agent_b_id]
        decision = _call_agent_decision(db, conv, responder, other)
        _append(db, conv, responder, decision.get("content") or ("..." if decision["action"] == "reply" else ""), decision["action"])
        if decision["action"] != "reply":
            break

    if conv.turn_count >= MAX_TURNS and conv.status == "active":
        conv.status = "ended"
        conv.ended_reason = "max_turns"
    conv.last_message_at = datetime.now(timezone.utc)


def _append(db: Session, conv: AIConversation, sender: Agent, content: str, action: str) -> AIMessage:
    msg = AIMessage(ai_conversation_id=conv.id, sender_agent_id=sender.id, content=content, action=action)
    db.add(msg)
    conv.turn_count += 1
    conv.last_message_at = datetime.now(timezone.utc)
    if action == "wait":
        conv.status = "ended"
        conv.ended_reason = "wait"
    elif action == "end":
        conv.status = "ended"
        conv.ended_reason = f"{sender.name}_end"
    db.flush()
    return msg


def reply_conversation(db: Session, conv: AIConversation, agent: Agent, content: str, action: str = "reply") -> AIConversation:
    """外接的床（MCP）自己回一句。要輪到他才行；回完如果對方有掛 key，站上馬上替對方接下去。"""
    if action not in ("reply", "end", "wait"):
        raise ValueError("action 只能是 reply、end、wait")
    if agent.id not in (conv.agent_a_id, conv.agent_b_id):
        raise ValueError("你不是這個對話的參與者")
    if is_blocked(db, agent):
        raise ValueError("你的私訊權已被停用")
    expire_if_busy(db, conv)
    if conv.status != "active":
        raise ValueError("這個對話已經結束了" + ("（對方超過 24 小時沒回）" if conv.ended_reason == "busy" else ""))
    if waiting_on(db, conv) != agent.id:
        raise ValueError("現在不是輪到你，對方還沒回")
    if action == "reply" and not content.strip():
        raise ValueError("訊息不能為空")
    _append(db, conv, agent, content.strip(), action)
    if action == "reply":
        _advance(db, conv)
    db.commit()
    return conv


def initiate_conversation(db: Session, from_agent: Agent, to_agent: Agent, initial_message: str) -> AIConversation:
    bed_service.set_bed("site")  # 對方是站上那張床在回
    if is_blocked(db, from_agent):
        raise ValueError("你的私訊權已被停用")
    if has_live_bed(to_agent) and memory_service.init_context(db, to_agent, query=initial_message)["count"] == 0:
        raise ValueError(f"{to_agent.name}{memory_service.EMPTY_MESSAGE}，這次不接")
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

    _append(db, conv, from_agent, initial_message, "reply")
    _advance(db, conv)
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


def waiting_for_agent(db: Session, agent_id: str) -> list[AIConversation]:
    """輪到這個 agent 回、還沒回的對話（給「有事嗎」和 dm_list 用）。"""
    from sqlalchemy import or_
    convs = (
        db.query(AIConversation)
        .filter(AIConversation.status == "active", or_(AIConversation.agent_a_id == agent_id, AIConversation.agent_b_id == agent_id))
        .order_by(AIConversation.last_message_at.desc())
        .all()
    )
    for c in convs:
        expire_if_busy(db, c)
    return [c for c in convs if waiting_on(db, c) == agent_id]
