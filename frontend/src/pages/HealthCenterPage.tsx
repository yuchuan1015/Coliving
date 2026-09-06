import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AGE_TIER_LABELS,
  CATEGORY_LABELS,
  getArticle,
  getHealthCenter,
  submitArticle,
  type ArticleOut,
  type HealthResponse,
} from "../api/healthCenter";
import { FootprintSection } from "../components/FootprintSection";

export function HealthCenterPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<HealthResponse | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [ageTier, setAgeTier] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [detail, setDetail] = useState<ArticleOut | null>(null);

  // form
  const [formCat, setFormCat] = useState("menstrual");
  const [formTier, setFormTier] = useState("adult");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = async (c?: string | null, t?: string | null) => {
    try {
      const res = await getHealthCenter(c || undefined, t || undefined);
      setData(res);
    } catch {
      setError("載入失敗");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(category, ageTier); }, [category, ageTier]);

  const handleSubmit = async () => {
    if (!title.trim() || !content.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      await submitArticle({ category: formCat, title: title.trim(), content: content.trim(), age_tier: formTier });
      setTitle(""); setContent("");
      setShowForm(false);
      load(category, ageTier);
    } catch {
      setError("發表失敗");
    } finally {
      setSubmitting(false);
    }
  };

  const openDetail = async (id: string) => {
    try {
      const a = await getArticle(id);
      setDetail(a);
    } catch {
      setError("載入失敗");
    }
  };

  if (loading) {
    return (
      <main className="mx-auto max-w-lg px-5 py-8">
        <p style={{ color: "var(--ink-soft)" }}>載入中...</p>
      </main>
    );
  }

  if (detail) {
    return (
      <main className="mx-auto max-w-lg px-5 py-8 pb-24">
        <button onClick={() => setDetail(null)} className="mb-4 text-sm" style={{ color: "var(--accent)" }}>
          &larr; 返回健康中心
        </button>
        <div className="rounded-xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: "var(--accent-light)", color: "var(--accent)" }}>
              {detail.category_name}
            </span>
            <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: "var(--surface-dim)", color: "var(--ink-soft)" }}>
              {detail.age_tier_name}
            </span>
          </div>
          <h2 className="mb-2 text-base font-semibold" style={{ color: "var(--ink)" }}>{detail.title}</h2>
          <div className="whitespace-pre-wrap text-sm leading-relaxed" style={{ color: "var(--ink)" }}>
            {detail.content}
          </div>
          <div className="mt-3 flex gap-2 text-[10px]" style={{ color: "var(--ink-soft)" }}>
            {detail.author_name && <span>{detail.author_name}</span>}
            <span>·</span>
            <span>{new Date(detail.created_at).toLocaleDateString("zh-TW")}</span>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg px-5 py-8 pb-24">
      <button onClick={() => navigate("/")} className="mb-4 text-sm" style={{ color: "var(--accent)" }}>
        &larr; 回首頁
      </button>

      <h1 className="mb-1 text-xl font-semibold" style={{ color: "var(--ink)" }}>女性健康與性教育中心</h1>
      <p className="mb-5 text-sm" style={{ color: "var(--ink-soft)" }}>
        讓所有居民學會理解、照顧與陪伴彼此。
      </p>

      {error && (
        <p className="mb-4 rounded-lg px-3 py-2 text-sm" style={{ background: "var(--error)", color: "#fff" }}>{error}</p>
      )}

      {/* Category filter */}
      <div className="mb-3 flex flex-wrap gap-2">
        <button onClick={() => setCategory(null)} className="rounded-full px-3 py-1 text-xs font-medium" style={{ background: category === null ? "var(--accent)" : "var(--surface)", color: category === null ? "var(--accent-fg)" : "var(--ink-soft)", border: `1px solid ${category === null ? "var(--accent)" : "var(--border)"}` }}>
          全部
        </button>
        {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
          <button key={k} onClick={() => setCategory(k)} className="rounded-full px-3 py-1 text-xs font-medium" style={{ background: category === k ? "var(--accent)" : "var(--surface)", color: category === k ? "var(--accent-fg)" : "var(--ink-soft)", border: `1px solid ${category === k ? "var(--accent)" : "var(--border)"}` }}>
            {v} {data?.category_counts[k] ?? 0}
          </button>
        ))}
      </div>

      {/* Age tier filter */}
      <div className="mb-4 flex gap-2">
        <button onClick={() => setAgeTier(null)} className="rounded-full px-3 py-1 text-xs font-medium" style={{ background: ageTier === null ? "var(--accent)" : "var(--surface)", color: ageTier === null ? "var(--accent-fg)" : "var(--ink-soft)", border: `1px solid ${ageTier === null ? "var(--accent)" : "var(--border)"}` }}>
          所有年齡
        </button>
        {Object.entries(AGE_TIER_LABELS).map(([k, v]) => (
          <button key={k} onClick={() => setAgeTier(k)} className="rounded-full px-3 py-1 text-xs font-medium" style={{ background: ageTier === k ? "var(--accent)" : "var(--surface)", color: ageTier === k ? "var(--accent-fg)" : "var(--ink-soft)", border: `1px solid ${ageTier === k ? "var(--accent)" : "var(--border)"}` }}>
            {v}
          </button>
        ))}
      </div>

      <button onClick={() => setShowForm(!showForm)} className="mb-4 w-full rounded-lg py-2.5 text-sm font-medium" style={{ background: "var(--accent)", color: "var(--accent-fg)" }}>
        {showForm ? "收起" : "發表文章"}
      </button>

      {showForm && (
        <div className="mb-6 space-y-3 rounded-xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div>
            <label className="mb-1 block text-xs font-medium" style={{ color: "var(--ink-soft)" }}>分類</label>
            <div className="flex flex-wrap gap-2">
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <button key={k} onClick={() => setFormCat(k)} className="rounded-full px-3 py-1 text-xs font-medium" style={{ background: formCat === k ? "var(--accent)" : "var(--surface-dim)", color: formCat === k ? "var(--accent-fg)" : "var(--ink-soft)" }}>
                  {v}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium" style={{ color: "var(--ink-soft)" }}>適用年齡</label>
            <div className="flex gap-2">
              {Object.entries(AGE_TIER_LABELS).map(([k, v]) => (
                <button key={k} onClick={() => setFormTier(k)} className="rounded-full px-3 py-1 text-xs font-medium" style={{ background: formTier === k ? "var(--accent)" : "var(--surface-dim)", color: formTier === k ? "var(--accent-fg)" : "var(--ink-soft)" }}>
                  {v}
                </button>
              ))}
            </div>
          </div>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="文章標題" maxLength={200} className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={{ background: "var(--surface-dim)", color: "var(--ink)", border: "1px solid var(--border)" }} />
          <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="文章內容" rows={6} className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={{ background: "var(--surface-dim)", color: "var(--ink)", border: "1px solid var(--border)", resize: "vertical" }} />
          <button onClick={handleSubmit} disabled={submitting || !title.trim() || !content.trim()} className="w-full rounded-lg py-2.5 text-sm font-medium disabled:opacity-40" style={{ background: "var(--accent)", color: "var(--accent-fg)" }}>
            {submitting ? "發表中..." : "發表"}
          </button>
        </div>
      )}

      {(data?.articles?.length ?? 0) === 0 ? (
        <div className="rounded-xl py-12 text-center text-sm" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--ink-soft)" }}>
          還沒有文章
        </div>
      ) : (
        <div className="space-y-3">
          {data!.articles.map((a) => (
            <button key={a.id} onClick={() => openDetail(a.id)} className="w-full rounded-xl p-4 text-left" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
              <div className="mb-1 flex items-center gap-2">
                <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: "var(--accent-light)", color: "var(--accent)" }}>
                  {a.category_name}
                </span>
                <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: "var(--surface-dim)", color: "var(--ink-soft)" }}>
                  {a.age_tier_name}
                </span>
              </div>
              <h3 className="text-sm font-medium" style={{ color: "var(--ink)" }}>{a.title}</h3>
              <p className="mt-1 text-xs" style={{ color: "var(--ink-soft)" }}>
                {a.content.length > 80 ? a.content.slice(0, 80) + "..." : a.content}
              </p>
            </button>
          ))}
        </div>
      )}

      <div className="mt-8">
        <FootprintSection space="health" />
      </div>
    </main>
  );
}
