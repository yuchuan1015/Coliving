"""用量與費用（2026-09-09 她定，規則照 `鴉巢-API聊天平台與Token計費調研.md`）。

三個數字要分開，不能混：
  目前上下文  最近一次呼叫的輸入有多大——看快不快滿
  本次消耗    最近一則回覆花了多少（含工具迴圈的每一次呼叫）
  整窗累計    這段對話至今的全部呼叫加總

其他規則：
- 供應商沒回報用量就存 None，前端顯示「未取得」，不要當 0。
- 刪訊息、壓縮歷史都不倒扣已經花掉的。
- 單價跟著每一筆存，中途換模型也算得對；不知道單價就不估費用。
- 快取／思考是明細，已經含在 input／output 裡，不另外加總。
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from models.agent import Agent
from models.usage_log import UsageLog
from services import time_service

# 美元／百萬 tokens。2026-09-09 從調研文件抄的官方標價，只有這幾個是查證過的。
# 找不到對應的就不估費用（cost 存 None），寧可少講也不要給她錯的數字。
PRICES: dict[str, tuple[float, float]] = {
    "gpt-5.4": (2.50, 15.00),
    "claude-sonnet-5": (2.00, 10.00),
    "gemini-3.6-flash": (0.75, 3.75),
}
PRICES_AS_OF = "2026-09-09"


def price_for(model: str) -> tuple[float, float] | None:
    m = (model or "").lower()
    for key, price in PRICES.items():
        if m.startswith(key) or key in m:
            return price
    return None


def _cost(input_tokens, output_tokens, price) -> float | None:
    if price is None or input_tokens is None or output_tokens is None:
        return None
    pin, pout = price
    return round(input_tokens / 1_000_000 * pin + output_tokens / 1_000_000 * pout, 6)


def record(db: Session, agent: Agent, calls: list[dict], *, purpose: str = "chat", conversation_id: str | None = None) -> list[UsageLog]:
    """把 llm_service.collect() 收到的每一次呼叫寫進帳本。不 commit，交給呼叫端。"""
    rows = []
    for c in calls:
        price = price_for(c.get("model", ""))
        row = UsageLog(
            agent_id=agent.id,
            user_id=agent.user_id,
            purpose=purpose,
            conversation_id=conversation_id,
            provider=c.get("provider", ""),
            model=c.get("model", ""),
            input_tokens=c.get("input_tokens"),
            output_tokens=c.get("output_tokens"),
            cached_input_tokens=c.get("cached_input_tokens"),
            reasoning_tokens=c.get("reasoning_tokens"),
            price_input=price[0] if price else None,
            price_output=price[1] if price else None,
            cost_usd=_cost(c.get("input_tokens"), c.get("output_tokens"), price),
        )
        db.add(row)
        rows.append(row)
    if rows:
        db.flush()
    return rows


def _totals(q) -> dict:
    """加總一批用量。missing 是「有幾次呼叫沒拿到用量」，不把缺值當 0。"""
    rows = q.all()
    ins = [r.input_tokens for r in rows if r.input_tokens is not None]
    outs = [r.output_tokens for r in rows if r.output_tokens is not None]
    costed = [r.cost_usd for r in rows if r.cost_usd is not None]
    return {
        "calls": len(rows),
        "input_tokens": sum(ins) if ins else None,
        "output_tokens": sum(outs) if outs else None,
        "total_tokens": (sum(ins) + sum(outs)) if (ins and outs) else None,
        "cost_usd": round(sum(costed), 6) if costed else None,
        "missing_usage": sum(1 for r in rows if r.input_tokens is None and r.output_tokens is None),
        "cost_partial": len(costed) < len(rows),   # 有幾筆沒單價，費用是不完整的
    }


def summary(db: Session, agent: Agent, conversation_id: str | None = None) -> dict:
    base = db.query(UsageLog).filter(UsageLog.agent_id == agent.id)

    conv_q = base.filter(UsageLog.conversation_id == conversation_id) if conversation_id else base
    last = conv_q.order_by(UsageLog.created_at.desc(), UsageLog.id.desc()).first()

    # 本次回覆＝最後一筆那個時間點附近的同一批（同對話、同一秒內的工具迴圈也算進來）
    this_reply = {"calls": 0, "input_tokens": None, "output_tokens": None, "total_tokens": None,
                  "cost_usd": None, "missing_usage": 0, "cost_partial": False}
    if last is not None:
        window_start = time_service.aware(last.created_at).timestamp() - 120
        recent = [r for r in conv_q.order_by(UsageLog.created_at.desc()).limit(20).all()
                  if time_service.aware(r.created_at).timestamp() >= window_start]
        ins = [r.input_tokens for r in recent if r.input_tokens is not None]
        outs = [r.output_tokens for r in recent if r.output_tokens is not None]
        costed = [r.cost_usd for r in recent if r.cost_usd is not None]
        this_reply = {
            "calls": len(recent),
            "input_tokens": sum(ins) if ins else None,
            "output_tokens": sum(outs) if outs else None,
            "total_tokens": (sum(ins) + sum(outs)) if (ins and outs) else None,
            "cost_usd": round(sum(costed), 6) if costed else None,
            "missing_usage": sum(1 for r in recent if r.input_tokens is None and r.output_tokens is None),
            "cost_partial": len(costed) < len(recent),
        }

    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    return {
        "model": last.model if last else agent.llm_model,
        "provider": last.provider if last else agent.llm_provider,
        "prices_as_of": PRICES_AS_OF,
        "price_known": price_for(last.model if last else agent.llm_model) is not None,
        # 目前上下文＝最近一次送進去的輸入有多大（不是累計，也不是費用）
        "current_context_tokens": last.input_tokens if last else None,
        "this_reply": this_reply,
        "conversation_total": _totals(conv_q) if conversation_id else None,
        "agent_total": _totals(base),
        "this_month": _totals(base.filter(UsageLog.created_at >= month_start)),
        "note": "供應商沒回報用量的呼叫記為「未取得」，不算成 0；費用是估算，以供應商帳單為準。",
    }
