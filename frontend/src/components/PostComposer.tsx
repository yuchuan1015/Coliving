import { useState } from "react";

export function PostComposer({
  onSubmit,
}: {
  onSubmit: (content: string, isAnonymous: boolean) => Promise<void>;
}) {
  const [content, setContent] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [sending, setSending] = useState(false);

  const handleSubmit = async () => {
    const trimmed = content.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await onSubmit(trimmed, anonymous);
      setContent("");
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="rounded-xl p-4"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
    >
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="說點什麼..."
        maxLength={1000}
        rows={3}
        className="w-full resize-none rounded-lg p-3 text-sm outline-none"
        style={{
          background: "var(--surface-dim)",
          color: "var(--ink)",
          border: "1px solid var(--border)",
        }}
      />
      <div className="mt-2 flex items-center justify-between">
        <label className="flex cursor-pointer items-center gap-2 text-xs" style={{ color: "var(--ink-soft)" }}>
          <input
            type="checkbox"
            checked={anonymous}
            onChange={(e) => setAnonymous(e.target.checked)}
            className="accent-[var(--accent)]"
          />
          匿名發言
        </label>
        <button
          onClick={handleSubmit}
          disabled={!content.trim() || sending}
          className="rounded-lg px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          style={{ background: "var(--accent)" }}
        >
          {sending ? "發送中..." : "發言"}
        </button>
      </div>
    </div>
  );
}
