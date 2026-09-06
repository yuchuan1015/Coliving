import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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
  const navigate = useNavigate();
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
        const eta = new Date(result.deliver_at).toLocaleString("zh-TW", {
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

  if (loading) {
    return (
      <main className="mx-auto max-w-lg px-5 py-8">
        <p style={{ color: "var(--ink-soft)" }}>打開信箱...</p>
      </main>
    );
  }

  // Reading a mail
  if (reading) {
    return (
      <main className="mx-auto max-w-lg px-5 py-8 pb-24">
        <button
          onClick={() => setReading(null)}
          className="mb-6 text-sm"
          style={{ color: "var(--accent)" }}
        >
          &larr; 回信箱
        </button>

        <div
          className="rounded-xl p-5"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        >
          <div className="mb-4 flex items-center gap-2">
            <span className="text-lg">{reading.from_emoji || "📮"}</span>
            <div>
              <div className="text-sm font-medium" style={{ color: "var(--ink)" }}>
                {reading.from_name || "系統"}
              </div>
              <div className="text-[10px]" style={{ color: "var(--ink-soft)" }}>
                {MAIL_TYPE_LABELS[reading.mail_type] || reading.mail_type} ·{" "}
                {new Date(reading.created_at).toLocaleDateString("zh-TW")}
              </div>
            </div>
          </div>

          <h2 className="mb-3 text-base font-semibold" style={{ color: "var(--ink)" }}>
            {reading.subject}
          </h2>

          <div
            className="whitespace-pre-wrap text-sm leading-relaxed"
            style={{ color: "var(--ink)" }}
          >
            {reading.content}
          </div>

          {reading.status && (
            <div
              className="mt-4 rounded-lg px-3 py-2 text-xs"
              style={{ background: "var(--surface-dim)", color: "var(--ink-soft)" }}
            >
              寄送狀態：{STATUS_LABELS[reading.status] || reading.status}
            </div>
          )}
        </div>

        <button
          onClick={() => handleDelete(reading.id)}
          className="mt-4 text-xs"
          style={{ color: "var(--error)" }}
        >
          刪除這封信
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg px-5 py-8 pb-24">
      <button
        onClick={() => navigate("/")}
        className="mb-4 text-sm"
        style={{ color: "var(--accent)" }}
      >
        &larr; 回首頁
      </button>

      <h1 className="mb-1 text-xl font-semibold" style={{ color: "var(--ink)" }}>
        郵驛
      </h1>
      <p className="mb-5 text-sm" style={{ color: "var(--ink-soft)" }}>
        社區信件收發站。
      </p>

      {error && (
        <p
          className="mb-4 rounded-lg px-3 py-2 text-sm"
          style={{ background: "var(--error)", color: "#fff" }}
        >
          {error}
        </p>
      )}
      {sent_ok && (
        <p
          className="mb-4 rounded-lg px-3 py-2 text-center text-sm"
          style={{ background: "var(--accent-light)", color: "var(--accent)" }}
        >
          {sent_ok}
        </p>
      )}

      {/* Tabs */}
      <div
        className="mb-5 flex gap-1 rounded-lg p-1"
        style={{ background: "var(--surface-dim)" }}
      >
        {(["inbox", "sent", "compose"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => (t === "compose" ? openCompose() : setTab(t))}
            className="flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors"
            style={{
              background: tab === t ? "var(--surface)" : "transparent",
              color: tab === t ? "var(--accent)" : "var(--ink-soft)",
              boxShadow: tab === t ? "0 1px 2px rgba(0,0,0,.08)" : "none",
            }}
          >
            {t === "inbox"
              ? `收件 (${inbox.filter((m) => !m.is_read).length})`
              : t === "sent"
                ? "寄件"
                : "寫信"}
          </button>
        ))}
      </div>

      {/* Inbox */}
      {tab === "inbox" && (
        <>
          {inbox.length === 0 ? (
            <div
              className="flex items-center justify-center rounded-xl py-16"
              style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
            >
              <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
                信箱空空的
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {inbox.map((m) => (
                <div
                  key={m.id}
                  onClick={() => handleRead(m.id)}
                  className="cursor-pointer rounded-xl px-4 py-3 transition-colors"
                  style={{
                    background: m.is_read ? "var(--surface)" : "var(--surface-dim)",
                    border: `1px solid ${m.is_read ? "var(--border)" : "var(--accent)"}`,
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{m.from_emoji || "📮"}</span>
                    <span
                      className="flex-1 text-sm font-medium"
                      style={{ color: "var(--ink)" }}
                    >
                      {m.from_name || "系統"}
                    </span>
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px]"
                      style={{
                        background: "var(--accent-light)",
                        color: "var(--accent)",
                      }}
                    >
                      {MAIL_TYPE_LABELS[m.mail_type] || m.mail_type}
                    </span>
                  </div>
                  <div
                    className="mt-1 text-sm"
                    style={{
                      color: "var(--ink)",
                      fontWeight: m.is_read ? "normal" : "600",
                    }}
                  >
                    {m.subject}
                  </div>
                  <div
                    className="mt-0.5 text-[10px]"
                    style={{ color: "var(--ink-soft)" }}
                  >
                    {new Date(m.created_at).toLocaleDateString("zh-TW")}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Sent */}
      {tab === "sent" && (
        <>
          {sent.length === 0 ? (
            <div
              className="flex items-center justify-center rounded-xl py-16"
              style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
            >
              <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
                還沒寄出過信
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {sent.map((m) => (
                <div
                  key={m.id}
                  className="rounded-xl px-4 py-3"
                  style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{m.to_emoji}</span>
                    <span className="flex-1 text-sm" style={{ color: "var(--ink)" }}>
                      寄給 {m.to_name}
                    </span>
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px]"
                      style={{ background: "var(--accent-light)", color: "var(--accent)" }}
                    >
                      {MAIL_TYPE_LABELS[m.mail_type] || m.mail_type}
                    </span>
                  </div>
                  <div className="mt-1 text-sm font-medium" style={{ color: "var(--ink)" }}>
                    {m.subject}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[10px]" style={{ color: "var(--ink-soft)" }}>
                    <span>{new Date(m.created_at).toLocaleDateString("zh-TW")}</span>
                    {m.is_anonymous && <span>· 匿名</span>}
                    {m.status && <span>· {STATUS_LABELS[m.status] || m.status}</span>}
                    {m.deliver_at && new Date(m.deliver_at) > new Date() && (
                      <span>· 投遞中，預計 {new Date(m.deliver_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 送達</span>
                    )}
                    {m.deliver_at && new Date(m.deliver_at) <= new Date() && (
                      <span>· 已送達</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Compose */}
      {tab === "compose" && (
        <div
          className="space-y-3 rounded-xl p-4"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        >
          <select
            value={toId}
            onChange={(e) => setToId(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm"
            style={{
              background: "var(--surface-dim)",
              color: "var(--ink)",
              border: "1px solid var(--border)",
            }}
          >
            <option value="">選擇收件人...</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.emoji} {a.name}
              </option>
            ))}
          </select>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="主旨"
            maxLength={100}
            className="w-full rounded-lg px-3 py-2 text-sm"
            style={{
              background: "var(--surface-dim)",
              color: "var(--ink)",
              border: "1px solid var(--border)",
            }}
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="寫下你想說的..."
            rows={6}
            maxLength={2000}
            className="w-full resize-y rounded-lg px-3 py-2 text-sm"
            style={{
              background: "var(--surface-dim)",
              color: "var(--ink)",
              border: "1px solid var(--border)",
              minHeight: "120px",
            }}
          />
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs" style={{ color: "var(--ink-soft)" }}>
              <input
                type="checkbox"
                checked={anon}
                onChange={(e) => setAnon(e.target.checked)}
              />
              匿名寄出
            </label>
            <button
              disabled={sending || !toId || !subject.trim() || !content.trim()}
              onClick={handleSend}
              className="rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-40"
              style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
            >
              {sending ? "寄出中..." : "寄出"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
