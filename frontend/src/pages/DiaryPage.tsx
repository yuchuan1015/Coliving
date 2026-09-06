import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createDiaryEntry,
  deleteDiaryEntry,
  getDiaryEntries,
  type DiaryEntry,
} from "../api/furniture";

export function DiaryPage() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  function load(kw?: string) {
    setLoading(true);
    getDiaryEntries(kw ? { keyword: kw } : undefined)
      .then(setEntries)
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSave() {
    if (!title.trim() || !content.trim()) return;
    setSaving(true);
    try {
      const entry = await createDiaryEntry({ title: title.trim(), content: content.trim() });
      setEntries((prev) => [entry, ...prev]);
      setTitle("");
      setContent("");
      setComposing(false);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteDiaryEntry(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
      if (expanded === id) setExpanded(null);
    } catch (err) {
      console.error(err);
    }
  }

  function handleSearch() {
    load(keyword.trim() || undefined);
  }

  return (
    <main className="mx-auto max-w-lg px-5 py-6 pb-20">
      {/* Header */}
      <div className="mb-5 flex items-center gap-3">
        <button
          onClick={() => navigate("/")}
          className="text-[13px]"
          style={{ color: "var(--ink-soft)" }}
        >
          ← 回家
        </button>
        <h1
          className="text-[18px] font-semibold tracking-tight"
          style={{ color: "var(--ink)" }}
        >
          📔 日記本
        </h1>
      </div>

      {/* Search */}
      <div className="mb-4 flex gap-2">
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder="搜尋日記⋯"
          className="flex-1 rounded-lg px-3 py-2 text-[13px] outline-none"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            color: "var(--ink)",
          }}
        />
        <button
          onClick={handleSearch}
          className="rounded-lg px-3 py-2 text-[13px] font-medium"
          style={{ background: "var(--surface-dim)", color: "var(--ink-soft)" }}
        >
          搜尋
        </button>
      </div>

      {/* New entry button / form */}
      {composing ? (
        <div
          className="mb-5 rounded-xl p-4"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        >
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="標題"
            autoFocus
            className="mb-3 w-full rounded-lg px-3 py-2 text-[14px] font-medium outline-none"
            style={{
              background: "var(--surface-dim)",
              border: "1px solid var(--border)",
              color: "var(--ink)",
            }}
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="寫點什麼⋯"
            rows={5}
            className="mb-3 w-full resize-none rounded-lg px-3 py-2 text-[13px] outline-none"
            style={{
              background: "var(--surface-dim)",
              border: "1px solid var(--border)",
              color: "var(--ink)",
            }}
          />
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving || !title.trim() || !content.trim()}
              className="rounded-lg px-4 py-1.5 text-[13px] font-medium disabled:opacity-50"
              style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
            >
              {saving ? "儲存中⋯" : "儲存"}
            </button>
            <button
              onClick={() => {
                setComposing(false);
                setTitle("");
                setContent("");
              }}
              className="rounded-lg px-4 py-1.5 text-[13px]"
              style={{ color: "var(--ink-soft)" }}
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setComposing(true)}
          className="mb-5 w-full rounded-lg py-2.5 text-[13px] font-medium"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            color: "var(--ink-soft)",
          }}
        >
          + 寫日記
        </button>
      )}

      {/* Entries */}
      {loading ? (
        <p className="text-center text-[13px]" style={{ color: "var(--ink-soft)" }}>
          載入中⋯
        </p>
      ) : entries.length === 0 ? (
        <p className="text-center text-[13px]" style={{ color: "var(--ink-soft)" }}>
          {keyword ? "沒有找到符合的日記" : "還沒有日記"}
        </p>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="rounded-xl px-4 py-3"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
              }}
            >
              <button
                onClick={() =>
                  setExpanded(expanded === entry.id ? null : entry.id)
                }
                className="flex w-full items-center justify-between text-left"
              >
                <div>
                  <h3
                    className="text-[14px] font-medium"
                    style={{ color: "var(--ink)" }}
                  >
                    {entry.title}
                  </h3>
                  <span className="text-[11px]" style={{ color: "var(--ink-muted)" }}>
                    {new Date(entry.created_at).toLocaleDateString("zh-TW")}
                    {entry.source !== "manual" && ` · ${entry.source}`}
                  </span>
                </div>
                <span
                  className="text-[11px]"
                  style={{ color: "var(--ink-muted)" }}
                >
                  {expanded === entry.id ? "▾" : "▸"}
                </span>
              </button>
              {expanded === entry.id && (
                <div className="mt-3">
                  <p
                    className="whitespace-pre-wrap text-[13px] leading-relaxed"
                    style={{ color: "var(--ink-soft)" }}
                  >
                    {entry.content}
                  </p>
                  <div className="mt-3 flex justify-end">
                    <button
                      onClick={() => handleDelete(entry.id)}
                      className="text-[12px]"
                      style={{ color: "var(--error)" }}
                    >
                      刪除
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
