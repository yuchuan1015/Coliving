import { uiText } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import { useRef, useState, type FormEvent } from "react";
import { useAuth } from "../hooks/useAuth";
import { shelfError } from "../hooks/useBookshelf";

export function BirthYearSettings({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) {
  useUiLanguage();
  const { user, updateBirthYear, refreshUser } = useAuth();
  const [year, setYear] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const currentYear = Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Asia/Taipei" }).format(new Date()));
  const saved = user?.birth_year != null;
  const unknown = user?.birth_year === undefined;
  async function run(reload = false) {
    if (lock.current || (!reload && (saved || unknown || !confirming))) return;
    lock.current = true; setBusy(true); onBusyChange?.(true); setError("");
    try { if (reload) await refreshUser(); else await updateBirthYear(Number(year)); setConfirming(false); }
    catch (err) { setError(shelfError(err).message); }
    finally { lock.current = false; setBusy(false); onBusyChange?.(false); }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (saved || unknown || busy) return;
    if (!/^\d{4}$/.test(year) || Number(year) < 1900 || Number(year) > currentYear) { setError(`請輸入 1900～${currentYear} 的出生年。`); return; }
    setError(""); setConfirming(true);
  }
  return <form className="cabin-city-form" onSubmit={submit}>
    <label htmlFor="account-birth-year">{uiText("出生年")}</label>
    <input id="account-birth-year" type="number" inputMode="numeric" autoComplete="bday-year" min={1900} max={currentYear} required value={saved ? user!.birth_year! : year} onChange={e => { setYear(e.target.value); setConfirming(false); setError(""); }} readOnly={saved || confirming || unknown} disabled={busy || unknown} aria-describedby="birth-year-hint" />
    <small id="birth-year-hint">{unknown ? uiText("帳號資料尚未完整同步，請先重新讀取，不能直接覆寫出生年。") : saved ? uiText("出生年已設定，不能再次更改。") : uiText("用於分級式人機親密關係中心與健康中心的年齡分級。只能補填一次，保存後不能更改。")}</small>
    {error && <p role="alert">{uiText(error)}</p>}
    {(error || unknown) && <button type="button" disabled={busy} onClick={() => void run(true)}>{uiText("重新讀取帳號狀態")}</button>}
    {!saved && !unknown && (confirming ? <><p role="alert">{uiText("確認出生年為 ")}{year}{uiText("？保存後不能更改。")}</p><button type="button" disabled={busy} onClick={() => void run()}>{uiText("確認保存出生年")}</button><button type="button" disabled={busy} onClick={() => setConfirming(false)}>{uiText("返回修改")}</button></> : <button type="submit" disabled={busy}>{uiText("檢查出生年")}</button>)}
    {busy && <p role="status">{uiText("處理中…")}</p>}
  </form>;
}
