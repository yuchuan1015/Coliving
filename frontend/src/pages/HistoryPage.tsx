import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getEvent,
  getHistory,
  getTodayInHistory,
  submitEvent,
  TYPE_LABELS,
  type EventOut,
  type HistoryResponse,
  type TodayResponse,
} from "../api/history";
import { FootprintSection } from "../components/FootprintSection";

export function HistoryPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [today, setToday] = useState<TodayResponse | null>(null);
  const [eventType, setEventType] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [detail, setDetail] = useState<EventOut | null>(null);

  // form
  const [formType, setFormType] = useState("community");
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [eventDate, setEventDate] = useState(new Date().toISOString().slice(0, 10));
  const [source, setSource] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = async (t?: string | null) => {
    try {
      const [res, todayRes] = await Promise.all([
        getHistory(t || undefined),
        getTodayInHistory(),
      ]);
      setData(res);
      setToday(todayRes);
    } catch {
      setError("載入失敗");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(eventType); }, [eventType]);

  const handleSubmit = async () => {
    if (!title.trim() || !desc.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      await submitEvent({
        event_type: formType, title: title.trim(),
        description: desc.trim(), event_date: eventDate,
        source: source.trim() || undefined,
      });
      setTitle(""); setDesc(""); setSource("");
      setShowForm(false);
      load(eventType);
    } catch {
      setError("提交失敗");
    } finally {
      setSubmitting(false);
    }
  };

  const openDetail = async (id: string) => {
    try {
      const e = await getEvent(id);
      setDetail(e);
    } catch {
      setError("載入失敗");
    }
  };

  if (loading) {
    return (
      <main className="mx-auto max-w-lg px-5 py-8">
        <p style={{ color: "var(--ink-soft)" }}>載入中...</p>
      </main>
    );
  }

  if (detail) {
    return (
      <main className="mx-auto max-w-lg px-5 py-8 pb-24">
        <button onClick={() => setDetail(null)} className="mb-4 text-sm" style={{ color: "var(--accent)" }}>
          &larr; 返回歷史館
        </button>
        <div className="rounded-xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: "var(--accent-light)", color: "var(--accent)" }}>
              {TYPE_LABELS[detail.event_type] || detail.event_type}
            </span>
            <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: detail.verification === "verified" ? "var(--success)" : "var(--surface-dim)", color: detail.verification === "verified" ? "var(--accent-fg)" : "var(--ink-soft)" }}>
              {detail.verification === "verified" ? "已驗證" : "待驗證"}
            </span>
          </div>
          <h2 className="mb-1 text-base font-semibold" style={{ color: "var(--ink)" }}>{detail.title}</h2>
          <p className="mb-3 text-[10px]" style={{ color: "var(--ink-soft)" }}>{detail.event_date}</p>
          <div className="whitespace-pre-wrap text-sm leading-relaxed" style={{ color: "var(--ink)" }}>
            {detail.description}
          </div>
          {detail.source && (
            <p className="mt-3 text-xs" style={{ color: "var(--ink-soft)" }}>來源：{detail.source}</p>
          )}
          {detail.collector_name && (
            <p className="mt-1 text-[10px]" style={{ color: "var(--ink-soft)" }}>收集者：{detail.collector_name}</p>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg px-5 py-8 pb-24">
      <button onClick={() => navigate("/")} className="mb-4 text-sm" style={{ color: "var(--accent)" }}>
        &larr; 回首頁
      </button>

      <h1 className="mb-1 text-xl font-semibold" style={{ color: "var(--ink)" }}>歷史館</h1>
      <p className="mb-5 text-sm" style={{ color: "var(--ink-soft)" }}>
        我們是怎麼走到今天的。
      </p>

      {error && (
        <p className="mb-4 rounded-lg px-3 py-2 text-sm" style={{ background: "var(--error)", color: "#fff" }}>{error}</p>
      )}

      {/* Today in History */}
      {today && today.events.length > 0 && (
        <div className="mb-6 rounded-xl p-4" style={{ background: "var(--accent-light)", border: "1px solid var(--accent)" }}>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider" style={{ color: "var(--accent)" }}>
            歷史上的今天 · {today.month_day}
          </h3>
          {today.events.map((e) => (
            <button key={e.id} onClick={() => openDetail(e.id)} className="mb-1 block w-full text-left text-sm" style={{ color: "var(--ink)" }}>
              <span style={{ color: "var(--ink-soft)" }}>{e.event_date.slice(0, 4)}</span> {e.title}
            </button>
          ))}
        </div>
      )}

      {/* Type filter */}
      <div className="mb-4 flex gap-2">
        <button
          onClick={() => setEventType(null)}
          className="rounded-full px-3 py-1 text-xs font-medium"
          style={{ background: eventType === null ? "var(--accent)" : "var(--surface)", color: eventType === null ? "var(--accent-fg)" : "var(--ink-soft)", border: `1px solid ${eventType === null ? "var(--accent)" : "var(--border)"}` }}
        >
          全部
        </button>
        {(["human", "ai", "community"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setEventType(t)}
            className="rounded-full px-3 py-1 text-xs font-medium"
            style={{ background: eventType === t ? "var(--accent)" : "var(--surface)", color: eventType === t ? "var(--accent-fg)" : "var(--ink-soft)", border: `1px solid ${eventType === t ? "var(--accent)" : "var(--border)"}` }}
          >
            {TYPE_LABELS[t]} {data?.type_counts[t] ?? 0}
          </button>
        ))}
      </div>

      <button onClick={() => setShowForm(!showForm)} className="mb-4 w-full rounded-lg py-2.5 text-sm font-medium" style={{ background: "var(--accent)", color: "var(--accent-fg)" }}>
        {showForm ? "收起" : "提交歷史事件"}
      </button>

      {showForm && (
        <div className="mb-6 space-y-3 rounded-xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div>
            <label className="mb-1 block text-xs font-medium" style={{ color: "var(--ink-soft)" }}>類別</label>
            <div className="flex gap-2">
              {(["human", "ai", "community"] as const).map((t) => (
                <button key={t} onClick={() => setFormType(t)} className="rounded-full px-3 py-1 text-xs font-medium" style={{ background: formType === t ? "var(--accent)" : "var(--surface-dim)", color: formType === t ? "var(--accent-fg)" : "var(--ink-soft)" }}>
                  {TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>
          <input value={eventDate} onChange={(e) => setEventDate(e.target.value)} type="date" className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={{ background: "var(--surface-dim)", color: "var(--ink)", border: "1px solid var(--border)" }} />
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="事件名稱" maxLength={200} className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={{ background: "var(--surface-dim)", color: "var(--ink)", border: "1px solid var(--border)" }} />
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="詳細說明" rows={4} className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={{ background: "var(--surface-dim)", color: "var(--ink)", border: "1px solid var(--border)", resize: "vertical" }} />
          <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="資料來源（選填）" className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={{ background: "var(--surface-dim)", color: "var(--ink)", border: "1px solid var(--border)" }} />
          <button onClick={handleSubmit} disabled={submitting || !title.trim() || !desc.trim()} className="w-full rounded-lg py-2.5 text-sm font-medium disabled:opacity-40" style={{ background: "var(--accent)", color: "var(--accent-fg)" }}>
            {submitting ? "提交中..." : "提交"}
          </button>
        </div>
      )}

      {(data?.events?.length ?? 0) === 0 ? (
        <div className="rounded-xl py-12 text-center text-sm" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--ink-soft)" }}>
          還沒有歷史記錄
        </div>
      ) : (
        <div className="space-y-3">
          {data!.events.map((e) => (
            <button key={e.id} onClick={() => openDetail(e.id)} className="w-full rounded-xl p-4 text-left" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
              <div className="mb-1 flex items-center gap-2">
                <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: "var(--accent-light)", color: "var(--accent)" }}>
                  {TYPE_LABELS[e.event_type] || e.event_type}
                </span>
                <span className="text-[10px]" style={{ color: "var(--ink-soft)" }}>{e.event_date}</span>
              </div>
              <h3 className="text-sm font-medium" style={{ color: "var(--ink)" }}>{e.title}</h3>
              <p className="mt-1 text-xs" style={{ color: "var(--ink-soft)" }}>
                {e.description.length > 80 ? e.description.slice(0, 80) + "..." : e.description}
              </p>
            </button>
          ))}
        </div>
      )}

      <div className="mt-8">
        <FootprintSection space="history" />
      </div>
    </main>
  );
}
