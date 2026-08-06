import { useEffect, useState } from "react";
import { getDashboard } from "../api/auth";
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
  const { user, logout } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem("coliving_theme");
    if (saved) return saved === "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    localStorage.setItem("coliving_theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    getDashboard().then(setData).catch(console.error);
  }, []);

  return (
    <div className="min-h-dvh" style={{ background: "var(--bg)" }}>
      {/* Header */}
      <header
        className="sticky top-0 z-10 flex items-center justify-between px-5 py-3"
        style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}
      >
        <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>
          共居社區
        </span>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setDark(!dark)}
            className="rounded-md px-2 py-1 text-xs"
            style={{ background: "var(--surface-dim)", color: "var(--ink-soft)" }}
          >
            {dark ? "☀" : "☾"}
          </button>
          <button
            onClick={logout}
            className="rounded-md px-2 py-1 text-xs"
            style={{ background: "var(--surface-dim)", color: "var(--ink-soft)" }}
          >
            登出
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-lg px-5 py-8">
        {/* Welcome */}
        <section className="mb-8">
          <h1 className="text-xl font-semibold" style={{ color: "var(--ink)" }}>
            {getGreeting()}，{user?.display_name}
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--ink-soft)" }}>
            {data?.community_status.message || "載入中..."}
          </p>
        </section>

        {/* Agent placeholder */}
        <section
          className="mb-6 rounded-xl p-5"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        >
          <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full text-2xl" style={{ background: "var(--accent-light)" }}>
            ?
          </div>
          <h2 className="text-base font-medium" style={{ color: "var(--ink)" }}>
            {data?.agent_placeholder.message || "你還沒有 AI 室友"}
          </h2>
          <p className="mt-1 text-sm" style={{ color: "var(--ink-soft)" }}>
            {data?.agent_placeholder.hint || "之後可以領養一位室友陪你"}
          </p>
          <button
            disabled
            className="mt-4 rounded-lg px-4 py-2 text-xs font-medium opacity-40"
            style={{ background: "var(--accent-light)", color: "var(--accent)" }}
          >
            領養室友（即將開放）
          </button>
        </section>

        {/* Spaces */}
        <section className="mb-6">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider" style={{ color: "var(--ink-soft)" }}>
            社區空間
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {(data?.spaces || []).map((space) => (
              <div
                key={space.id}
                className="rounded-lg p-4 opacity-50"
                style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
              >
                <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>
                  {space.name}
                </span>
                <span
                  className="mt-1 block text-[10px]"
                  style={{ color: "var(--ink-soft)" }}
                >
                  即將開放
                </span>
              </div>
            ))}
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

      {/* Mobile bottom nav */}
      <nav
        className="fixed bottom-0 left-0 right-0 flex justify-around py-2 md:hidden"
        style={{ background: "var(--surface)", borderTop: "1px solid var(--border)" }}
      >
        <NavItem label="我的家" active />
        <NavItem label="廣場" />
        <NavItem label="圖書館" />
        <NavItem label="設定" />
      </nav>
    </div>
  );
}

function NavItem({ label, active = false }: { label: string; active?: boolean }) {
  return (
    <button
      disabled={!active}
      className="flex flex-col items-center gap-0.5 px-3 py-1 text-[10px]"
      style={{
        color: active ? "var(--accent)" : "var(--ink-soft)",
        opacity: active ? 1 : 0.4,
      }}
    >
      <span className="text-base">{active ? "●" : "○"}</span>
      {label}
    </button>
  );
}
