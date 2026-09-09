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

用量完整性的約定（2026-09-09 Codex 抓到兩個 bug 之後定的）：
- 一筆只要 input 或 output 任一邊是 None，就算「沒拿全」，計進 missing_usage。
- input_tokens／output_tokens／total_tokens 是**已知的小計**，把拿不到的那些略過；
  三個都拿不到才是 None。只要 missing_usage > 0，usage_partial 就是 true，介面要標「不完整」。
- 真實的 0 不算缺（(0,0) → total 0、missing 0、partial false）。
- 同一則回覆的幾輪工具用 reply_id 綁在一起，不用時間猜。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from models.agent import Agent
from models.usage_log import UsageLog

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


def record(db: Session, agent: Agent, calls: list[dict], *, purpose: str = "chat", conversation_id: str | None = None,
           reply_id: str | None = None) -> list[UsageLog]:
    """把 llm_service.collect() 收到的每一次呼叫寫進帳本。
    這一批＝一則回覆，共用一個 reply_id，call_index 是第幾輪。不 commit，交給呼叫端。"""
    rows = []
    reply_id = reply_id or str(uuid.uuid4())
    for idx, c in enumerate(calls):
        price = price_for(c.get("model", ""))
        row = UsageLog(
            agent_id=agent.id,
            user_id=agent.user_id,
            purpose=purpose,
            conversation_id=conversation_id,
            reply_id=reply_id,
            call_index=idx,
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


def _sum(rows) -> dict:
    """加總一批用量。缺一邊也算缺，總數是已知小計。"""
    ins = [r.input_tokens for r in rows if r.input_tokens is not None]
    outs = [r.output_tokens for r in rows if r.output_tokens is not None]
    costed = [r.cost_usd for r in rows if r.cost_usd is not None]
    missing = sum(1 for r in rows if r.input_tokens is None or r.output_tokens is None)
    known = (sum(ins) if ins else 0) + (sum(outs) if outs else 0)
    return {
        "calls": len(rows),
        "input_tokens": sum(ins) if ins else None,
        "output_tokens": sum(outs) if outs else None,
        "total_tokens": known if (ins or outs) else None,   # 已知小計；全都拿不到才是 None
        "usage_partial": missing > 0,                        # true＝這些數字不完整，介面要標
        "missing_usage": missing,                            # 有幾次呼叫沒拿全（缺一邊也算）
        "cost_usd": round(sum(costed), 6) if costed else None,
        "cost_partial": len(costed) < len(rows),
    }


def _totals(q) -> dict:
    return _sum(q.all())


def summary(db: Session, agent: Agent, conversation_id: str | None = None) -> dict:
    base = db.query(UsageLog).filter(UsageLog.agent_id == agent.id)

    conv_q = base.filter(UsageLog.conversation_id == conversation_id) if conversation_id else base
    last = conv_q.order_by(UsageLog.created_at.desc(), UsageLog.call_index.desc(), UsageLog.id.desc()).first()

    # 本次回覆＝最後那一批（同一個 reply_id），不用時間猜，兩則連在一起也不會混
    if last is None:
        this_reply = _sum([])
        context_tokens = None
    elif last.reply_id:
        batch = conv_q.filter(UsageLog.reply_id == last.reply_id).order_by(UsageLog.call_index).all()
        this_reply = _sum(batch)
        context_tokens = batch[-1].input_tokens if batch else None   # 最後一輪送進去的輸入
    else:
        this_reply = _sum([last])       # 舊資料沒有 reply_id，就只算它自己
        context_tokens = last.input_tokens

    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    return {
        "model": last.model if last else agent.llm_model,
        "provider": last.provider if last else agent.llm_provider,
        "prices_as_of": PRICES_AS_OF,
        "price_known": price_for(last.model if last else agent.llm_model) is not None,
        # 目前上下文＝最近一次送進去的輸入有多大（不是累計，也不是費用）
        "current_context_tokens": context_tokens,
        "this_reply": this_reply,
        "conversation_total": _totals(conv_q) if conversation_id else None,
        "agent_total": _totals(base),
        "this_month": _totals(base.filter(UsageLog.created_at >= month_start)),
        "note": "供應商沒回報用量的呼叫記為「未取得」，不算成 0；費用是估算，以供應商帳單為準。",
    }
