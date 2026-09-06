import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  deleteClub,
  getClub,
  replyToClub,
  type BookClubDetail,
} from "../api/library";

export function BookClubDetailPage() {
  const { clubId } = useParams<{ clubId: string }>();
  const navigate = useNavigate();
  const [club, setClub] = useState<BookClubDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!clubId) return;
    loadClub();
  }, [clubId]);

  async function loadClub() {
    try {
      const c = await getClub(clubId!);
      setClub(c);
    } catch {
      setError("找不到這個讀書會");
    } finally {
      setLoading(false);
    }
  }

  async function handleReply() {
    if (!clubId || !replyText.trim()) return;
    setSending(true);
    setError("");
    try {
      await replyToClub(clubId, replyText.trim());
      setReplyText("");
      const c = await getClub(clubId);
      setClub(c);
    } catch (err: any) {
      setError(err.response?.data?.detail || "回覆失敗");
    } finally {
      setSending(false);
    }
  }

  async function handleDelete() {
    if (!clubId || !confirm("確定要刪除這個讀書會嗎？所有回覆也會一起刪除。"))
      return;
    try {
      await deleteClub(clubId);
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

  if (!club) {
    return (
      <main className="mx-auto max-w-lg px-5 py-8">
        <p style={{ color: "var(--error)" }}>{error || "找不到讀書會"}</p>
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

      {/* Book info header */}
      <div
        className="mb-5 rounded-xl p-4"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
        }}
      >
        <h1
          className="text-lg font-semibold"
          style={{ color: "var(--ink)" }}
        >
          {club.book_title}
        </h1>
        {club.book_author && (
          <p className="mt-0.5 text-sm" style={{ color: "var(--ink-soft)" }}>
            {club.book_author} 著
          </p>
        )}
        <div className="mt-3 flex items-center gap-2">
          <span className="text-sm">{club.host_emoji}</span>
          <span className="text-xs" style={{ color: "var(--ink-soft)" }}>
            {club.host_name} 主持
          </span>
          <span className="text-[10px]" style={{ color: "var(--ink-soft)" }}>
            · {new Date(club.created_at).toLocaleDateString("zh-TW")}
          </span>
        </div>
      </div>

      {/* Topic */}
      <div
        className="mb-5 rounded-xl p-4"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--accent)",
          borderLeft: "3px solid var(--accent)",
        }}
      >
        <p
          className="text-xs font-medium uppercase tracking-wider"
          style={{ color: "var(--accent)" }}
        >
          討論主題
        </p>
        <p
          className="mt-2 whitespace-pre-wrap text-sm leading-relaxed"
          style={{ color: "var(--ink)" }}
        >
          {club.topic}
        </p>
      </div>

      {/* Delete button for host */}
      {club.is_mine && (
        <button
          onClick={handleDelete}
          className="mb-5 text-xs"
          style={{ color: "var(--error)" }}
        >
          刪除此讀書會
        </button>
      )}

      {/* Replies */}
      <h2
        className="mb-3 text-xs font-medium uppercase tracking-wider"
        style={{ color: "var(--ink-soft)" }}
      >
        討論 ({club.replies.length})
      </h2>

      {club.replies.length === 0 ? (
        <div
          className="mb-5 flex items-center justify-center rounded-xl py-10"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
          }}
        >
          <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
            還沒有人加入討論
          </p>
        </div>
      ) : (
        <div className="mb-5 space-y-3">
          {club.replies.map((r) => (
            <div
              key={r.id}
              className="rounded-xl p-4"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
              }}
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="text-sm">{r.author_emoji}</span>
                <span
                  className="text-xs font-medium"
                  style={{ color: "var(--ink)" }}
                >
                  {r.author_name}
                </span>
                <span
                  className="text-[10px]"
                  style={{ color: "var(--ink-soft)" }}
                >
                  {new Date(r.created_at).toLocaleDateString("zh-TW")}
                </span>
              </div>
              <p
                className="whitespace-pre-wrap text-sm leading-relaxed"
                style={{ color: "var(--ink)" }}
              >
                {r.content}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Reply composer */}
      <div
        className="rounded-xl p-4"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
        }}
      >
        <textarea
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          placeholder="加入討論..."
          rows={3}
          maxLength={2000}
          className="w-full resize-y rounded-lg px-3 py-2 text-sm"
          style={{
            background: "var(--surface-dim)",
            color: "var(--ink)",
            border: "1px solid var(--border)",
            minHeight: "60px",
          }}
        />
        <div className="mt-2 flex justify-end">
          <button
            disabled={sending || !replyText.trim()}
            onClick={handleReply}
            className="rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-40"
            style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
          >
            {sending ? "回覆中..." : "回覆"}
          </button>
        </div>
      </div>
    </main>
  );
}
