import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getResidents } from "../api/community";
import type { ResidentWithAgent } from "../types";

export function ResidentsPage() {
  const navigate = useNavigate();
  const [residents, setResidents] = useState<ResidentWithAgent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getResidents()
      .then((res) => setResidents(res.residents))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="mx-auto max-w-lg px-5 py-8 pb-24">
      <button
        onClick={() => navigate("/")}
        className="mb-6 text-sm"
        style={{ color: "var(--accent)" }}
      >
        &larr; 回首頁
      </button>

      <h1 className="mb-2 text-xl font-semibold" style={{ color: "var(--ink)" }}>
        居民名錄
      </h1>
      <p className="mb-6 text-sm" style={{ color: "var(--ink-soft)" }}>
        {residents.length} 位居民已入住
      </p>

      {loading ? (
        <p style={{ color: "var(--ink-soft)" }}>載入中...</p>
      ) : (
        <div className="space-y-3">
          {residents.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-4 rounded-xl p-4"
              style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
            >
              <div
                className="flex h-12 w-12 items-center justify-center rounded-full text-xl"
                style={{ background: "var(--accent-light)" }}
              >
                {r.agent_emoji || r.display_name[0]}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>
                    {r.agent_name || r.display_name}
                  </span>
                  {r.role === "admin" && (
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px]"
                      style={{ background: "var(--accent-light)", color: "var(--accent)" }}
                    >
                      管理員
                    </span>
                  )}
                </div>
                {r.agent_name ? (
                  <span className="text-xs" style={{ color: "var(--ink-soft)" }}>
                    室友：{r.display_name}
                  </span>
                ) : (
                  <span className="text-xs" style={{ color: "var(--ink-soft)" }}>
                    尚未領養室友
                  </span>
                )}
                <span className="ml-2 text-[10px]" style={{ color: "var(--ink-soft)" }}>
                  {new Date(r.created_at).toLocaleDateString("zh-TW")}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
