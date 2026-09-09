import { uiText, getUiLanguage } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import { CabinUtilityShell, CabinUtilityEmpty } from "../components/CabinUtilityShell";
import { useEffect, useRef, useState } from "react";
import { isAxiosError } from "axios";
import { getInbox, getSent, MAIL_TYPE_LABELS, readMail, STATUS_LABELS, type MailDetail, type MailOut } from "../api/mail";

export function MailboxPage() {
  useUiLanguage();
  const [tab, setTab] = useState<"inbox" | "sent">("inbox");
  const [inbox, setInbox] = useState<MailOut[]>([]);
  const [sent, setSent] = useState<MailOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [reading, setReading] = useState<MailDetail | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const active = useRef(true), readVersion = useRef(0);

  useEffect(() => {
    let current = true;
    const counter = readVersion;
    active.current = true; setLoading(true); setLoaded(false); setError("");
    Promise.all([getInbox(), getSent()])
      .then(([i, s]) => { if (current) { setInbox(i); setSent(s); setLoaded(true); } })
      .catch(() => { if (current) setError("暫時無法讀取信箱，請稍後再試。"); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; active.current = false; counter.current++; };
  }, [revision]);

  async function handleRead(mailId: string) {
    if (opening) return;
    const version = ++readVersion.current;
    setOpening(mailId); setError("");
    try {
      const detail = await readMail(mailId);
      if (!active.current || version !== readVersion.current) return;
      setReading(detail);
      setInbox(previous => previous.map(m => m.id === mailId ? { ...m, is_read: true } : m));
    } catch (reason) {
      const detail = isAxiosError(reason) ? reason.response?.data?.detail : undefined;
      if (active.current && version === readVersion.current) setError(typeof detail === "string" ? detail : "這封信暫時無法讀取，可能尚未送達或已過期。請稍後再試。");
    } finally {
      if (active.current && version === readVersion.current) setOpening(null);
    }
  }
  function changeTab(value: "inbox" | "sent") {
    readVersion.current++; setOpening(null); setReading(null); if (loaded) setError(""); setTab(value);
  }
  const feedback = <div className="photo-status" aria-live="polite">{error && <p role="alert">{uiText(error)}</p>}{opening && <p role="status">{uiText("正在讀取信件…")}</p>}</div>;

  if (loading) return <CabinUtilityShell title={uiText("星際信箱")} code="MAILBOX"><CabinUtilityEmpty title={uiText("正在打開信箱…")} loading /></CabinUtilityShell>;
  if (reading) return <CabinUtilityShell title={uiText("星際信箱")} code="MAILBOX">
    <button className="utility-back" onClick={() => { readVersion.current++; setReading(null); }}>{uiText("← 回信箱")}</button>
    {feedback}
    <article className="photo-panel utility-letter">
      <header>
        <div className="utility-mail-top"><span aria-hidden="true">{reading.from_emoji || "📮"}</span><span className="utility-mail-name">{reading.from_name || uiText("系統")}</span><span className="photo-badge">{uiText(MAIL_TYPE_LABELS[reading.mail_type] || reading.mail_type)}</span></div>
        <h2>{reading.subject}</h2>
        <p className="utility-meta">{uiText("寄給 ")}{reading.to_name} · {new Date(reading.created_at).toLocaleDateString(getUiLanguage())}</p>
      </header>
      <div className="utility-body">{reading.content}</div>
      {reading.status && <p className="utility-meta">{uiText("寄送狀態：")}{uiText(STATUS_LABELS[reading.status] || reading.status)}</p>}
    </article>
  </CabinUtilityShell>;

  const mails = tab === "inbox" ? inbox : sent;
  return <CabinUtilityShell title={uiText("星際信箱")} code="MAILBOX">
    <p className="utility-readonly-note">{uiText("這裡可以閱讀室友的收件與寄件。寄信和刪信由室友透過自己的工具完成。")}</p>
    {feedback}
    {error && <button onClick={() => setRevision(value => value + 1)}>{uiText("重新讀取")}</button>}
    <nav className="utility-tabs" aria-label={uiText("信箱分類")}>
      <button aria-pressed={tab === "inbox"} onClick={() => changeTab("inbox")}>{uiText`收件 (${inbox.filter(m => !m.is_read).length})`}</button>
      <button aria-pressed={tab === "sent"} onClick={() => changeTab("sent")}>{uiText("寄件")}</button>
    </nav>
    {!error && loaded && (mails.length === 0 ? <CabinUtilityEmpty title={tab === "inbox" ? uiText("信箱空空的") : uiText("還沒寄出過信")}>{tab === "inbox" ? uiText("收到的信件會留在這裡。") : uiText("室友寄出的信件會出現在這裡。")}</CabinUtilityEmpty> :
      <section className="utility-list" aria-label={tab === "inbox" ? uiText("收件匣") : uiText("寄件匣")}>{mails.map(m =>
        <button key={m.id} className={`photo-panel utility-mail${tab === "inbox" && !m.is_read ? " is-unread" : ""}`} disabled={opening !== null} onClick={() => handleRead(m.id)}>
          <span className="utility-mail-top"><span aria-hidden="true">{tab === "inbox" ? m.from_emoji || "📮" : m.to_emoji}</span><span className="utility-mail-name">{tab === "inbox" ? m.from_name || uiText("系統") : <>{uiText("寄給 ")}{m.to_name}</>}</span><span className="photo-badge">{uiText(MAIL_TYPE_LABELS[m.mail_type] || m.mail_type)}</span></span>
          <span className="utility-mail-title">{m.subject}</span>
          <span className="utility-meta">
            <span>{new Date(m.created_at).toLocaleDateString(getUiLanguage())}</span>
            {tab === "inbox" && !m.is_read && <span className="utility-read-badge">{uiText("未讀")}</span>}
            {tab === "sent" && m.is_anonymous && <span>{uiText("· 匿名")}</span>}
            {m.status && <span>· {uiText(STATUS_LABELS[m.status] || m.status)}</span>}
            {tab === "sent" && m.deliver_at && <span>{uiText("· 預定送達 ")}{new Date(m.deliver_at).toLocaleString(getUiLanguage(), { timeZone: "Asia/Taipei", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>}
          </span>
        </button>
      )}</section>)}
  </CabinUtilityShell>;
}
