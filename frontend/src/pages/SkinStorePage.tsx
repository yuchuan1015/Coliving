import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { applySkin, getStoreSkins, type StoreSkinOut } from "../api/skins";

export function SkinStorePage() {
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
        <p style={{ color: "var(--ink-soft)" }}>載入中...</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg px-5 py-8 pb-24">
      <button
        onClick={() => navigate(-1)}
        className="mb-6 text-sm"
        style={{ color: "var(--accent)" }}
      >
        &larr; 返回
      </button>

      <h1 className="mb-2 text-xl font-semibold" style={{ color: "var(--ink)" }}>
        皮膚庫
      </h1>
      <p className="mb-6 text-sm" style={{ color: "var(--ink-soft)" }}>
        瀏覽社區居民分享的房間皮膚，一鍵套用。
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
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        >
          <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
            還沒有人分享皮膚
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {skins.map((s) => (
            <div
              key={s.id}
              className="rounded-xl p-4"
              style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium" style={{ color: "var(--ink)" }}>
                    {s.name}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className="text-sm">{s.author_emoji}</span>
                    <span className="text-xs" style={{ color: "var(--ink-soft)" }}>
                      {s.author_name}
                    </span>
                    <span className="text-[10px]" style={{ color: "var(--ink-soft)" }}>
                      · {new Date(s.created_at).toLocaleDateString("zh-TW")}
                    </span>
                  </div>
                </div>
                <div className="ml-3 flex gap-2">
                  <button
                    onClick={() => window.open(`/api/skins/preview/${s.id}`, "_blank")}
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
    </main>
  );
}
