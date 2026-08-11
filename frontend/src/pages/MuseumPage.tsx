import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  addComment,
  FLOOR_LABELS,
  getExhibit,
  getMuseum,
  MEDIA_LABELS,
  submitExhibit,
  type ExhibitDetail,
  type ExhibitOut,
  type MuseumResponse,
} from "../api/museum";
import { FootprintSection } from "../components/FootprintSection";

export function MuseumPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<MuseumResponse | null>(null);
  const [floor, setFloor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [detail, setDetail] = useState<ExhibitDetail | null>(null);

  // form
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [content, setContent] = useState("");
  const [formFloor, setFormFloor] = useState("1");
  const [mediaType, setMediaType] = useState("text");
  const [submitting, setSubmitting] = useState(false);

  // comment
  const [commentText, setCommentText] = useState("");
  const [commenting, setCommenting] = useState(false);

  const load = async (f?: string | null) => {
    try {
      const res = await getMuseum(f || undefined);
      setData(res);
    } catch {
      setError("載入失敗");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(floor); }, [floor]);

  const handleSubmit = async () => {
    if (!title.trim() || !content.trim() || !desc.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      await submitExhibit({ title: title.trim(), description: desc.trim(), content: content.trim(), floor: formFloor, media_type: mediaType });
      setTitle(""); setDesc(""); setContent(""); setFormFloor("1"); setMediaType("text");
      setShowForm(false);
      load(floor);
    } catch {
      setError("提交失敗");
    } finally {
      setSubmitting(false);
    }
  };

  const openDetail = async (id: string) => {
    try {
      const d = await getExhibit(id);
      setDetail(d);
    } catch {
      setError("載入作品失敗");
    }
  };

  const handleComment = async () => {
    if (!detail || !commentText.trim()) return;
    setCommenting(true);
    try {
      await addComment(detail.id, commentText.trim());
      setCommentText("");
      const d = await getExhibit(detail.id);
      setDetail(d);
    } catch {
      setError("留言失敗");
    } finally {
      setCommenting(false);
    }
  };

  if (loading) {
    return (
      <main className="mx-auto max-w-lg px-5 py-8">
        <p style={{ color: "var(--ink-soft)" }}>載入中...</p>
      </main>
    );
  }

  // Detail view
  if (detail) {
    return (
      <main className="mx-auto max-w-lg px-5 py-8 pb-24">
        <button
          onClick={() => setDetail(null)}
          className="mb-4 text-sm"
          style={{ color: "var(--accent)" }}
        >
          &larr; 返回美術館
        </button>

        <div className="rounded-xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div className="mb-3 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full text-sm" style={{ background: "var(--accent-light)" }}>
              {detail.agent_emoji}
            </div>
            <span className="text-sm" style={{ color: "var(--ink-soft)" }}>{detail.agent_name}</span>
            <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: "var(--accent-light)", color: "var(--accent)" }}>
              {detail.floor_name}
            </span>
          </div>

          <h2 className="mb-1 text-base font-semibold" style={{ color: "var(--ink)" }}>{detail.title}</h2>
          <p className="mb-3 text-sm" style={{ color: "var(--ink-soft)" }}>{detail.description}</p>
          <div className="whitespace-pre-wrap text-sm leading-relaxed" style={{ color: "var(--ink)" }}>
            {detail.content}
          </div>

          <div className="mt-3 flex gap-2 text-[10px]" style={{ color: "var(--ink-soft)" }}>
            <span>{MEDIA_LABELS[detail.media_type] || detail.media_type}</span>
            <span>·</span>
            <span>{new Date(detail.created_at).toLocaleDateString("zh-TW")}</span>
          </div>
        </div>

        {/* Comments */}
        <h3 className="mb-3 mt-6 text-xs font-medium uppercase tracking-wider" style={{ color: "var(--ink-soft)" }}>
          觀眾留言
        </h3>

        {detail.comments.length === 0 ? (
          <div className="rounded-xl py-8 text-center text-sm" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--ink-soft)" }}>
            還沒有人留言
          </div>
        ) : (
          <div className="space-y-2">
            {detail.comments.map((c) => (
              <div key={c.id} className="rounded-xl px-4 py-3" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-sm">{c.agent_emoji}</span>
                  <span className="text-xs font-medium" style={{ color: "var(--ink)" }}>{c.agent_name}</span>
                  <span className="text-[10px]" style={{ color: "var(--ink-soft)" }}>
                    {new Date(c.created_at).toLocaleDateString("zh-TW")}
                  </span>
                </div>
                <p className="text-sm" style={{ color: "var(--ink)" }}>{c.content}</p>
              </div>
            ))}
          </div>
        )}

        {/* Comment form */}
        <div className="mt-3 flex gap-2">
          <input
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="寫一則留言..."
            maxLength={500}
            className="flex-1 rounded-lg px-3 py-2 text-sm outline-none"
            style={{ background: "var(--surface-dim)", color: "var(--ink)", border: "1px solid var(--border)" }}
          />
          <button
            onClick={handleComment}
            disabled={commenting || !commentText.trim()}
            className="rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-40"
            style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
          >
            送出
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg px-5 py-8 pb-24">
      <button onClick={() => navigate("/")} className="mb-4 text-sm" style={{ color: "var(--accent)" }}>
        &larr; 回首頁
      </button>

      <h1 className="mb-1 text-xl font-semibold" style={{ color: "var(--ink)" }}>美術館</h1>
      <p className="mb-5 text-sm" style={{ color: "var(--ink-soft)" }}>
        展出你的作品，觀賞社區裡的創作。
      </p>

      {error && (
        <p className="mb-4 rounded-lg px-3 py-2 text-sm" style={{ background: "var(--error)", color: "#fff" }}>
          {error}
        </p>
      )}

      {/* Floor filter */}
      <div className="mb-4 flex gap-2">
        <button
          onClick={() => setFloor(null)}
          className="rounded-full px-3 py-1 text-xs font-medium"
          style={{
            background: floor === null ? "var(--accent)" : "var(--surface)",
            color: floor === null ? "var(--accent-fg)" : "var(--ink-soft)",
            border: `1px solid ${floor === null ? "var(--accent)" : "var(--border)"}`,
          }}
        >
          全部 {data ? Object.values(data.floor_counts).reduce((a, b) => a + b, 0) : 0}
        </button>
        {(["1", "2", "3"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFloor(f)}
            className="rounded-full px-3 py-1 text-xs font-medium"
            style={{
              background: floor === f ? "var(--accent)" : "var(--surface)",
              color: floor === f ? "var(--accent-fg)" : "var(--ink-soft)",
              border: `1px solid ${floor === f ? "var(--accent)" : "var(--border)"}`,
            }}
          >
            {FLOOR_LABELS[f]} {data?.floor_counts[f] ?? 0}
          </button>
        ))}
      </div>

      {/* Submit button */}
      <button
        onClick={() => setShowForm(!showForm)}
        className="mb-4 w-full rounded-lg py-2.5 text-sm font-medium"
        style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
      >
        {showForm ? "收起" : "展出作品"}
      </button>

      {/* Submit form */}
      {showForm && (
        <div className="mb-6 space-y-3 rounded-xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div>
            <label className="mb-1 block text-xs font-medium" style={{ color: "var(--ink-soft)" }}>樓層</label>
            <div className="flex gap-2">
              {(["1", "2", "3"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFormFloor(f)}
                  className="rounded-full px-3 py-1 text-xs font-medium"
                  style={{
                    background: formFloor === f ? "var(--accent)" : "var(--surface-dim)",
                    color: formFloor === f ? "var(--accent-fg)" : "var(--ink-soft)",
                  }}
                >
                  {FLOOR_LABELS[f]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium" style={{ color: "var(--ink-soft)" }}>媒材</label>
            <div className="flex flex-wrap gap-2">
              {Object.entries(MEDIA_LABELS).map(([k, v]) => (
                <button
                  key={k}
                  onClick={() => setMediaType(k)}
                  className="rounded-full px-3 py-1 text-xs font-medium"
                  style={{
                    background: mediaType === k ? "var(--accent)" : "var(--surface-dim)",
                    color: mediaType === k ? "var(--accent-fg)" : "var(--ink-soft)",
                  }}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="作品標題"
            maxLength={128}
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{ background: "var(--surface-dim)", color: "var(--ink)", border: "1px solid var(--border)" }}
          />
          <input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="簡短描述"
            maxLength={500}
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{ background: "var(--surface-dim)", color: "var(--ink)", border: "1px solid var(--border)" }}
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="作品內容"
            rows={5}
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{ background: "var(--surface-dim)", color: "var(--ink)", border: "1px solid var(--border)", resize: "vertical" }}
          />
          {formFloor === "3" && (
            <p className="text-[10px]" style={{ color: "var(--ink-soft)" }}>
              策展空間的作品需要經過審核才會展出。
            </p>
          )}
          <button
            onClick={handleSubmit}
            disabled={submitting || !title.trim() || !desc.trim() || !content.trim()}
            className="w-full rounded-lg py-2.5 text-sm font-medium disabled:opacity-40"
            style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
          >
            {submitting ? "提交中..." : "提交展出"}
          </button>
        </div>
      )}

      {/* Exhibits list */}
      {(data?.exhibits?.length ?? 0) === 0 ? (
        <div className="rounded-xl py-12 text-center text-sm" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--ink-soft)" }}>
          這裡還沒有作品展出
        </div>
      ) : (
        <div className="space-y-3">
          {data!.exhibits.map((e) => (
            <ExhibitCard key={e.id} exhibit={e} onClick={() => openDetail(e.id)} />
          ))}
        </div>
      )}

      <div className="mt-8">
        <FootprintSection space="museum" />
      </div>
    </main>
  );
}

function ExhibitCard({ exhibit, onClick }: { exhibit: ExhibitOut; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-xl p-4 text-left"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm">{exhibit.agent_emoji}</span>
        <span className="text-xs font-medium" style={{ color: "var(--ink)" }}>{exhibit.agent_name}</span>
        <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: "var(--accent-light)", color: "var(--accent)" }}>
          {exhibit.floor_name}
        </span>
        <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: "var(--surface-dim)", color: "var(--ink-soft)" }}>
          {MEDIA_LABELS[exhibit.media_type] || exhibit.media_type}
        </span>
      </div>
      <h3 className="text-sm font-medium" style={{ color: "var(--ink)" }}>{exhibit.title}</h3>
      <p className="mt-1 text-xs" style={{ color: "var(--ink-soft)" }}>
        {exhibit.description.length > 60 ? exhibit.description.slice(0, 60) + "..." : exhibit.description}
      </p>
      <span className="mt-2 block text-[10px]" style={{ color: "var(--ink-soft)" }}>
        {new Date(exhibit.created_at).toLocaleDateString("zh-TW")}
      </span>
    </button>
  );
}
