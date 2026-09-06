import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  deleteDrawerItem,
  getDrawerItems,
  storeDrawerItem,
  type DrawerItem,
} from "../api/furniture";

export function DrawerPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<DrawerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);
  const [label, setLabel] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("");
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    getDrawerItems()
      .then(setItems)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function handleStore() {
    if (!label.trim() || !content.trim()) return;
    setSaving(true);
    try {
      const item = await storeDrawerItem({
        label: label.trim(),
        content: content.trim(),
        category: category.trim() || undefined,
      });
      setItems((prev) => [item, ...prev]);
      setLabel("");
      setContent("");
      setCategory("");
      setComposing(false);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteDrawerItem(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
      if (expanded === id) setExpanded(null);
    } catch (err) {
      console.error(err);
    }
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
          🗄️ 抽屜
        </h1>
      </div>

      {/* Add item */}
      {composing ? (
        <div
          className="mb-5 rounded-xl p-4"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        >
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="物品名稱"
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
            placeholder="內容或描述⋯"
            rows={3}
            className="mb-3 w-full resize-none rounded-lg px-3 py-2 text-[13px] outline-none"
            style={{
              background: "var(--surface-dim)",
              border: "1px solid var(--border)",
              color: "var(--ink)",
            }}
          />
          <input
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="分類（選填）"
            className="mb-3 w-full rounded-lg px-3 py-2 text-[13px] outline-none"
            style={{
              background: "var(--surface-dim)",
              border: "1px solid var(--border)",
              color: "var(--ink)",
            }}
          />
          <div className="flex gap-2">
            <button
              onClick={handleStore}
              disabled={saving || !label.trim() || !content.trim()}
              className="rounded-lg px-4 py-1.5 text-[13px] font-medium disabled:opacity-50"
              style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
            >
              {saving ? "存入中⋯" : "放進抽屜"}
            </button>
            <button
              onClick={() => {
                setComposing(false);
                setLabel("");
                setContent("");
                setCategory("");
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
          + 放東西進去
        </button>
      )}

      {/* Items */}
      {loading ? (
        <p className="text-center text-[13px]" style={{ color: "var(--ink-soft)" }}>
          載入中⋯
        </p>
      ) : items.length === 0 ? (
        <p className="text-center text-[13px]" style={{ color: "var(--ink-soft)" }}>
          抽屜是空的
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="rounded-xl px-4 py-3"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
              }}
            >
              <button
                onClick={() =>
                  setExpanded(expanded === item.id ? null : item.id)
                }
                className="flex w-full items-center justify-between text-left"
              >
                <div>
                  <h3
                    className="text-[14px] font-medium"
                    style={{ color: "var(--ink)" }}
                  >
                    {item.label}
                  </h3>
                  <span className="text-[11px]" style={{ color: "var(--ink-muted)" }}>
                    {item.category && `${item.category} · `}
                    {new Date(item.created_at).toLocaleDateString("zh-TW")}
                  </span>
                </div>
                <span
                  className="text-[11px]"
                  style={{ color: "var(--ink-muted)" }}
                >
                  {expanded === item.id ? "▾" : "▸"}
                </span>
              </button>
              {expanded === item.id && (
                <div className="mt-3">
                  <p
                    className="whitespace-pre-wrap text-[13px] leading-relaxed"
                    style={{ color: "var(--ink-soft)" }}
                  >
                    {item.content}
                  </p>
                  <div className="mt-3 flex justify-end">
                    <button
                      onClick={() => handleDelete(item.id)}
                      className="text-[12px]"
                      style={{ color: "var(--error)" }}
                    >
                      丟掉
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
