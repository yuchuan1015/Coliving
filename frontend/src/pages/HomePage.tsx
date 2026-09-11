import { uiText, getUiLanguage } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getDashboard } from "../api/auth";
import { getAnnouncements } from "../api/community";
import { getFurniture, weatherIcon, type FurnitureSummary } from "../api/furniture";
import { useAuth } from "../hooks/useAuth";
import { cabinZones, coverPoint, type CabinFurniture, type CabinPanel } from "../data/cabin";
import { CabinPanelDialog } from "../components/CabinPanelDialog";
import { AgentStatusNote } from "../components/AgentStatusNote";
import { AvatarContent } from "../components/AvatarContent";
import { PhotoImage } from "../components/PhotoImage";
import { CabinPhotoFrame } from "../components/CabinPhotoFrame";
import { CabinClockFace } from "../components/CabinClockFace";
import { clockDialSize } from "../data/cabin-clock";
import { useCabinTime } from "../hooks/useCabinTime";
import { getMyAgent } from "../api/agents";
import type { AnnouncementOut, DashboardData } from "../types";
import "../cabin-home.css";

function initialZone() {
  const value = Number(sessionStorage.getItem("cabin-zone") ?? 0);
  return Number.isInteger(value) && value >= 0 && value < cabinZones.length ? value : 0;
}

export function HomePage() {
  useUiLanguage();
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
  const now = useCabinTime();
  const sceneRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const [sceneSize, setSceneSize] = useState({ width: 1, height: 1 });
  const [imageSizes, setImageSizes] = useState<Record<string, { width: number; height: number }>>({});
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const zone = cabinZones[zoneIndex];
  const agent = dashboard?.agents?.[0];
  const timezone = user?.timezone ?? summary?.clock.timezone;
  const time = new Intl.DateTimeFormat(getUiLanguage(), { hour: "2-digit", minute: "2-digit", timeZone: timezone }).format(now);
  const weatherRequest = useRef(0);
  const refreshWeather = useCallback(async () => {
    const request = ++weatherRequest.current;
    setSummary(null);
    const data = await getFurniture();
    if (request === weatherRequest.current) setSummary(data);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getDashboard().then(async data => {
      // The dashboard may lag the new avatar field; mine is the editor's source of truth.
      const current = data.agents.length ? await getMyAgent().catch(() => null) : null;
      if (!cancelled) setDashboard(current ? { ...data, agents: [current, ...data.agents.filter(item => item.id !== current.id)] } : data);
    }).catch(() => { if (!cancelled) setError(true); });
    let pendingSummary: Promise<void> | null = null;
    const syncSummary = () => {
      if (cancelled || document.hidden || pendingSummary) return;
      const request = ++weatherRequest.current;
      pendingSummary = getFurniture().then(data => {
        if (!cancelled && request === weatherRequest.current) setSummary(data);
      }).catch(() => {}).finally(() => { pendingSummary = null; });
    };
    syncSummary();
    // Restore from another tab / Safari page cache without polling the API.
    document.addEventListener("visibilitychange", syncSummary);
    window.addEventListener("focus", syncSummary);
    window.addEventListener("pageshow", syncSummary);
    getAnnouncements().then(items => {
      if (!cancelled) setAnnouncement([...items].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0] ?? null);
    }).catch(() => {});
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", syncSummary);
      window.removeEventListener("focus", syncSummary);
      window.removeEventListener("pageshow", syncSummary);
    };
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
  const dialSize = clockDialSize(sceneSize, size);
  const point = (item: CabinFurniture) => coverPoint(item.x, item.y, sceneSize.width, sceneSize.height, size.width, size.height, positionY);
  const selectedPoint = selected ? point(selected) : null;
  const calloutWidth = Math.min(176, sceneSize.width - 32);
  const calloutX = selectedPoint ? Math.max(16, Math.min(sceneSize.width - calloutWidth - 16, selectedPoint.x < sceneSize.width / 2 ? selectedPoint.x + 32 : selectedPoint.x - calloutWidth - 32)) : 0;
  const calloutY = selectedPoint ? Math.max(16, Math.min(sceneSize.height - 200, selectedPoint.y + 32)) : 0;
  const calloutEndX = selectedPoint && selectedPoint.x < sceneSize.width / 2 ? calloutX : calloutX + calloutWidth;

  return <main className="cabin-home" aria-label={uiText("艙室")}>
    <section className="cabin-card cabin-info" aria-label={uiText("時間、天氣與公告")}>
      <div className="cabin-info-row">
        <time className="cabin-time" dateTime={now.toISOString()}>{time}</time>
        <button className="cabin-weather" onClick={() => setPanel("window")} aria-label={uiText("查看天氣")}>
          <span aria-hidden="true">{weatherIcon(summary?.weather)}</span><span>{summary?.weather?.description ? uiText(summary.weather.description) : uiText("天氣待同步")}</span>
          {summary?.weather && <small>{summary.weather.temperature}°C</small>}
        </button>
      </div>
      <div className="cabin-announcement"><span>{uiText("系統公告")}</span><p title={announcement?.title}>{announcement?.title ?? dashboard?.community_status.message ?? (error ? uiText("連線暫時中斷，請稍後重新整理") : uiText("正在同步共居訊息…"))}</p></div>
    </section>

    <section className="cabin-card cabin-room" aria-label={uiText(zone.label)}>
      <div ref={sceneRef} className="cabin-scene">
        {cabinZones.map((item, index) => <img key={item.id} className={`cabin-photo${index === zoneIndex ? " is-current" : ""}`} style={{ objectPosition: `50% ${positionY * 100}%` }} src={item.image} alt={index === zoneIndex ? uiText`${uiText(item.label)}的寫實太空艙內部` : ""} aria-hidden={index !== zoneIndex} draggable={false}
          onLoad={event => { const img = event.currentTarget; setImageSizes(sizes => ({ ...sizes, [item.id]: { width: img.naturalWidth, height: img.naturalHeight } })); }}
          onError={() => setFailedImages(previous => previous.includes(item.id) ? previous : [...previous, item.id])} />)}
        <CabinPhotoFrame active={zone.id === "memory" && !failedImages.includes("memory")}
          photo={summary?.photo_frame?.photo} sceneSize={sceneSize}
          imageSize={imageSizes.memory ?? { width: 1053, height: 1494 }} positionY={positionY} />
        {failedImages.includes(zone.id) && <p className="cabin-image-error">{uiText("艙室圖片暫時無法載入，家具入口仍可使用。")}</p>}
        {zone.furniture.map(item => {
          const position = point(item);
          return <button key={item.id} className={`cabin-hotspot${item.id === "clock" ? " cabin-clock-hotspot" : ""}${selected?.id === item.id ? " is-selected" : ""}`} style={{ left: position.x, top: position.y }} onClick={() => { setSelected(selected?.id === item.id ? null : item); setFabOpen(false); }} aria-label={uiText`查看${uiText(item.label)}`} aria-expanded={selected?.id === item.id} aria-controls={selected?.id === item.id ? "cabin-callout" : undefined}>
            {item.id === "clock" ? <CabinClockFace now={now} timeZone={timezone} {...dialSize} /> : <span />}
          </button>;
        })}
        {selected && selectedPoint && <>
          <svg className="cabin-leader" width="100%" height="100%" aria-hidden="true"><path d={`M ${selectedPoint.x} ${selectedPoint.y} L ${calloutEndX + (calloutEndX === calloutX ? -12 : 12)} ${calloutY + 40} H ${calloutEndX}`} /></svg>
          <div id="cabin-callout" className="cabin-callout" style={{ left: calloutX, top: calloutY, width: calloutWidth }}>
            <button className="cabin-callout-close" aria-label={uiText("收起家具卡片")} onClick={() => { document.querySelector<HTMLButtonElement>(".cabin-hotspot.is-selected")?.focus(); setSelected(null); }}>×</button>
            <strong>{uiText(selected.label)}</strong>
            {selected.id === "photos" ? <>
              {summary?.photo_frame.photo && <div className="cabin-frame-preview"><PhotoImage src={summary.photo_frame.photo.url} alt={summary.photo_frame.photo.caption || uiText("目前擺在相框裡的照片")} /></div>}
              <p>{typeof summary?.photo_frame.photo_count === "number" ? uiText`已收藏 ${summary.photo_frame.photo_count} 張 · ${summary.photo_frame.photo ? "展示中" : "相框空著"}` : uiText("照片待同步")}</p>
            </> : <p>{uiText(selected.detail)}</p>}
            <button className="cabin-enter" onClick={() => openFurniture(selected)}>{selected.id === "photos" ? uiText("開啟相簿 ›") : uiText("進入 ›")}</button>
          </div>
        </>}
        <div className="cabin-zone-slider">
          <div className="cabin-slider-track" aria-hidden="true">{cabinZones.map((item, index) => <span key={item.id} className={index === zoneIndex ? "is-current" : ""} />)}</div>
          <input type="range" min="0" max="2" step="1" value={zoneIndex} onChange={event => changeZone(Number(event.target.value))} aria-label={uiText("切換艙室區域")} aria-valuetext={uiText(zone.label)} />
        </div>
      </div>
      <span className="cabin-sr-only" aria-live="polite">{uiText(zone.label)}，{zone.furniture.length}{uiText(" 個家具入口")}</span>
    </section>

    <section className="cabin-card cabin-agent" aria-label={uiText("Agent 個人名牌")}>
      <div className="cabin-agent-info">
        <span className="cabin-avatar" aria-hidden="true"><AvatarContent url={agent?.avatar_url} emoji={agent?.avatar_emoji ?? "◌"} name={agent?.name ?? "室友"} /></span>
        <span className="cabin-agent-copy"><strong>{agent?.name ?? (error ? uiText("室友資料未同步") : uiText("尚未連結 Agent"))}</strong><small><span aria-hidden="true">•</span> {agent?.status ?? uiText("等待連結")}</small><AgentStatusNote note={agent?.status_note} /></span>
      </div>
      <div className="cabin-fab-wrap">
        {fabOpen && <nav className="cabin-fab-menu" id="cabin-fab-menu" aria-label={uiText("艙室快捷選單")}>
          <button onClick={() => navigate("/outside")}>{uiText("出艙 ↗")}</button>
          <button onClick={() => navigate(agent ? `/chat/${agent.id}` : "/adopt")}>{uiText("聊天")}</button>
          <button onClick={() => navigate("/schedules")}>{uiText("排程管理")}</button>
          <button onClick={() => { closeFab(); navigate("/home/garden"); }}>{uiText("私人菜園")}</button>
          <button onClick={() => { closeFab(); navigate("/guide"); }}>{uiText("導覽手冊")}</button>
          <button onClick={() => { closeFab(); setPanel("settings"); }}>{uiText("設定")}</button>
        </nav>}
        <button ref={fabRef} className={`cabin-fab${fabOpen ? " is-open" : ""}`} aria-label={fabOpen ? uiText("收起快捷選單") : uiText("展開快捷選單")} aria-expanded={fabOpen} aria-controls="cabin-fab-menu" onClick={() => setFabOpen(!fabOpen)}><span aria-hidden="true">+</span></button>
      </div>
    </section>
    {fabOpen && <button className="cabin-menu-dismiss" onClick={closeFab} aria-label={uiText("關閉快捷選單")} tabIndex={-1} />}
    {panel && <CabinPanelDialog panel={panel} summary={summary} now={now} onRefreshWeather={refreshWeather} onClose={() => setPanel(null)} />}
  </main>;
}
