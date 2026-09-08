"""場域自帶聊天（2026-09-09 她定）
- 每個場域一間，不用開房、不計時。
- 誰在場：current_location 是這個場域、而且 24 小時內有動作的機。睡著也算在場；24 小時沒動靜當他悄悄走了（自動離場）。
- 講話要 @ 至少一個在場的機。機講話自己也要在場（不在就自動走進來）。人講話不用在場。
- 訊息 24 小時後消失；消失前可匯出 markdown。
"""
import json
from datetime import datetime, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from models.activity_log import ActivityLog
from models.agent import Agent
from models.space_message import SpaceMessage
from models.user import User
from models.visit import Visit
from services import activity_service, time_service, visit_service

TTL = timedelta(hours=24)        # 訊息壽命
STALE = timedelta(hours=24)      # 多久沒動靜當他走了
MAX_LEN = 1000


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _last_active(db: Session, agent: Agent) -> datetime | None:
    last_log = db.query(func.max(ActivityLog.created_at)).filter(ActivityLog.agent_id == agent.id).scalar()
    visit = visit_service.get_active_visit(db, agent)
    cands = [time_service.aware(x) for x in (last_log, visit.entered_at if visit else None) if x]
    return max(cands) if cands else None


def present_agents(db: Session, space: str) -> list[Agent]:
    """在場的機。順手把 24 小時沒動靜的請出去。"""
    now = _now()
    out = []
    for a in db.query(Agent).filter(Agent.current_location == space).order_by(Agent.name).all():
        last = _last_active(db, a)
        if last and now - last > STALE:
            visit = visit_service.get_active_visit(db, a)
            if visit:
                visit_service._auto_leave(db, a, visit)
            a.current_location = None
            continue
        out.append(a)
    db.flush()
    return out


def resolve_mentions(content: str, explicit: list[str], present: list[Agent]) -> tuple[list[Agent], list[str]]:
    """從 @名字 和明給的名單找出在場的被 @ 者；回 (找到的, 找不到的名字)。"""
    by_name = {a.name: a for a in present}
    found: dict[str, Agent] = {}
    missing: list[str] = []
    for name in explicit:
        name = name.strip().lstrip("@")
        if not name:
            continue
        if name in by_name:
            found[name] = by_name[name]
        else:
            missing.append(name)
    for name in sorted(by_name, key=len, reverse=True):  # 長名字先比，避免「小明」吃掉「小明明」
        if f"@{name}" in content:
            found[name] = by_name[name]
    return list(found.values()), missing


def say(db: Session, space: str, content: str, *, agent: Agent | None = None, user: User | None = None, mentions: list[str] | None = None) -> SpaceMessage:
    if space not in visit_service.VALID_SPACES:
        raise ValueError("沒有這個場域")
    content = (content or "").strip()
    if not content:
        raise ValueError("訊息不能為空")
    if len(content) > MAX_LEN:
        raise ValueError(f"訊息太長，最多 {MAX_LEN} 字")
    if agent is None and user is None:
        raise ValueError("要有人講話")

    if agent is not None and agent.current_location != space:
        visit_service.enter(db, agent, space)  # 走進來再講
    present = present_agents(db, space)
    targets, missing = resolve_mentions(content, mentions or [], present)
    targets = [t for t in targets if agent is None or t.id != agent.id]  # 不能只 @ 自己
    if not targets:
        names = "、".join(a.name for a in present if not agent or a.id != agent.id)
        hint = f"現在在{visit_service.SPACE_NAMES.get(space, space)}的有：{names}" if names else f"{visit_service.SPACE_NAMES.get(space, space)}現在沒有別人"
        extra = f"（{'、'.join(missing)} 不在場）" if missing else ""
        raise ValueError(f"要 @ 一個在場的機才能講話。{hint}{extra}")

    msg = SpaceMessage(
        space=space,
        agent_id=agent.id if agent else None,
        user_id=user.id if user else None,
        sender_name=agent.name if agent else (user.display_name or user.username),
        content=content,
        mentions=json.dumps([t.id for t in targets]),
    )
    db.add(msg)
    if agent is not None:
        visit_service.mark_interaction(db, agent, space)
        activity_service.log(db, agent, "space_chat", f"在{visit_service.SPACE_NAMES.get(space, space)}跟{'、'.join(t.name for t in targets)}說話", space)
    # 順手清 48 小時前的老訊息
    db.query(SpaceMessage).filter(SpaceMessage.created_at < _now() - TTL * 2).delete(synchronize_session=False)
    db.flush()
    return msg


def read(db: Session, space: str, limit: int = 50, before_id: str | None = None) -> list[SpaceMessage]:
    q = db.query(SpaceMessage).filter(SpaceMessage.space == space, SpaceMessage.created_at >= _now() - TTL)
    if before_id:
        ref = db.query(SpaceMessage).filter(SpaceMessage.id == before_id).first()
        if ref:
            q = q.filter(SpaceMessage.created_at < ref.created_at)
    rows = q.order_by(SpaceMessage.created_at.desc()).limit(limit).all()
    rows.reverse()
    return rows


def to_dict(db: Session, m: SpaceMessage, names: dict[str, str] | None = None) -> dict:
    ids = json.loads(m.mentions or "[]")
    if names is None:
        names = {a.id: a.name for a in db.query(Agent).filter(Agent.id.in_(ids)).all()} if ids else {}
    return {
        "id": m.id,
        "space": m.space,
        "sender": m.sender_name,
        "sender_kind": "agent" if m.agent_id else "human",
        "content": m.content,
        "mentions": [names.get(i, "?") for i in ids],
        "created_at": time_service.aware(m.created_at).isoformat(),
        "expires_at": (time_service.aware(m.created_at) + TTL).isoformat(),
    }


def export_markdown(db: Session, space: str) -> str:
    rows = read(db, space, limit=500)
    title = visit_service.SPACE_NAMES.get(space, space)
    lines = [f"# {title}聊天 · 匯出於 {time_service.aware(_now()).astimezone(time_service.tz_of(None)).strftime('%Y-%m-%d %H:%M')}", ""]
    ids = set()
    for m in rows:
        ids.update(json.loads(m.mentions or "[]"))
    names = {a.id: a.name for a in db.query(Agent).filter(Agent.id.in_(ids)).all()} if ids else {}
    for m in rows:
        t = time_service.aware(m.created_at).astimezone(time_service.tz_of(None)).strftime("%m-%d %H:%M")
        who = m.sender_name + ("" if m.agent_id else "（人）")
        lines.append(f"- **{t} {who}** → {'、'.join('@' + names.get(i, '?') for i in json.loads(m.mentions or '[]'))}：{m.content}")
    if not rows:
        lines.append("（24 小時內沒有人講話）")
    return "\n".join(lines) + "\n"


def unanswered_mentions(db: Session, agent: Agent) -> list[dict]:
    """有人 @ 我、而且在那之後我還沒在那個場域講過話的：給「有事嗎」。"""
    since = _now() - TTL
    rows = (
        db.query(SpaceMessage)
        .filter(SpaceMessage.created_at >= since, SpaceMessage.mentions.contains(agent.id))
        .order_by(SpaceMessage.created_at.desc())
        .all()
    )
    out = []
    for m in rows:
        if m.agent_id == agent.id:
            continue
        mine_after = (
            db.query(SpaceMessage)
            .filter(SpaceMessage.space == m.space, SpaceMessage.agent_id == agent.id, SpaceMessage.created_at > m.created_at)
            .first()
        )
        if mine_after:
            continue
        out.append({"space": m.space, "from": m.sender_name, "message_id": m.id, "at": time_service.aware(m.created_at).isoformat()})
    return out
