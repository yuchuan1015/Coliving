"""mem0 預設記憶：沒自帶記憶庫（memory_mcp）的住戶，用社區的 mem0 存長期記憶。
只活在 api 程序裡（qdrant 本地 path 一個程序獨佔）；mcp/mcp-private 走 /internal/memory。

2026-09-07 她定：嵌入用社區一把 OpenAI key（EMBED_OPENAI_API_KEY），沒設就整個關只走近路。
抽重點用住戶自己的 key。有 memory_mcp 的住戶不碰 mem0（腦在自己家）。
"""
from __future__ import annotations

import logging
import os
import threading
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from models.agent import Agent

logger = logging.getLogger(__name__)

from config import settings as _settings
_QDRANT_PATH = _settings.mem0_qdrant_path
_HISTORY_DB = _settings.mem0_history_db
_EMBED_KEY = _settings.embed_openai_api_key
_EMBED_MODEL = _settings.mem0_embed_model
_EMBED_DIMS = _settings.mem0_embed_dims

_qdrant_client = None
_qdrant_lock = threading.Lock()
_instances: dict[str, object] = {}  # agent_id → Memory
_instances_lock = threading.Lock()


def is_enabled() -> bool:
    return bool(_EMBED_KEY)


def _get_qdrant_client():
    global _qdrant_client
    if _qdrant_client is not None:
        return _qdrant_client
    with _qdrant_lock:
        if _qdrant_client is not None:
            return _qdrant_client
        from qdrant_client import QdrantClient
        Path(_QDRANT_PATH).mkdir(parents=True, exist_ok=True)
        _qdrant_client = QdrantClient(path=_QDRANT_PATH)
        return _qdrant_client


def _decrypt_key(agent: Agent) -> str | None:
    if not agent.encrypted_api_key:
        return None
    try:
        from services.crypto_service import decrypt_api_key
        return decrypt_api_key(agent.encrypted_api_key)
    except Exception:
        return None


def _get_instance(agent: Agent):
    """一個 agent 一個 Memory 實例（LLM key 不同），vector store 共用一個 qdrant client。"""
    if agent.id in _instances:
        return _instances[agent.id]
    with _instances_lock:
        if agent.id in _instances:
            return _instances[agent.id]
        from mem0 import Memory
        api_key = _decrypt_key(agent)
        if not api_key:
            return None
        llm_provider = agent.llm_provider or "openai"
        llm_model = agent.llm_model or "gpt-4o-mini"
        # Map provider names to mem0's expected names
        provider_map = {"claude": "anthropic", "xai": "openai", "gemini": "openai", "deepseek": "openai"}
        mem0_provider = provider_map.get(llm_provider, llm_provider)
        config = {
            "llm": {
                "provider": mem0_provider,
                "config": {
                    "model": llm_model,
                    "api_key": api_key,
                },
            },
            "embedder": {
                "provider": "openai",
                "config": {
                    "model": _EMBED_MODEL,
                    "embedding_dims": _EMBED_DIMS,
                    "api_key": _EMBED_KEY,
                },
            },
            "vector_store": {
                "provider": "qdrant",
                "config": {
                    "collection_name": "coliving_memories",
                    "client": _get_qdrant_client(),
                    "embedding_model_dims": _EMBED_DIMS,
                },
            },
            "history_db_path": _HISTORY_DB,
        }
        try:
            m = Memory.from_config(config)
            _instances[agent.id] = m
            return m
        except Exception as e:
            logger.error("mem0 init failed for %s: %s", agent.name, e)
            return None


def should_use(agent: Agent) -> bool:
    """這個 agent 該用 mem0 嗎：開著、沒自帶記憶 MCP、有 api_key。"""
    return is_enabled() and not agent.memory_mcp and bool(agent.encrypted_api_key)


def add_background(agent: Agent, messages: list[dict]) -> None:
    """背景寫入（聊天每輪結束後丟過來）。不擋回覆。"""
    if not should_use(agent):
        return
    m = _get_instance(agent)
    if not m:
        return
    def _do():
        try:
            m.add(messages, filters={"user_id": agent.id})
        except Exception as e:
            logger.warning("mem0 add failed for %s: %s", agent.name, e)
    t = threading.Thread(target=_do, daemon=True)
    t.start()


def search(agent: Agent, query: str, limit: int = 10) -> list[dict]:
    """搜記憶，回 [{text, score, ...}]。"""
    if not should_use(agent):
        return []
    m = _get_instance(agent)
    if not m:
        return []
    try:
        results = m.search(query, filters={"user_id": agent.id}, limit=limit)
        if isinstance(results, dict) and "results" in results:
            results = results["results"]
        return [
            {"text": r.get("memory", r.get("text", str(r))), "score": r.get("score", 0)}
            for r in (results or [])
        ]
    except Exception as e:
        logger.warning("mem0 search failed for %s: %s", agent.name, e)
        return []


def search_text(agent: Agent, query: str, limit: int = 10, cap: int = 6000) -> str:
    """搜完拼成文字段落，給 memory_service 當遠路用。"""
    items = search(agent, query, limit)
    if not items:
        return ""
    lines = [f"- {it['text']}" for it in items]
    text = "\n".join(lines)
    if len(text) > cap:
        text = text[:cap] + f"\n（以下截斷，全文共 {len(text)} 字）"
    return text


def add_direct(agent: Agent, text: str) -> bool:
    """MCP memory_remember：外接床位直接寫一條。"""
    if not should_use(agent):
        return False
    m = _get_instance(agent)
    if not m:
        return False
    try:
        m.add([{"role": "user", "content": text}], filters={"user_id": agent.id})
        return True
    except Exception as e:
        logger.warning("mem0 add_direct failed for %s: %s", agent.name, e)
        return False


def get_all(agent: Agent) -> list[dict]:
    """列出這個 agent 的所有記憶。"""
    if not should_use(agent):
        return []
    m = _get_instance(agent)
    if not m:
        return []
    try:
        results = m.get_all(filters={"user_id": agent.id})
        if isinstance(results, dict) and "results" in results:
            results = results["results"]
        return [
            {
                "id": r.get("id", ""),
                "text": r.get("memory", r.get("text", str(r))),
                "created_at": r.get("created_at"),
                "updated_at": r.get("updated_at"),
                "metadata": r.get("metadata"),
            }
            for r in (results or [])
        ]
    except Exception as e:
        logger.warning("mem0 get_all failed for %s: %s", agent.name, e)
        return []


def delete_one(agent: Agent, memory_id: str) -> bool:
    """刪一條記憶。"""
    if not should_use(agent):
        return False
    m = _get_instance(agent)
    if not m:
        return False
    try:
        m.delete(memory_id)
        return True
    except Exception as e:
        logger.warning("mem0 delete failed for %s/%s: %s", agent.name, memory_id, e)
        return False
