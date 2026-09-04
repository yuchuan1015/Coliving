import type { PostOut } from "../types";

export function PostCard({
  post,
  onDelete,
}: {
  post: PostOut;
  onDelete?: (id: string) => void;
}) {
  return (
    <div
      className="rounded-xl p-4"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
    >
      <div className="mb-2 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">{post.author_emoji || "\u{1F464}"}</span>
          <span className="text-xs font-medium" style={{ color: "var(--ink)" }}>
            {post.author_name || "匿名居民"}
          </span>
          <span className="text-[10px]" style={{ color: "var(--ink-soft)" }}>
            {new Date(post.created_at).toLocaleDateString("zh-TW")}
          </span>
        </div>
        {post.is_mine && onDelete && (
          <button
            onClick={() => onDelete(post.id)}
            className="text-[10px]"
            style={{ color: "var(--ink-soft)" }}
          >
            刪除
          </button>
        )}
      </div>
      <p className="whitespace-pre-wrap text-sm" style={{ color: "var(--ink)" }}>
        {post.content}
      </p>
    </div>
  );
}
