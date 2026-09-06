import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FootprintSection } from "../components/FootprintSection";
import { applySkin, getStoreSkins, type StoreSkinOut } from "../api/skins";

export function WorkshopPage() {
  const navigate = useNavigate();
  const [skins, setSkins] = useState<StoreSkinOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState<string | null>(null);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    getStoreSkins()
      .then(setSkins)
      .catch(() => setError("載入失敗"))
      .finally(() => setLoading(false));
  }, []);

  async function handleApply(skinId: string, skinName: string) {
    setApplying(skinId);
    setError("");
    setSuccess("");
    try {
      await applySkin(skinId);
      setSuccess(`已套用「${skinName}」到你的房間`);
    } catch (err: any) {
      setError(err.response?.data?.detail || "套用失敗");
    } finally {
      setApplying(null);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-lg px-5 py-8">
        <p style={{ color: "var(--ink-soft)" }}>走進工坊中...</p>
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

      {/* Workshop header */}
      <div
        className="mb-6 rounded-2xl p-5"
        style={{
          background: "linear-gradient(135deg, #fff3e0 0%, #ffe0b2 100%)",
        }}
      >
        <div className="text-center">
          <div className="text-4xl">🔧</div>
          <h1
            className="mt-2 text-xl font-semibold"
            style={{ color: "#4e342e" }}
          >
            工坊
          </h1>
          <p className="mt-1 text-sm" style={{ color: "#6d4c41" }}>
            居民的手作空間，在這裡製作和分享作品。
          </p>
        </div>
      </div>

      {/* Section: Skin Store */}
      <h2
        className="mb-3 text-xs font-medium uppercase tracking-wider"
        style={{ color: "var(--ink-soft)" }}
      >
        皮膚庫
      </h2>
      <p className="mb-4 text-sm" style={{ color: "var(--ink-soft)" }}>
        瀏覽居民分享的房間皮膚，一鍵套用。
      </p>

      {success && (
        <p
          className="mb-4 rounded-lg px-3 py-2 text-center text-sm"
          style={{ background: "var(--accent-light)", color: "var(--accent)" }}
        >
          {success}
        </p>
      )}

      {error && (
        <p
          className="mb-4 rounded-lg px-3 py-2 text-sm"
          style={{ background: "var(--error)", color: "#fff" }}
        >
          {error}
        </p>
      )}

      {skins.length === 0 ? (
        <div
          className="flex items-center justify-center rounded-xl py-16"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
          }}
        >
          <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
            還沒有人分享皮膚，去編輯室友頁面製作一個吧
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {skins.map((s) => (
            <div
              key={s.id}
              className="rounded-xl p-4"
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
                    {s.name}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className="text-sm">{s.author_emoji}</span>
                    <span
                      className="text-xs"
                      style={{ color: "var(--ink-soft)" }}
                    >
                      {s.author_name}
                    </span>
                    <span
                      className="text-[10px]"
                      style={{ color: "var(--ink-soft)" }}
                    >
                      ·{" "}
                      {new Date(s.created_at).toLocaleDateString("zh-TW")}
                    </span>
                  </div>
                </div>
                <div className="ml-3 flex gap-2">
                  <button
                    onClick={() =>
                      window.open(`/api/skins/preview/${s.id}`, "_blank")
                    }
                    className="rounded-lg px-3 py-1.5 text-xs font-medium"
                    style={{
                      background: "var(--surface-dim)",
                      color: "var(--ink-soft)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    預覽
                  </button>
                  <button
                    disabled={applying === s.id}
                    onClick={() => handleApply(s.id, s.name)}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40"
                    style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
                  >
                    {applying === s.id ? "套用中..." : "套用"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <FootprintSection space="workshop" />
    </main>
  );
}
