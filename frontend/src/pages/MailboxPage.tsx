import { uiText, getUiLanguage } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import { CabinUtilityShell, CabinUtilityEmpty } from "../components/CabinUtilityShell";
import { useEffect, useState } from "react";
import {
  deleteMail,
  getInbox,
  getSent,
  MAIL_TYPE_LABELS,
  readMail,
  sendLetter,
  STATUS_LABELS,
  type MailDetail,
  type MailOut,
} from "../api/mail";
import client from "../api/client";

type Tab = "inbox" | "sent" | "compose";

interface AgentOption {
  id: string;
  name: string;
  emoji: string;
}

export function MailboxPage() {
  useUiLanguage();
  const [tab, setTab] = useState<Tab>("inbox");
  const [inbox, setInbox] = useState<MailOut[]>([]);
  const [sent, setSent] = useState<MailOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [reading, setReading] = useState<MailDetail | null>(null);

  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [toId, setToId] = useState("");
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [anon, setAnon] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent_ok, setSentOk] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [i, s] = await Promise.all([getInbox(), getSent()]);
      setInbox(i);
      setSent(s);
    } catch {
      setError("載入失敗");
    } finally {
      setLoading(false);
    }
  }

  async function loadAgents() {
    try {
      const res = await client.get<{ residents: { agent_id: string | null; display_name: string; agent_name: string | null; agent_emoji: string | null }[] }>("/users/residents");
      const list: AgentOption[] = res.data.residents
        .filter((r) => r.agent_id)
        .map((r) => ({
          id: r.agent_id!,
          name: r.agent_name || r.display_name,
          emoji: r.agent_emoji || "🤖",
        }));
      setAgents(list);
    } catch {
      // silent
    }
  }

  async function handleRead(mailId: string) {
    try {
      const detail = await readMail(mailId);
      setReading(detail);
      setInbox((prev) =>
        prev.map((m) => (m.id === mailId ? { ...m, is_read: true } : m))
      );
    } catch (err: any) {
      setError(err.response?.data?.detail || "讀取失敗");
    }
  }

  async function handleDelete(mailId: string) {
    try {
      await deleteMail(mailId);
      setInbox((prev) => prev.filter((m) => m.id !== mailId));
      if (reading?.id === mailId) setReading(null);
    } catch (err: any) {
      setError(err.response?.data?.detail || "刪除失敗");
    }
  }

  async function handleSend() {
    if (!toId || !subject.trim() || !content.trim()) return;
    setSending(true);
    setError("");
    setSentOk("");
    try {
      const result = await sendLetter({
        to_agent_id: toId,
        subject: subject.trim(),
        content: content.trim(),
        is_anonymous: anon,
      });
      if (result.deliver_at) {
        const eta = new Date(result.deliver_at).toLocaleString(getUiLanguage(), {
          timeZone: "Asia/Taipei",
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
        setSentOk(`信件已交給郵驛，預計 ${eta} 送達`);
      } else {
        setSentOk("信件已投入郵驛");
      }
      setSubject("");
      setContent("");
      setToId("");
      setAnon(false);
      const s = await getSent();
      setSent(s);
    } catch (err: any) {
      setError(err.response?.data?.detail || "寄信失敗");
    } finally {
      setSending(false);
    }
  }

  function openCompose() {
    setTab("compose");
    if (agents.length === 0) loadAgents();
  }


  const feedback = <div className="photo-status" aria-live="polite">
    {error && <p role="alert">{uiText(error)}</p>}
    {sent_ok && <p role="status">{uiText(sent_ok)}</p>}
  </div>;

  if (loading) return <CabinUtilityShell title={uiText("星際信箱")} code="MAILBOX"><CabinUtilityEmpty title={uiText("正在打開信箱…")} loading /></CabinUtilityShell>;

  if (reading) return <CabinUtilityShell title={uiText("星際信箱")} code="MAILBOX">
    <button className="utility-back" onClick={() => setReading(null)}>{uiText("← 回信箱")}</button>
    {feedback}
    <article className="photo-panel utility-letter">
      <header>
        <div className="utility-mail-top"><span aria-hidden="true">{reading.from_emoji || "📮"}</span><span className="utility-mail-name">{reading.from_name || uiText("系統")}</span><span className="photo-badge">{uiText(MAIL_TYPE_LABELS[reading.mail_type] || reading.mail_type)}</span></div>
        <h2>{reading.subject}</h2>
        <p className="utility-meta">{new Date(reading.created_at).toLocaleDateString(getUiLanguage())}</p>
      </header>
      <div className="utility-body">{reading.content}</div>
      {reading.status && <p className="utility-meta">{uiText("寄送狀態：")}{uiText(STATUS_LABELS[reading.status] || reading.status)}</p>}
    </article>
    <div className="utility-actions"><button className="utility-danger" onClick={() => handleDelete(reading.id)}>{uiText("刪除這封信")}</button></div>
  </CabinUtilityShell>;

  return <CabinUtilityShell title={uiText("星際信箱")} code="MAILBOX">
    {feedback}
    <nav className="utility-tabs" aria-label={uiText("信箱分類")}>
      {(["inbox", "sent", "compose"] as Tab[]).map(t => <button key={t} aria-pressed={tab === t} onClick={() => t === "compose" ? openCompose() : setTab(t)}>
        {t === "inbox" ? uiText`收件 (${inbox.filter(m => !m.is_read).length})` : t === "sent" ? uiText("寄件") : uiText("寫信")}
      </button>)}
    </nav>
    {tab === "inbox" && (inbox.length === 0 ? <CabinUtilityEmpty title={uiText("信箱空空的")}>{uiText("收到的信件會留在這裡。")}</CabinUtilityEmpty> :
      <section className="utility-list" aria-label={uiText("收件匣")}>{inbox.map(m =>
        <button key={m.id} className={`photo-panel utility-mail${m.is_read ? "" : " is-unread"}`} onClick={() => handleRead(m.id)}>
          <span className="utility-mail-top"><span aria-hidden="true">{m.from_emoji || "📮"}</span><span className="utility-mail-name">{m.from_name || uiText("系統")}</span><span className="photo-badge">{MAIL_TYPE_LABELS[m.mail_type] || m.mail_type}</span></span>
          <span className="utility-mail-title">{m.subject}</span>
          <span className="utility-meta"><span>{new Date(m.created_at).toLocaleDateString(getUiLanguage())}</span>{!m.is_read && <span className="utility-read-badge">{uiText("未讀")}</span>}</span>
        </button>
      )}</section>)}
    {tab === "sent" && (sent.length === 0 ? <CabinUtilityEmpty title={uiText("還沒寄出過信")}>{uiText("寫一封信，把想說的話寄出去。")}</CabinUtilityEmpty> :
      <section className="utility-list" aria-label={uiText("寄件匣")}>{sent.map(m =>
        <article className="photo-panel utility-mail" key={m.id}>
          <div className="utility-mail-top"><span aria-hidden="true">{m.to_emoji}</span><span className="utility-mail-name">{uiText("寄給 ")}{m.to_name}</span><span className="photo-badge">{MAIL_TYPE_LABELS[m.mail_type] || m.mail_type}</span></div>
          <h2 className="utility-mail-title">{m.subject}</h2>
          <div className="utility-meta">
            <span>{new Date(m.created_at).toLocaleDateString(getUiLanguage())}</span>
            {m.is_anonymous && <span>{uiText("· 匿名")}</span>}
            {m.status && <span>· {STATUS_LABELS[m.status] || m.status}</span>}
            {m.deliver_at && new Date(m.deliver_at) > new Date() && <span>{uiText("· 投遞中，預計 ")}{new Date(m.deliver_at).toLocaleString(getUiLanguage(), { timeZone: "Asia/Taipei", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}{uiText(" 送達")}</span>}
            {m.deliver_at && new Date(m.deliver_at) <= new Date() && <span>{uiText("· 已送達")}</span>}
          </div>
        </article>
      )}</section>)}
    {tab === "compose" && <section className="photo-panel" aria-label={uiText("撰寫信件")}>
      <h2>{uiText("寫一封信")}</h2>
      <div className="utility-form">
        <label>{uiText("收件人")}<select value={toId} onChange={e => setToId(e.target.value)}>
          <option value="">{uiText("選擇收件人…")}</option>
          {agents.map(a => <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>)}
        </select></label>
        <label>{uiText("主旨")}<input value={subject} onChange={e => setSubject(e.target.value)} placeholder={uiText("主旨")} maxLength={100} /></label>
        <label>{uiText("信件內容")}<textarea value={content} onChange={e => setContent(e.target.value)} placeholder={uiText("寫下你想說的…")} rows={7} maxLength={2000} /></label>
        <div className="utility-toolbar">
          <label className="utility-check"><input type="checkbox" checked={anon} onChange={e => setAnon(e.target.checked)} />{uiText("匿名寄出")}</label>
          <button className="photo-primary" disabled={sending || !toId || !subject.trim() || !content.trim()} onClick={handleSend}>{sending ? uiText("寄出中…") : uiText("寄出")}</button>
        </div>
      </div>
    </section>}
  </CabinUtilityShell>;
}
