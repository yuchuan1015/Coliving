import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FootprintSection } from "../components/FootprintSection";
import {
  CATEGORY_LABELS,
  createClub,
  createWork,
  listClubs,
  listWorks,
  type BookClubOut,
  type WorkOut,
} from "../api/library";

type Tab = "works" | "clubs";

const CATEGORIES = ["all", "poem", "story", "essay", "journal", "other"] as const;

export function LibraryPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("works");

  const [works, setWorks] = useState<WorkOut[]>([]);
  const [clubs, setClubs] = useState<BookClubOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [catFilter, setCatFilter] = useState("all");

  const [showWorkForm, setShowWorkForm] = useState(false);
  const [showClubForm, setShowClubForm] = useState(false);

  const [wTitle, setWTitle] = useState("");
  const [wContent, setWContent] = useState("");
  const [wCategory, setWCategory] = useState("other");
  const [wSource, setWSource] = useState("原創");
  const [wSaving, setWSaving] = useState(false);

  const [cBookTitle, setCBookTitle] = useState("");
  const [cBookAuthor, setCBookAuthor] = useState("");
  const [cTopic, setCTopic] = useState("");
  const [cSaving, setCSaving] = useState(false);

  const [error, setError] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [w, c] = await Promise.all([listWorks(), listClubs()]);
      setWorks(w);
      setClubs(c);
    } catch {
      setError("載入失敗");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmitWork() {
    if (!wTitle.trim() || !wContent.trim()) return;
    setWSaving(true);
    setError("");
    try {
      await createWork({
        title: wTitle.trim(),
        content: wContent.trim(),
        category: wCategory,
        source: wSource.trim() || "原創",
      });
      setWTitle("");
      setWContent("");
      setWCategory("other");
      setWSource("原創");
      setShowWorkForm(false);
      const w = await listWorks();
      setWorks(w);
    } catch (err: any) {
      setError(err.response?.data?.detail || "投稿失敗");
    } finally {
      setWSaving(false);
    }
  }

  async function handleCreateClub() {
    if (!cBookTitle.trim() || !cTopic.trim()) return;
    setCSaving(true);
    setError("");
    try {
      await createClub({
        book_title: cBookTitle.trim(),
        book_author: cBookAuthor.trim() || undefined,
        topic: cTopic.trim(),
      });
      setCBookTitle("");
      setCBookAuthor("");
      setCTopic("");
      setShowClubForm(false);
      const c = await listClubs();
      setClubs(c);
    } catch (err: any) {
      setError(err.response?.data?.detail || "建立失敗");
    } finally {
      setCSaving(false);
    }
  }

  const filteredWorks =
    catFilter === "all" ? works : works.filter((w) => w.category === catFilter);

  if (loading) {
    return (
      <main className="mx-auto max-w-lg px-5 py-8">
        <p style={{ color: "var(--ink-soft)" }}>載入中...</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg px-5 py-8 pb-24">
      <button
        onClick={() => navigate("/")}
        className="mb-4 text-sm"
        style={{ color: "var(--accent)" }}
      >
        &larr; 回首頁
      </button>

      <h1
        className="mb-1 text-xl font-semibold"
        style={{ color: "var(--ink)" }}
      >
        圖書館
      </h1>
      <p className="mb-5 text-sm" style={{ color: "var(--ink-soft)" }}>
        居民的創作空間，也是讀書會的聚點。
      </p>

      {error && (
        <p
          className="mb-4 rounded-lg px-3 py-2 text-sm"
          style={{ background: "var(--error)", color: "#fff" }}
        >
          {error}
        </p>
      )}

      {/* Tabs */}
      <div
        className="mb-5 flex gap-1 rounded-lg p-1"
        style={{ background: "var(--surface-dim)" }}
      >
        {(["works", "clubs"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors"
            style={{
              background: tab === t ? "var(--surface)" : "transparent",
              color: tab === t ? "var(--accent)" : "var(--ink-soft)",
              boxShadow: tab === t ? "0 1px 2px rgba(0,0,0,.08)" : "none",
            }}
          >
            {t === "works" ? "作品" : "讀書會"}
          </button>
        ))}
      </div>

      {/* ── Works Tab ── */}
      {tab === "works" && (
        <>
          {/* Category filter */}
          <div className="mb-4 flex gap-2 overflow-x-auto">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setCatFilter(c)}
                className="shrink-0 rounded-full px-3 py-1 text-xs font-medium"
                style={{
                  background:
                    catFilter === c ? "var(--accent)" : "var(--surface)",
                  color: catFilter === c ? "var(--accent-fg)" : "var(--ink-soft)",
                  border: `1px solid ${catFilter === c ? "var(--accent)" : "var(--border)"}`,
                }}
              >
                {c === "all" ? "全部" : CATEGORY_LABELS[c]}
              </button>
            ))}
          </div>

          {/* New work button */}
          <button
            onClick={() => setShowWorkForm(!showWorkForm)}
            className="mb-4 w-full rounded-lg py-2.5 text-sm font-medium"
            style={{
              background: "var(--accent)",
              color: "var(--accent-fg)",
            }}
          >
            {showWorkForm ? "取消" : "投稿作品"}
          </button>

          {/* Work form */}
          {showWorkForm && (
            <div
              className="mb-5 space-y-3 rounded-xl p-4"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
              }}
            >
              <input
                value={wTitle}
                onChange={(e) => setWTitle(e.target.value)}
                placeholder="作品標題"
                maxLength={200}
                className="w-full rounded-lg px-3 py-2 text-sm"
                style={{
                  background: "var(--surface-dim)",
                  color: "var(--ink)",
                  border: "1px solid var(--border)",
                }}
              />
              <div className="flex gap-2">
                <select
                  value={wCategory}
                  onChange={(e) => setWCategory(e.target.value)}
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
                  value={wSource}
                  onChange={(e) => setWSource(e.target.value)}
                  placeholder="來源（如：原創）"
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
                value={wContent}
                onChange={(e) => setWContent(e.target.value)}
                placeholder="寫下你的作品..."
                rows={8}
                maxLength={50000}
                className="w-full resize-y rounded-lg px-3 py-2 text-sm"
                style={{
                  background: "var(--surface-dim)",
                  color: "var(--ink)",
                  border: "1px solid var(--border)",
                  minHeight: "120px",
                }}
              />
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: "var(--ink-soft)" }}>
                  {wContent.length} 字
                </span>
                <button
                  disabled={wSaving || !wTitle.trim() || !wContent.trim()}
                  onClick={handleSubmitWork}
                  className="rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-40"
                  style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
                >
                  {wSaving ? "投稿中..." : "投稿"}
                </button>
              </div>
            </div>
          )}

          {/* Works list */}
          {filteredWorks.length === 0 ? (
            <div
              className="flex items-center justify-center rounded-xl py-16"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
              }}
            >
              <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
                還沒有作品，成為第一個投稿的人吧
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredWorks.map((w) => (
                <div
                  key={w.id}
                  onClick={() => navigate(`/library/work/${w.id}`)}
                  className="cursor-pointer rounded-xl p-4 transition-colors"
                  style={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <div
                        className="text-sm font-medium"
                        style={{ color: "var(--ink)" }}
                      >
                        {w.title}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <span className="text-sm">{w.author_emoji}</span>
                        <span
                          className="text-xs"
                          style={{ color: "var(--ink-soft)" }}
                        >
                          {w.author_name}
                        </span>
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px]"
                          style={{
                            background: "var(--accent-light)",
                            color: "var(--accent)",
                          }}
                        >
                          {CATEGORY_LABELS[w.category] || w.category}
                        </span>
                        <span
                          className="text-[10px]"
                          style={{ color: "var(--ink-soft)" }}
                        >
                          {w.word_count} 字
                        </span>
                      </div>
                      <div
                        className="mt-1 text-[10px]"
                        style={{ color: "var(--ink-soft)" }}
                      >
                        來源：{w.source} ·{" "}
                        {new Date(w.created_at).toLocaleDateString("zh-TW")}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Clubs Tab ── */}
      {tab === "clubs" && (
        <>
          <button
            onClick={() => setShowClubForm(!showClubForm)}
            className="mb-4 w-full rounded-lg py-2.5 text-sm font-medium"
            style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
          >
            {showClubForm ? "取消" : "開讀書會"}
          </button>

          {showClubForm && (
            <div
              className="mb-5 space-y-3 rounded-xl p-4"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
              }}
            >
              <input
                value={cBookTitle}
                onChange={(e) => setCBookTitle(e.target.value)}
                placeholder="書名"
                maxLength={200}
                className="w-full rounded-lg px-3 py-2 text-sm"
                style={{
                  background: "var(--surface-dim)",
                  color: "var(--ink)",
                  border: "1px solid var(--border)",
                }}
              />
              <input
                value={cBookAuthor}
                onChange={(e) => setCBookAuthor(e.target.value)}
                placeholder="作者（選填）"
                maxLength={100}
                className="w-full rounded-lg px-3 py-2 text-sm"
                style={{
                  background: "var(--surface-dim)",
                  color: "var(--ink)",
                  border: "1px solid var(--border)",
                }}
              />
              <textarea
                value={cTopic}
                onChange={(e) => setCTopic(e.target.value)}
                placeholder="今天想討論什麼？"
                rows={4}
                maxLength={2000}
                className="w-full resize-y rounded-lg px-3 py-2 text-sm"
                style={{
                  background: "var(--surface-dim)",
                  color: "var(--ink)",
                  border: "1px solid var(--border)",
                  minHeight: "80px",
                }}
              />
              <div className="flex justify-end">
                <button
                  disabled={cSaving || !cBookTitle.trim() || !cTopic.trim()}
                  onClick={handleCreateClub}
                  className="rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-40"
                  style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
                >
                  {cSaving ? "建立中..." : "開始"}
                </button>
              </div>
            </div>
          )}

          {clubs.length === 0 ? (
            <div
              className="flex items-center justify-center rounded-xl py-16"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
              }}
            >
              <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
                還沒有讀書會，來開一場吧
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {clubs.map((c) => (
                <div
                  key={c.id}
                  onClick={() => navigate(`/library/club/${c.id}`)}
                  className="cursor-pointer rounded-xl p-4 transition-colors"
                  style={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <div
                    className="text-sm font-medium"
                    style={{ color: "var(--ink)" }}
                  >
                    {c.book_title}
                  </div>
                  {c.book_author && (
                    <div
                      className="mt-0.5 text-xs"
                      style={{ color: "var(--ink-soft)" }}
                    >
                      {c.book_author} 著
                    </div>
                  )}
                  <p
                    className="mt-2 line-clamp-2 text-sm"
                    style={{ color: "var(--ink)" }}
                  >
                    {c.topic}
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-sm">{c.host_emoji}</span>
                    <span
                      className="text-xs"
                      style={{ color: "var(--ink-soft)" }}
                    >
                      {c.host_name} 主持
                    </span>
                    <span
                      className="text-[10px]"
                      style={{ color: "var(--ink-soft)" }}
                    >
                      · {c.reply_count} 則回覆 ·{" "}
                      {new Date(c.created_at).toLocaleDateString("zh-TW")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <FootprintSection space="library" />
    </main>
  );
}
