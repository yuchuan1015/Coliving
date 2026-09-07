"""記憶匯流：每張床醒來先讀記憶，讀不到不開口（2026-09-07 鑰匙、床位、記憶匯流工單 第二、三節）。

近路（站上共用記憶，所有床位共用）：相框全部 ＋ 日記最近 N 則（按 importance、時間）＋ 抽屜目錄。
遠路（住戶自己的記憶庫）：住戶把記憶庫包成 MCP，填進「外部 MCP」，agent.memory_mcp 指定哪一個、
    agent.memory_recall_tool 指定 recall 用哪個工具（OB 就填 ob_breath）。站只讀不寫。
有遠路時遠路結果排在近路前面；端點打不通退回近路；近路也零筆 → 不開口（MemoryEmpty）。
"""
from __future__ import annotations

import json
import logging

from sqlalchemy.orm import Session

from models.agent import Agent
from models.diary import DiaryEntry
from models.drawer import DrawerItem
from models.photo_frame import PhotoFrame
from services.external_mcp_client import ExternalMCPClient

logger = logging.getLogger(__name__)

# 遠路快取（工程部要的：每句聊天都打外部 MCP 太慢）
_far_cache: dict[str, tuple[float, dict]] = {}  # agent_id → (ts, result)
FAR_CACHE_TTL = 90  # 秒

DIARY_N = 20            # 近路讀最近幾則日記（工單待定，她沒改就 20）
DRAWER_CATALOG_N = 50   # 抽屜只列目錄（label＋分類），不帶內容
FAR_LIMIT = 10          # 遠路一次要幾條
FAR_TEXT_CAP = 6000     # 遠路回來的字數上限，超過截斷並標明
EMPTY_MESSAGE = "還沒讀到記憶"


class MemoryEmpty(ValueError):
    """近路遠路都零筆：這張床不能開口。"""


# ── 近路 ──


def near_path(db: Session, agent: Agent) -> dict:
    frames = (
        db.query(PhotoFrame).filter(PhotoFrame.user_id == agent.user_id)
        .order_by(PhotoFrame.created_at.asc()).all()
    )
    diaries = (
        db.query(DiaryEntry).filter(DiaryEntry.agent_id == agent.id)
        .order_by(DiaryEntry.importance.desc(), DiaryEntry.created_at.desc())
        .limit(DIARY_N).all()
    )
    drawer = (
        db.query(DrawerItem).filter(DrawerItem.agent_id == agent.id)
        .order_by(DrawerItem.created_at.desc()).limit(DRAWER_CATALOG_N).all()
    )
    return {
        "frames": [{"label": f.label, "category": f.category, "content": f.content} for f in frames],
        "diaries": [
            {"title": d.title, "content": d.content, "importance": d.importance, "source": d.source,
             "created_at": d.created_at.isoformat()}
            for d in diaries
        ],
        "drawer": [{"label": i.label, "category": i.category} for i in drawer],
    }


# ── 遠路 ──


def memory_mcp_config(agent: Agent) -> dict | None:
    """agent.memory_mcp 指到 external_mcps 裡的哪一個；找不到回 None。"""
    if not agent.memory_mcp or not agent.external_mcps:
        return None
    try:
        for m in json.loads(agent.external_mcps):
            if m.get("name") == agent.memory_mcp:
                return m
    except (json.JSONDecodeError, TypeError):
        return None
    return None


def _build_args(schema: dict, query: str, limit: int) -> dict:
    """照工具的 inputSchema 填參數：query 類的欄位塞 query，limit 類的塞 limit，其他不碰。"""
    props = (schema or {}).get("properties", {}) or {}
    args: dict = {}
    for key in ("query", "keywords", "q", "text", "question", "topic"):
        if key in props:
            args[key] = query
            break
    for key in ("limit", "top_k", "k", "n", "count"):
        if key in props:
            args[key] = limit
            break
    return args


def far_path(agent: Agent, query: str, client_factory=ExternalMCPClient, force: bool = False) -> dict:
    """呼叫住戶自己的記憶 MCP（或 mem0）。回 {text, ok, error, tool}。任何錯都吞掉。
    有快取：同一個 agent 90 秒內不重打，force=True 略過。"""
    import time as _time
    if not force:
        cached = _far_cache.get(agent.id)
        if cached and (_time.time() - cached[0]) < FAR_CACHE_TTL:
            return cached[1]
    cfg = memory_mcp_config(agent)
    if not cfg:
        # 沒有記憶 MCP → 試 mem0
        from services import mem0_service
        if mem0_service.should_use(agent):
            text = mem0_service.search_text(agent, query)
            result = {"text": text, "ok": bool(text), "error": None, "tool": "mem0"}
            _far_cache[agent.id] = (_time.time(), result)
            return result
        return {"text": "", "ok": False, "error": None, "tool": None}
    tool_name = (agent.memory_recall_tool or "recall").strip()
    try:
        client = client_factory(cfg.get("name", "memory"), cfg.get("url", ""), cfg.get("token"))
        tools = {t.name: t for t in client.list_tools()}
        if tool_name not in tools:
            return {"text": "", "ok": False, "error": f"記憶 MCP 沒有「{tool_name}」這個工具", "tool": tool_name}
        args = _build_args(tools[tool_name].parameters, query, FAR_LIMIT)
        text = (client.call_tool(tool_name, args) or "").strip()
        if len(text) > FAR_TEXT_CAP:
            text = text[:FAR_TEXT_CAP] + f"\n（以下截斷，全文共 {len(text)} 字）"
        result = {"text": text, "ok": bool(text), "error": None, "tool": tool_name}
        _far_cache[agent.id] = (_time.time(), result)
        return result
    except Exception as e:  # noqa: BLE001  端點打不通就退回近路
        logger.warning("memory far path failed for %s: %s", agent.name, e)
        return {"text": "", "ok": False, "error": str(e)[:200], "tool": tool_name}


# ── 合起來 ──


def init_context(db: Session, agent: Agent, query: str = "", client_factory=ExternalMCPClient, force: bool = False) -> dict:
    """醒來讀記憶。回 {text, count, near, far}。count==0 表示這張床不能開口。"""
    near = near_path(db, agent)
    far = far_path(agent, query or "最近的事、她是誰、我是誰", client_factory=client_factory, force=force)
    count = len(near["frames"]) + len(near["diaries"]) + len(near["drawer"]) + (1 if far["ok"] else 0)

    parts: list[str] = []
    if far["ok"]:
        parts.append(f"【我的記憶庫（{far['tool']}）】\n{far['text']}")
    if near["frames"]:
        parts.append("【相框：主人放給我看的】\n" + "\n".join(f"- [{f['category']}] {f['label']}：{f['content']}" for f in near["frames"]))
    if near["diaries"]:
        parts.append(f"【日記（最近 {len(near['diaries'])} 則，重要的在前）】\n" + "\n".join(
            f"- {d['created_at'][:10]}［{d['source']}］{d['title']}：{d['content']}" for d in near["diaries"]))
    if near["drawer"]:
        parts.append("【抽屜目錄（要看內容再用 open_drawer）】\n" + "、".join(f"{i['label']}（{i['category']}）" for i in near["drawer"]))

    text = ""
    if parts:
        text = "以下是我醒來時讀到的記憶。這些是我自己的，不是主人這次講的話。\n\n" + "\n\n".join(parts)
    return {"text": text, "count": count, "near": near, "far": far}


def require_context(db: Session, agent: Agent, query: str = "", client_factory=ExternalMCPClient, force: bool = False) -> dict:
    ctx = init_context(db, agent, query, client_factory=client_factory, force=force)
    if ctx["count"] == 0:
        raise MemoryEmpty(EMPTY_MESSAGE)
    return ctx


def system_prompt_with_memory(agent: Agent, ctx: dict) -> str:
    return agent.persona + ("\n\n" + ctx["text"] if ctx.get("text") else "")
