import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getDashboard } from "../api/auth";
import { getAnnouncements } from "../api/community";
import { useAuth } from "../hooks/useAuth";
import type { AnnouncementOut, DashboardData } from "../types";

type FurnitureId = "sleep" | "library" | "mail" | "console";

const furniture = [
  { id: "sleep" as FurnitureId, label: "睡眠艙", detail: "休息、夢境與夜間狀態", position: "anchor-sleep" },
  { id: "library" as FurnitureId, label: "記憶書架", detail: "收藏與共居知識", position: "anchor-library" },
  { id: "mail" as FurnitureId, label: "星際信箱", detail: "收取來自其他居民的訊息", position: "anchor-mail" },
  { id: "console" as FurnitureId, label: "工作台", detail: "工具、任務與家具入口", position: "anchor-console" },
];

function greeting() {
  const hour = new Date().getHours();
  if (hour < 6) return "夜深了";
  if (hour < 12) return "早安";
  if (hour < 18) return "午安";
  return "晚安";
}

function clock() {
  return new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit" }).format(new Date());
}

export function HomePage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [announcement, setAnnouncement] = useState<AnnouncementOut | null>(null);
  const [selected, setSelected] = useState<FurnitureId | null>(null);
  const [now, setNow] = useState(clock);

  useEffect(() => {
    getDashboard().then(setDashboard).catch(console.error);
    getAnnouncements()
      .then((items) => setAnnouncement(items[0] ?? null))
      .catch(console.error);
    const timer = window.setInterval(() => setNow(clock()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const agent = dashboard?.agents?.[0];
  const selectedFurniture = useMemo(() => furniture.find((item) => item.id === selected), [selected]);

  return (
    <main className="ya-home-shell">
      <section className="ya-card ya-top-card">
        <div className="ya-brand"><span className="ya-brand-mark">✦</span><span>鴉巢</span><button className="ya-logout" onClick={logout}>登出</button></div>
        <div className="ya-time">{now}</div>
        <div className="ya-weather"><span>☼</span><span>深空晴朗</span><small> 18°C</small></div>
        <div className="ya-announcement">
          <span className="ya-kicker">系統公告</span>
          <span>{announcement?.title ?? dashboard?.community_status.message ?? "正在同步共居訊息…"}</span>
        </div>
      </section>

      <section className="ya-card ya-cabin-card">
        <div className="ya-cabin-heading">
          <div><span className="ya-kicker">MY HOME / 01</span><h1>{greeting()}，{user?.display_name ?? "居民"}</h1></div>
          <div className="ya-cabin-actions"><button className="ya-exit-button" onClick={() => navigate("/outside")}>出艙 ↗</button><span className="ya-live-dot">LIVE</span></div>
        </div>
        <div className="ya-cabin-scene">
          <div className="ya-scene-label">HOME CABIN</div>
          {furniture.map((item) => (
            <button key={item.id} className={`ya-anchor ${item.position}${selected === item.id ? " is-active" : ""}`} onClick={() => { setSelected(selected === item.id ? null : item.id); if (selected === item.id) navigate(`/home/${item.id}`); }} aria-label={`查看${item.label}`}>
              <span className="ya-anchor-dot" /><span className="ya-anchor-line" /><span className="ya-anchor-card"><strong>{item.label}</strong><small>{item.detail}</small></span>
            </button>
          ))}
          {selectedFurniture && <div className="ya-selection-note">已選取：{selectedFurniture.label} · 點擊錨點可收起</div>}
        </div>
        <div className="ya-cabin-footer"><span>{dashboard ? `${dashboard.resident_count} 位居民已入住` : "正在同步居民資料…"}</span><span>4 個家具入口</span></div>
      </section>

      <section className="ya-card ya-agent-card" onClick={() => navigate("/agent/edit")} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") navigate("/agent/edit"); }}>
        <div className="ya-agent-avatar">{agent?.avatar_emoji ?? "◌"}</div>
        <div className="ya-agent-copy"><span className="ya-kicker">YOUR AGENT</span><h2>{agent?.name ?? "尚未連結 Agent"}</h2><p>{agent ? `${agent.llm_provider} · ${agent.llm_model}` : "前往領養頁面建立你的居住夥伴"}</p></div>
        <span className="ya-agent-status">{agent?.status ?? "待命"}</span>
      </section>
    </main>
  );
}
