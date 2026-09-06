import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createPhotoFrame,
  deletePhotoFrame,
  getPhotoFrames,
  updatePhotoFrame,
  type PhotoFrame,
} from "../api/furniture";

const CATEGORIES = [
  { value: "about_me" as const, label: "關於我" },
  { value: "preferences" as const, label: "喜好" },
  { value: "boundaries" as const, label: "界線" },
  { value: "schedule" as const, label: "日程" },
  { value: "notes" as const, label: "備忘" },
];

export function PhotoFramePage() {
  const navigate = useNavigate();
  const [frames, setFrames] = useState<PhotoFrame[]>([]);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [cat, setCat] = useState<PhotoFrame["category"]>("about_me");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [filterCat, setFilterCat] = useState<string | null>(null);

  useEffect(() => {
    getPhotoFrames()
      .then(setFrames)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    if (!title.trim() || !content.trim()) return;
    setSaving(true);
    try {
      if (editingId) {
        const updated = await updatePhotoFrame(editingId, {
          title: title.trim(),
          content: content.trim(),
        });
        setFrames((prev) =>
          prev.map((f) => (f.id === editingId ? updated : f)),
        );
      } else {
        const frame = await createPhotoFrame({
          category: cat,
          title: title.trim(),
          content: content.trim(),
        });
        setFrames((prev) => [frame, ...prev]);
      }
      resetForm();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  function startEdit(frame: PhotoFrame) {
    setEditingId(frame.id);
    setCat(frame.category);
    setTitle(frame.title);
    setContent(frame.content);
    setComposing(true);
  }

  function resetForm() {
    setComposing(false);
    setEditingId(null);
    setCat("about_me");
    setTitle("");
    setContent("");
  }

  async function handleDelete(id: string) {
    try {
      await deletePhotoFrame(id);
      setFrames((prev) => prev.filter((f) => f.id !== id));
    } catch (err) {
      console.error(err);
    }
  }

  const filtered = filterCat
    ? frames.filter((f) => f.category === filterCat)
    : frames;

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
          🖼️ 相框
        </h1>
      </div>

      <p className="mb-4 text-[12px]" style={{ color: "var(--ink-muted)" }}>
        放在相框裡的東西，你的 AI 室友可以看到。
      </p>

      {/* Category filter */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        <button
          onClick={() => setFilterCat(null)}
          className="rounded-full px-3 py-1 text-[12px] font-medium"
          style={{
            background: filterCat === null ? "var(--accent)" : "var(--surface)",
            color: filterCat === null ? "var(--bg)" : "var(--ink-soft)",
            border: `1px solid ${filterCat === null ? "var(--accent)" : "var(--border)"}`,
          }}
        >
          全部
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            onClick={() => setFilterCat(c.value)}
            className="rounded-full px-3 py-1 text-[12px] font-medium"
            style={{
              background:
                filterCat === c.value ? "var(--accent)" : "var(--surface)",
              color:
                filterCat === c.value ? "var(--bg)" : "var(--ink-soft)",
              border: `1px solid ${filterCat === c.value ? "var(--accent)" : "var(--border)"}`,
            }}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Add / Edit form */}
      {composing ? (
        <div
          className="mb-5 rounded-xl p-4"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
          }}
        >
          {!editingId && (
            <div className="mb-3">
              <label
                className="mb-1.5 block text-[12px] font-medium"
                style={{ color: "var(--ink-soft)" }}
              >
                分類
              </label>
              <select
                value={cat}
                onChange={(e) =>
                  setCat(e.target.value as PhotoFrame["category"])
                }
                className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
                style={{
                  background: "var(--surface-dim)",
                  border: "1px solid var(--border)",
                  color: "var(--ink)",
                }}
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          )}
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
            placeholder="內容⋯"
            rows={4}
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
              {saving ? "儲存中⋯" : editingId ? "更新" : "掛上去"}
            </button>
            <button
              onClick={resetForm}
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
          + 新增相框
        </button>
      )}

      {/* Frames list */}
      {loading ? (
        <p
          className="text-center text-[13px]"
          style={{ color: "var(--ink-soft)" }}
        >
          載入中⋯
        </p>
      ) : filtered.length === 0 ? (
        <p
          className="text-center text-[13px]"
          style={{ color: "var(--ink-soft)" }}
        >
          {filterCat ? "這個分類還沒有相框" : "還沒有相框"}
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map((frame) => (
            <div
              key={frame.id}
              className="rounded-xl px-4 py-3"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
              }}
            >
              <div className="mb-1 flex items-start justify-between">
                <div>
                  <span
                    className="mr-2 rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{
                      background: "var(--surface-dim)",
                      color: "var(--ink-soft)",
                    }}
                  >
                    {CATEGORIES.find((c) => c.value === frame.category)?.label}
                  </span>
                  <h3
                    className="mt-1 text-[14px] font-medium"
                    style={{ color: "var(--ink)" }}
                  >
                    {frame.title}
                  </h3>
                </div>
              </div>
              <p
                className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed"
                style={{ color: "var(--ink-soft)" }}
              >
                {frame.content}
              </p>
              <div className="mt-3 flex gap-3">
                <button
                  onClick={() => startEdit(frame)}
                  className="text-[12px]"
                  style={{ color: "var(--ink-muted)" }}
                >
                  編輯
                </button>
                <button
                  onClick={() => handleDelete(frame.id)}
                  className="text-[12px]"
                  style={{ color: "var(--error)" }}
                >
                  拿下來
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
