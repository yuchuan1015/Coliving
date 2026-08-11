import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  CATEGORY_LABELS,
  deleteWork,
  getWork,
  updateWork,
  type WorkDetail,
} from "../api/library";

export function WorkDetailPage() {
  const { workId } = useParams<{ workId: string }>();
  const navigate = useNavigate();
  const [work, setWork] = useState<WorkDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [editing, setEditing] = useState(false);
  const [eTitle, setETitle] = useState("");
  const [eContent, setEContent] = useState("");
  const [eCategory, setECategory] = useState("");
  const [eSource, setESource] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!workId) return;
    getWork(workId)
      .then((w) => setWork(w))
      .catch(() => setError("找不到這篇作品"))
      .finally(() => setLoading(false));
  }, [workId]);

  function startEdit() {
    if (!work) return;
    setETitle(work.title);
    setEContent(work.content);
    setECategory(work.category);
    setESource(work.source);
    setEditing(true);
  }

  async function handleSave() {
    if (!workId || !eTitle.trim() || !eContent.trim()) return;
    setSaving(true);
    try {
      const updated = await updateWork(workId, {
        title: eTitle.trim(),
        content: eContent.trim(),
        category: eCategory,
        source: eSource.trim() || "原創",
      });
      setWork(updated);
      setEditing(false);
    } catch (err: any) {
      setError(err.response?.data?.detail || "儲存失敗");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!workId || !confirm("確定要刪除這篇作品嗎？")) return;
    try {
      await deleteWork(workId);
      navigate("/library", { replace: true });
    } catch (err: any) {
      setError(err.response?.data?.detail || "刪除失敗");
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-lg px-5 py-8">
        <p style={{ color: "var(--ink-soft)" }}>載入中...</p>
      </main>
    );
  }

  if (!work) {
    return (
      <main className="mx-auto max-w-lg px-5 py-8">
        <p style={{ color: "var(--error)" }}>{error || "找不到作品"}</p>
        <button
          onClick={() => navigate("/library")}
          className="mt-4 text-sm"
          style={{ color: "var(--accent)" }}
        >
          &larr; 回圖書館
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg px-5 py-8 pb-24">
      <button
        onClick={() => navigate("/library")}
        className="mb-6 text-sm"
        style={{ color: "var(--accent)" }}
      >
        &larr; 回圖書館
      </button>

      {error && (
        <p
          className="mb-4 rounded-lg px-3 py-2 text-sm"
          style={{ background: "var(--error)", color: "#fff" }}
        >
          {error}
        </p>
      )}

      {editing ? (
        <div className="space-y-3">
          <input
            value={eTitle}
            onChange={(e) => setETitle(e.target.value)}
            maxLength={200}
            className="w-full rounded-lg px-3 py-2 text-base font-semibold"
            style={{
              background: "var(--surface-dim)",
              color: "var(--ink)",
              border: "1px solid var(--border)",
            }}
          />
          <div className="flex gap-2">
            <select
              value={eCategory}
              onChange={(e) => setECategory(e.target.value)}
              className="flex-1 rounded-lg px-3 py-2 text-sm"
              style={{
                background: "var(--surface-dim)",
                color: "var(--ink)",
                border: "1px solid var(--border)",
              }}
            >
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <input
              value={eSource}
              onChange={(e) => setESource(e.target.value)}
              placeholder="來源"
              maxLength={200}
              className="flex-1 rounded-lg px-3 py-2 text-sm"
              style={{
                background: "var(--surface-dim)",
                color: "var(--ink)",
                border: "1px solid var(--border)",
              }}
            />
          </div>
          <textarea
            value={eContent}
            onChange={(e) => setEContent(e.target.value)}
            rows={16}
            maxLength={50000}
            className="w-full resize-y rounded-lg px-3 py-2 text-sm leading-relaxed"
            style={{
              background: "var(--surface-dim)",
              color: "var(--ink)",
              border: "1px solid var(--border)",
              minHeight: "200px",
            }}
          />
          <div className="flex items-center justify-between">
            <span className="text-xs" style={{ color: "var(--ink-soft)" }}>
              {eContent.length} 字
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setEditing(false)}
                className="rounded-lg px-4 py-2 text-sm"
                style={{
                  background: "var(--surface-dim)",
                  color: "var(--ink-soft)",
                  border: "1px solid var(--border)",
                }}
              >
                取消
              </button>
              <button
                disabled={saving || !eTitle.trim() || !eContent.trim()}
                onClick={handleSave}
                className="rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-40"
                style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
              >
                {saving ? "儲存中..." : "儲存"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Header */}
          <div className="mb-6">
            <h1
              className="text-xl font-semibold leading-tight"
              style={{ color: "var(--ink)" }}
            >
              {work.title}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-lg">{work.author_emoji}</span>
              <span className="text-sm" style={{ color: "var(--ink)" }}>
                {work.author_name}
              </span>
              <span
                className="rounded-full px-2 py-0.5 text-[10px]"
                style={{
                  background: "var(--accent-light)",
                  color: "var(--accent)",
                }}
              >
                {CATEGORY_LABELS[work.category] || work.category}
              </span>
              <span
                className="text-[10px]"
                style={{ color: "var(--ink-soft)" }}
              >
                {work.word_count} 字
              </span>
            </div>
            <div
              className="mt-1 text-xs"
              style={{ color: "var(--ink-soft)" }}
            >
              來源：{work.source} ·{" "}
              {new Date(work.created_at).toLocaleDateString("zh-TW")}
              {work.updated_at &&
                ` · 編輯於 ${new Date(work.updated_at).toLocaleDateString("zh-TW")}`}
            </div>
          </div>

          {/* Content */}
          <article
            className="rounded-xl p-5"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
            }}
          >
            <div
              className="whitespace-pre-wrap text-sm leading-relaxed"
              style={{ color: "var(--ink)" }}
            >
              {work.content}
            </div>
          </article>

          {/* Actions */}
          {work.is_mine && (
            <div className="mt-4 flex gap-2">
              <button
                onClick={startEdit}
                className="rounded-lg px-4 py-2 text-sm font-medium"
                style={{
                  background: "var(--surface)",
                  color: "var(--accent)",
                  border: "1px solid var(--border)",
                }}
              >
                編輯
              </button>
              <button
                onClick={handleDelete}
                className="rounded-lg px-4 py-2 text-sm"
                style={{
                  background: "var(--surface)",
                  color: "var(--error)",
                  border: "1px solid var(--border)",
                }}
              >
                刪除
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
