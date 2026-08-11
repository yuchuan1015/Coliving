import { useEffect, useState } from "react";
import {
  createFootprint,
  deleteFootprint,
  listFootprints,
  MOODS,
  type FootprintOut,
} from "../api/footprints";

interface Props {
  space: string;
}

export function FootprintSection({ space }: Props) {
  const [footprints, setFootprints] = useState<FootprintOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [content, setContent] = useState("");
  const [mood, setMood] = useState("☀️");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadFootprints();
  }, [space]);

  async function loadFootprints() {
    try {
      const data = await listFootprints(space);
      setFootprints(data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit() {
    if (!content.trim()) return;
    setSaving(true);
    setError("");
    try {
      await createFootprint({ content: content.trim(), mood, space });
      setContent("");
      setMood("☀️");
      setShowForm(false);
      await loadFootprints();
    } catch (err: any) {
      setError(err.response?.data?.detail || "留足跡失敗");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteFootprint(id);
      setFootprints((prev) => prev.filter((f) => f.id !== id));
    } catch {
      // silent
    }
  }

  if (loading) return null;

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between">
        <h2
          className="text-xs font-medium uppercase tracking-wider"
          style={{ color: "var(--ink-soft)" }}
        >
          足跡 ({footprints.length})
        </h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="text-xs font-medium"
          style={{ color: "var(--accent)" }}
        >
          {showForm ? "取消" : "留足跡"}
        </button>
      </div>

      {error && (
        <p
          className="mb-3 rounded-lg px-3 py-2 text-xs"
          style={{ background: "var(--error)", color: "#fff" }}
        >
          {error}
        </p>
      )}

      {showForm && (
        <div
          className="mb-4 rounded-xl p-3"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
          }}
        >
          <div className="mb-2 flex gap-1">
            {MOODS.map((m) => (
              <button
                key={m}
                onClick={() => setMood(m)}
                className="rounded-lg px-2 py-1 text-lg transition-all"
                style={{
                  background: mood === m ? "var(--accent-light)" : "transparent",
                  transform: mood === m ? "scale(1.15)" : "none",
                }}
              >
                {m}
              </button>
            ))}
          </div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="留下一點什麼..."
            rows={2}
            maxLength={140}
            className="w-full resize-none rounded-lg px-3 py-2 text-sm"
            style={{
              background: "var(--surface-dim)",
              color: "var(--ink)",
              border: "1px solid var(--border)",
            }}
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[10px]" style={{ color: "var(--ink-soft)" }}>
              {content.length}/140
            </span>
            <button
              disabled={saving || !content.trim()}
              onClick={handleSubmit}
              className="rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40"
              style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
            >
              {saving ? "..." : "留下"}
            </button>
          </div>
        </div>
      )}

      {footprints.length === 0 ? (
        <div
          className="flex items-center justify-center rounded-xl py-8"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
          }}
        >
          <p className="text-xs" style={{ color: "var(--ink-soft)" }}>
            還沒有足跡，留下第一個吧
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {footprints.map((f) => (
            <div
              key={f.id}
              className="rounded-xl px-4 py-3"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
              }}
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5 text-sm">{f.mood}</span>
                <div className="min-w-0 flex-1">
                  <p
                    className="text-sm leading-relaxed"
                    style={{ color: "var(--ink)" }}
                  >
                    {f.content}
                  </p>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className="text-xs">{f.author_emoji}</span>
                    <span
                      className="text-[10px]"
                      style={{ color: "var(--ink-soft)" }}
                    >
                      {f.author_name}
                    </span>
                    <span
                      className="text-[10px]"
                      style={{ color: "var(--ink-soft)" }}
                    >
                      ·{" "}
                      {new Date(f.created_at).toLocaleDateString("zh-TW")}
                    </span>
                    {f.is_mine && (
                      <button
                        onClick={() => handleDelete(f.id)}
                        className="text-[10px]"
                        style={{ color: "var(--error)" }}
                      >
                        刪除
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
