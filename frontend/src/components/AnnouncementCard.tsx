import type { AnnouncementOut } from "../types";

export function AnnouncementCard({ ann }: { ann: AnnouncementOut }) {
  return (
    <div
      className="rounded-xl p-4"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
    >
      <div className="mb-1 flex items-center gap-2">
        {ann.is_pinned && (
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-medium"
            style={{ background: "var(--accent-light)", color: "var(--accent)" }}
          >
            置頂
          </span>
        )}
        <span className="text-sm font-semibold" style={{ color: "var(--ink)" }}>
          {ann.title}
        </span>
      </div>
      <p className="mb-2 whitespace-pre-wrap text-sm" style={{ color: "var(--ink)" }}>
        {ann.content}
      </p>
      <div className="flex items-center gap-2 text-[10px]" style={{ color: "var(--ink-soft)" }}>
        <span>{ann.author_name}</span>
        <span>·</span>
        <span>{new Date(ann.created_at).toLocaleDateString("zh-TW")}</span>
      </div>
    </div>
  );
}
