import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getDashboard } from "../api/auth";
import { AgentCard } from "../components/AgentCard";
import { useAuth } from "../hooks/useAuth";
import type { DashboardData } from "../types";

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 6) return "夜深了";
  if (h < 12) return "早安";
  if (h < 18) return "午安";
  return "晚安";
}

export function HomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    getDashboard().then(setData).catch(console.error);
  }, []);

  const agent = data?.agents?.[0] ?? null;

  return (
    <main className="mx-auto max-w-lg px-5 py-8 pb-24">
      {/* Welcome */}
      <section className="mb-8">
        <h1 className="text-xl font-semibold" style={{ color: "var(--ink)" }}>
          {getGreeting()}，{user?.display_name}
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--ink-soft)" }}>
          {data?.community_status.message || "載入中..."}
        </p>
      </section>

      {/* Agent section */}
      {agent ? (
        <AgentCard agent={agent} />
      ) : (
        <section
          className="mb-6 rounded-xl p-5"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        >
          <div
            className="mb-3 flex h-16 w-16 items-center justify-center rounded-full text-2xl"
            style={{ background: "var(--accent-light)" }}
          >
            ?
          </div>
          <h2 className="text-base font-medium" style={{ color: "var(--ink)" }}>
            {data?.agent_placeholder?.message || "你還沒有 AI 室友"}
          </h2>
          <p className="mt-1 text-sm" style={{ color: "var(--ink-soft)" }}>
            {data?.agent_placeholder?.hint || "領養一位室友陪你吧"}
          </p>
          <button
            onClick={() => navigate("/adopt")}
            className="mt-4 rounded-lg px-4 py-2 text-sm font-medium"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            領養室友
          </button>
        </section>
      )}

      {/* Spaces */}
      <section className="mb-6">
        <h3
          className="mb-3 text-xs font-medium uppercase tracking-wider"
          style={{ color: "var(--ink-soft)" }}
        >
          社區空間
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {(data?.spaces || []).map((space) => {
            const isOpen = space.status === "open";
            const route = isOpen ? `/${space.id}` : undefined;
            return (
              <div
                key={space.id}
                onClick={route ? () => navigate(route) : undefined}
                className={`rounded-lg p-4${isOpen ? " cursor-pointer" : " opacity-50"}`}
                style={{ background: "var(--surface)", border: `1px solid ${isOpen ? "var(--accent)" : "var(--border)"}` }}
              >
                <span className="text-sm font-medium" style={{ color: isOpen ? "var(--accent)" : "var(--ink)" }}>
                  {space.name}
                </span>
                <span className="mt-1 block text-[10px]" style={{ color: "var(--ink-soft)" }}>
                  {isOpen ? "開放中" : "即將開放"}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Resident count */}
      {data && (
        <section
          className="rounded-lg p-4 text-center text-sm"
          style={{ background: "var(--surface-dim)", color: "var(--ink-soft)" }}
        >
          目前 {data.resident_count} 位居民已入住
        </section>
      )}
    </main>
  );
}
