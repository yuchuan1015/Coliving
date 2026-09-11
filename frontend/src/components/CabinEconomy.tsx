import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { compactEconomyDisplay, economyNeedsAgent, getAgentCredit, getAgentShells, groupShellDisplay, type ShellBalance } from "../api/economy";
import { getUiLanguage, uiText } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";

type Reading<T> = { status: "loading" | "error" | "missing" } | { status: "ready"; value: T };
type Props = { userId?: string; agentId?: string; agentState: "loading" | "ready" | "missing" | "error" };

export function CabinEconomy({ userId, agentId, agentState }: Props) {
  useUiLanguage();
  const [credit, setCredit] = useState<Reading<number>>({ status: "loading" });
  const [shells, setShells] = useState<Reading<ShellBalance>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!userId || !agentId || agentState !== "ready") return;
    const controller = new AbortController();
    let pending = false;
    async function refresh() {
      if (document.hidden || pending || controller.signal.aborted) return;
      pending = true;
      // Each read resolves independently. A failed wallet must not hide valid credit.
      await Promise.allSettled([
        getAgentCredit(controller.signal).then(value => {
          if (!controller.signal.aborted) setCredit({ status: "ready", value });
        }).catch(error => {
          if (!controller.signal.aborted) setCredit({ status: economyNeedsAgent(error) ? "missing" : "error" });
        }),
        getAgentShells(controller.signal).then(value => {
          if (!controller.signal.aborted) setShells({ status: "ready", value });
        }).catch(error => {
          if (!controller.signal.aborted) setShells({ status: economyNeedsAgent(error) ? "missing" : "error" });
        }),
      ]);
      pending = false;
    }
    void refresh();
    // Safari return/focus refresh, no polling, no local balance increments or storage.
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [userId, agentId, agentState, attempt]);

  const currentCredit: Reading<number> = agentState === "ready" ? credit : { status: agentState };
  const currentShells: Reading<ShellBalance> = agentState === "ready" ? shells : { status: agentState };
  const missing = currentCredit.status === "missing" || currentShells.status === "missing";
  const failed = currentCredit.status === "error" || currentShells.status === "error";
  const fullCredit = currentCredit.status === "ready" ? new Intl.NumberFormat(getUiLanguage()).format(currentCredit.value) : null;
  const fullShells = currentShells.status === "ready" ? groupShellDisplay(currentShells.value.display) : null;
  function retry() {
    if (credit.status === "error") setCredit({ status: "loading" });
    if (shells.status === "error") setShells({ status: "loading" });
    setAttempt(value => value + 1);
  }
  function unavailable(status: "loading" | "error" | "missing") {
    return <span className="cabin-balance-placeholder" aria-label={status === "loading" ? uiText("正在同步") : status === "missing" ? uiText("先領養室友") : uiText("暫時無法讀取")}>
      <span aria-hidden="true">{status === "loading" ? "…" : "—"}</span>
    </span>;
  }

  return <div className="cabin-economy" aria-label={uiText("室友的信用與貝")}>
    <dl className="cabin-balances" aria-live="polite">
      <div title={uiText("室友信用")}>
        <dt><span className="cabin-sr-only">{uiText("室友信用")}</span>
          <svg className="cabin-balance-icon" data-economy-icon="credit" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" /></svg>
        </dt>
        <dd>{currentCredit.status === "ready"
          ? <span title={uiText`室友信用：${fullCredit} 點`} aria-label={uiText`${fullCredit} 點信用`}>{compactEconomyDisplay(String(currentCredit.value), uiText("萬"))}</span>
          : unavailable(currentCredit.status)}</dd>
      </div>
      <div title={uiText("室友貝")}>
        <dt><span className="cabin-sr-only">{uiText("室友貝")}</span>
          <svg className="cabin-balance-icon" data-economy-icon="shell" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M9 18C6 16 3 13 3 10a3 3 0 0 1 3-3 3 3 0 0 1 6-2 3 3 0 0 1 6 2 3 3 0 0 1 3 3c0 3-3 6-6 8l1 3H8l1-3Z" /><path d="M12 6v12M6 9l4 9M18 9l-4 9M9 18h6" /></svg>
        </dt>
        <dd>{currentShells.status === "ready"
          ? <span title={currentShells.value.exact === null ? uiText`室友貝：${fullShells}` : uiText`精確餘額：${currentShells.value.exact} 貝`} aria-label={uiText`${fullShells} 貝`}>{compactEconomyDisplay(currentShells.value.display, uiText("萬"))}</span>
          : unavailable(currentShells.status)}</dd>
      </div>
    </dl>
    {missing ? <Link className="cabin-economy-note" to="/adopt">{uiText("先領養室友")}</Link>
      : failed && agentState === "ready" ? <button className="cabin-economy-retry" onClick={retry} aria-label={uiText("重新讀取室友信用與貝")}>{uiText("同步失敗 · 重試")}</button>
      : failed ? <span className="cabin-economy-note">{uiText("室友資料未同步")}</span> : null}
  </div>;
}
