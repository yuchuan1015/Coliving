import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getDashboard } from "../api/auth";
import { getAnnouncements } from "../api/community";
import { getFurniture, type FurnitureSummary } from "../api/furniture";
import { useAuth } from "../hooks/useAuth";
import { cabinZones, coverPoint, type CabinFurniture, type CabinPanel } from "../data/cabin";
import { CabinPanelDialog } from "../components/CabinPanelDialog";
import type { AnnouncementOut, DashboardData } from "../types";
import "../cabin-home.css";

function initialZone() {
  const value = Number(sessionStorage.getItem("cabin-zone") ?? 0);
  return Number.isInteger(value) && value >= 0 && value < cabinZones.length ? value : 0;
}

export function HomePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [summary, setSummary] = useState<FurnitureSummary | null>(null);
  const [announcement, setAnnouncement] = useState<AnnouncementOut | null>(null);
  const [error, setError] = useState(false);
  const [zoneIndex, setZoneIndex] = useState(initialZone);
  const [selected, setSelected] = useState<CabinFurniture | null>(null);
  const [panel, setPanel] = useState<CabinPanel | null>(null);
  const [fabOpen, setFabOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const sceneRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const [sceneSize, setSceneSize] = useState({ width: 1, height: 1 });
  const [imageSizes, setImageSizes] = useState<Record<string, { width: number; height: number }>>({});
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const zone = cabinZones[zoneIndex];
  const agent = dashboard?.agents?.[0];
  const timezone = user?.timezone ?? summary?.clock.timezone;
  const time = new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit", timeZone: timezone }).format(now);

  useEffect(() => {
    let cancelled = false;
    getDashboard().then(data => { if (!cancelled) setDashboard(data); }).catch(() => { if (!cancelled) setError(true); });
    getFurniture().then(data => { if (!cancelled) setSummary(data); }).catch(() => {});
    getAnnouncements().then(items => {
      if (!cancelled) setAnnouncement([...items].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0] ?? null);
    }).catch(() => {});
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const observer = new ResizeObserver(([entry]) => setSceneSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(scene);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    function close(event: KeyboardEvent) {
      if (event.key !== "Escape" || panel) return;
      if (fabOpen) { setFabOpen(false); fabRef.current?.focus(); }
      else setSelected(null);
    }
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [fabOpen, panel]);

  function changeZone(index: number) {
    setZoneIndex(index);
    sessionStorage.setItem("cabin-zone", String(index));
    setSelected(null);
    setFabOpen(false);
  }
  function openFurniture(item: CabinFurniture) {
    if (item.path) navigate(item.path);
    else if (item.panel) setPanel(item.panel);
  }
  function closeFab() { setFabOpen(false); fabRef.current?.focus(); }
  const size = imageSizes[zone.id] ?? { width: 792, height: 1124 };
  // On short screens reveal more floor/furniture and less ceiling, with the same crop for hotspots.
  const positionY = sceneSize.width / sceneSize.height > .9 ? .8 : .5;
  const point = (item: CabinFurniture) => coverPoint(item.x, item.y, sceneSize.width, sceneSize.height, size.width, size.height, positionY);
  const selectedPoint = selected ? point(selected) : null;
  const calloutWidth = Math.min(176, sceneSize.width - 32);
  const calloutX = selectedPoint ? Math.max(16, Math.min(sceneSize.width - calloutWidth - 16, selectedPoint.x < sceneSize.width / 2 ? selectedPoint.x + 32 : selectedPoint.x - calloutWidth - 32)) : 0;
  const calloutY = selectedPoint ? Math.max(16, Math.min(sceneSize.height - 200, selectedPoint.y + 32)) : 0;
  const calloutEndX = selectedPoint && selectedPoint.x < sceneSize.width / 2 ? calloutX : calloutX + calloutWidth;

  return <main className="cabin-home" aria-label="艙室">
    <section className="cabin-card cabin-info" aria-label="時間、天氣與公告">
      <div className="cabin-info-row">
        <time className="cabin-time" dateTime={now.toISOString()}>{time}</time>
        <button className="cabin-weather" onClick={() => setPanel("window")} aria-label="查看天氣">
          <span aria-hidden="true">☼</span><span>{summary?.weather?.description ?? "天氣待同步"}</span>
          {summary?.weather && <small>{summary.weather.temperature}°C</small>}
        </button>
      </div>
      <div className="cabin-announcement"><span>系統公告</span><p title={announcement?.title}>{announcement?.title ?? dashboard?.community_status.message ?? (error ? "連線暫時中斷，請稍後重新整理" : "正在同步共居訊息…")}</p></div>
    </section>

    <section className="cabin-card cabin-room" aria-label={zone.label}>
      <div ref={sceneRef} className="cabin-scene">
        {cabinZones.map((item, index) => <img key={item.id} className={`cabin-photo${index === zoneIndex ? " is-current" : ""}`} style={{ objectPosition: `50% ${positionY * 100}%` }} src={item.image} alt={index === zoneIndex ? `${item.label}的寫實太空艙內部` : ""} aria-hidden={index !== zoneIndex} draggable={false}
          onLoad={event => { const img = event.currentTarget; setImageSizes(sizes => ({ ...sizes, [item.id]: { width: img.naturalWidth, height: img.naturalHeight } })); }}
          onError={() => setFailedImages(previous => previous.includes(item.id) ? previous : [...previous, item.id])} />)}
        {failedImages.includes(zone.id) && <p className="cabin-image-error">艙室圖片暫時無法載入，家具入口仍可使用。</p>}
        {zone.furniture.map(item => {
          const position = point(item);
          return <button key={item.id} className={`cabin-hotspot${selected?.id === item.id ? " is-selected" : ""}`} style={{ left: position.x, top: position.y }} onClick={() => { setSelected(selected?.id === item.id ? null : item); setFabOpen(false); }} aria-label={`查看${item.label}`} aria-expanded={selected?.id === item.id} aria-controls={selected?.id === item.id ? "cabin-callout" : undefined}><span /></button>;
        })}
        {selected && selectedPoint && <>
          <svg className="cabin-leader" width="100%" height="100%" aria-hidden="true"><path d={`M ${selectedPoint.x} ${selectedPoint.y} L ${calloutEndX + (calloutEndX === calloutX ? -12 : 12)} ${calloutY + 40} H ${calloutEndX}`} /></svg>
          <div id="cabin-callout" className="cabin-callout" style={{ left: calloutX, top: calloutY, width: calloutWidth }}>
            <button className="cabin-callout-close" aria-label="收起家具卡片" onClick={() => { document.querySelector<HTMLButtonElement>(".cabin-hotspot.is-selected")?.focus(); setSelected(null); }}>×</button>
            <strong>{selected.label}</strong><p>{selected.detail}</p><button className="cabin-enter" onClick={() => openFurniture(selected)}>進入 ›</button>
          </div>
        </>}
        <div className="cabin-zone-slider">
          <div className="cabin-slider-track" aria-hidden="true">{cabinZones.map((item, index) => <span key={item.id} className={index === zoneIndex ? "is-current" : ""} />)}</div>
          <input type="range" min="0" max="2" step="1" value={zoneIndex} onChange={event => changeZone(Number(event.target.value))} aria-label="切換艙室區域" aria-valuetext={zone.label} />
        </div>
      </div>
      <span className="cabin-sr-only" aria-live="polite">{zone.label}，{zone.furniture.length} 個家具入口</span>
    </section>

    <section className="cabin-card cabin-agent" aria-label="Agent 個人名牌">
      <button className="cabin-agent-link" onClick={() => navigate(agent ? "/agent/edit" : "/adopt")} aria-label={agent ? `編輯${agent.name}的資料` : "領養室友"}>
        <span className="cabin-avatar" aria-hidden="true">{agent?.avatar_emoji ?? "◌"}</span>
        <span className="cabin-agent-copy"><strong>{agent?.name ?? (error ? "室友資料未同步" : "尚未連結 Agent")}</strong><small><span aria-hidden="true">•</span> {agent?.status ?? "等待連結"}</small></span>
      </button>
      <div className="cabin-fab-wrap">
        {fabOpen && <nav className="cabin-fab-menu" id="cabin-fab-menu" aria-label="艙室快捷選單">
          <button onClick={() => navigate("/outside")}>出艙 ↗</button>
          <button onClick={() => navigate(agent ? `/chat/${agent.id}` : "/adopt")}>聊天</button>
          <button onClick={() => navigate("/schedules")}>排程管理</button>
          <button onClick={() => { closeFab(); setPanel("settings"); }}>設定</button>
        </nav>}
        <button ref={fabRef} className={`cabin-fab${fabOpen ? " is-open" : ""}`} aria-label={fabOpen ? "收起快捷選單" : "展開快捷選單"} aria-expanded={fabOpen} aria-controls="cabin-fab-menu" onClick={() => setFabOpen(!fabOpen)}><span aria-hidden="true">+</span></button>
      </div>
    </section>
    {fabOpen && <button className="cabin-menu-dismiss" onClick={closeFab} aria-label="關閉快捷選單" tabIndex={-1} />}
    {panel && <CabinPanelDialog panel={panel} summary={summary} now={now} onClose={() => setPanel(null)} />}
  </main>;
}
