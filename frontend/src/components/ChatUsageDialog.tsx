import { uiText, getUiLanguage } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import { useEffect, useRef, useState } from "react";
import { isAxiosError } from "axios";
import { getChatUsage, type ChatUsage, type UsageTotals } from "../api/chat";
import "../chat-usage.css";

const tokens = (value: number | null) => value === null ? uiText("未取得") : value.toLocaleString(getUiLanguage());
const dollars = (value: number) => value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });

export function UsageSummary({ usage }: { usage: ChatUsage }) {
  useUiLanguage();
  return <>
    <p className="chat-usage-model">{usage.provider} · {usage.model}</p>
    <section className="chat-usage-metric" aria-labelledby="usage-context-title">
      <h3 id="usage-context-title">{uiText("目前上下文")}</h3>
      <p className="chat-usage-number">{tokens(usage.current_context_tokens)}{usage.current_context_tokens !== null && <small> tokens</small>}</p>
      <p>{uiText("最近一次模型呼叫的輸入量，不是整段對話累計，也不是容量百分比。")}</p>
    </section>
    <UsageTotalCard title={uiText("本次消耗")} description={uiText("最近一則回覆，包含工具迴圈的每一次呼叫。")} totals={usage.this_reply} priceKnown={usage.price_known} />
    <UsageTotalCard title={uiText("整窗累計")} description={uiText("這段對話至今的消耗；刪除訊息不會倒扣已花掉的用量。")} totals={usage.conversation_total} priceKnown={usage.price_known} />
    <UsageTotalCard title={uiText("本月累計")} description={uiText("此室友本月所有已記錄呼叫，依伺服器 UTC 月份統計。")} totals={usage.this_month} priceKnown={usage.price_known} />
    <footer className="chat-usage-note">
      <p>{uiText("費用僅為 USD 估算，以供應商帳單為準。未回報的數字不算成 0；快取與思考若有回報，已含於輸入／輸出，不另加總。")}</p>
      {usage.price_known && <p>{uiText("後端單價表日期：")}{usage.prices_as_of || uiText("未提供")}</p>}
      <p>{uiText("此面板不會持續自動更新，需要時可按「重新讀取」。")}</p>
    </footer>
  </>;
}

export function UsageTotalCard({ title, description, totals, priceKnown }: { title: string; description: string; totals: UsageTotals | null; priceKnown: boolean }) {
  useUiLanguage();
  return <section className="chat-usage-metric" aria-label={title}>
    <h3>{title}</h3>
    <p className="chat-usage-number">{tokens(totals?.total_tokens ?? null)}{totals?.total_tokens != null && <small> tokens</small>}</p>
    {totals?.usage_partial && <p className="chat-usage-warning">{uiText("用量不完整 · 已知小計（")}{tokens(totals.missing_usage)}{uiText(" 次呼叫未拿全）")}</p>}
    <p>{description}</p>
    {totals?.calls === 0 && <p>{uiText("尚無已記錄的呼叫；不是零消耗的保證。")}</p>}
    <dl className="chat-usage-details">
      <div><dt>{uiText("輸入 tokens")}</dt><dd>{tokens(totals?.input_tokens ?? null)}</dd></div>
      <div><dt>{uiText("輸出 tokens")}</dt><dd>{tokens(totals?.output_tokens ?? null)}</dd></div>
      <div><dt>{uiText("呼叫次數")}</dt><dd>{tokens(totals?.calls ?? null)}</dd></div>
    </dl>
    <div className="chat-usage-cost">
      <span>{uiText("估算費用")}</span>
      {!priceKnown ? <span>{uiText("模型單價未確認，暫不估算")}</span> : <>
        <strong>{totals?.cost_usd == null ? uiText("未取得") : `USD $${dollars(totals.cost_usd)}`}</strong>
        {totals?.cost_partial && <span className="chat-usage-warning">{uiText("費用不完整")}{totals.cost_usd !== null ? uiText(" · 已知費用小計") : ""}</span>}
      </>}
    </div>
  </section>;
}

// Mounted only after a deliberate click; closing cancels reads and drops the snapshot.
export function ChatUsageDialog({ agentId, revision, onClose }: { agentId: string; revision: number; onClose: () => void }) {
  useUiLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const [snapshot, setSnapshot] = useState<{ key: string; usage: ChatUsage | null; error: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const requestKey = JSON.stringify([agentId, revision, retry]);
  const current = snapshot?.key === requestKey ? snapshot : null;
  const loading = !current;
  const usage = current?.usage;
  const error = current?.error;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { previous?.focus(); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    getChatUsage(agentId, controller.signal).then(value => {
      if (!controller.signal.aborted) setSnapshot({ key: requestKey, usage: value, error: "" });
    }).catch(err => {
      if (controller.signal.aborted) return;
      const detail = isAxiosError(err) ? err.response?.data?.detail : undefined;
      setSnapshot({ key: requestKey, usage: null, error: typeof detail === "string" ? detail : err instanceof Error && !isAxiosError(err) ? err.message : "用量暫時無法讀取，請稍後再試。" });
    });
    return () => { controller.abort(); };
  }, [agentId, requestKey]);

  return <dialog ref={dialog} className="chat-usage-dialog" aria-labelledby="chat-usage-title" onCancel={event => { event.preventDefault(); onClose(); }} onClose={onClose} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
  }}>
    <header><div><span className="chat-usage-eyebrow">CONVERSATION USAGE</span><h2 id="chat-usage-title">{uiText("用量與費用")}</h2></div><button type="button" onClick={onClose} aria-label={uiText("關閉用量面板")} autoFocus>×</button></header>
    <div className="chat-usage-body" aria-busy={loading}>
      {loading ? <p className="chat-usage-state" role="status">{uiText("正在讀取用量…")}</p> : error ? <p className="chat-usage-state" role="alert">{uiText(error)}</p> : usage && <UsageSummary usage={usage} />}
    </div>
    <div className="chat-usage-actions"><button type="button" disabled={loading} onClick={() => setRetry(value => value + 1)}>{uiText("重新讀取")}</button></div>
  </dialog>;
}
