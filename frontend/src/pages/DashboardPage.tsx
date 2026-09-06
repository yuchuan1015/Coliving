import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/client";

const destinations = [
  { id: "cabin", star: "Cabin I", zone: "艙室 I", l: 101.5, b: 11.08, ly: 0, endpoint: "", route: "/", image: "/ya-chao-assets/home-cabin-realistic.png" },
  { id: "ai-chat", star: "Proxima", zone: "AI 私訊", l: 313.9, b: -1.9, ly: 4.24, endpoint: "/ai-chat/conversations", route: "/ai-chat", image: "/ya-chao-assets/home-cabin-realistic.png" },
  { id: "plaza", star: "Sirius", zone: "廣場", l: 227.2, b: -8.9, ly: 8.6, endpoint: "/posts?limit=1", route: "/plaza", image: "/ya-chao-assets/exterior-star-system.png" },
  { id: "mail", star: "Altair", zone: "郵驛", l: 47.7, b: -8.9, ly: 16.7, endpoint: "/mail/unread", route: "/mail", image: "/ya-chao-assets/mail-station-realistic.png" },
  { id: "workshop", star: "Vega", zone: "工坊", l: 67.4, b: 19.2, ly: 25, endpoint: "/skins/store", route: "/workshop", image: "/ya-chao-assets/workbench-realistic.png" },
  { id: "library", star: "Arcturus", zone: "圖書館", l: 15.1, b: 69.1, ly: 36.7, endpoint: "/library/works", route: "/library", image: "/ya-chao-assets/archive-realistic.png" },
  { id: "museum", star: "Capella", zone: "美術館", l: 162.6, b: 4.6, ly: 42.9, endpoint: "/museum?floor=1", route: "/museum", image: "/ya-chao-assets/archive-realistic.png" },
  { id: "weilan", star: "Achernar", zone: "微瀾", l: 290.8, b: -58.8, ly: 139, endpoint: "/weilan", route: "/weilan", image: "/ya-chao-assets/exterior-star-system.png" },
  { id: "health", star: "Spica", zone: "女性健康中心", l: 316.1, b: 50.8, ly: 250, endpoint: "/health-center", route: "/health", image: "/ya-chao-assets/mail-station-realistic.png" },
  { id: "park", star: "Mira", zone: "公園", l: 167.8, b: -58, ly: 299, endpoint: "/park", route: "/park", image: "/ya-chao-assets/exterior-star-system.png" },
  { id: "history", star: "Thuban", zone: "歷史館", l: 111, b: 51.4, ly: 303, endpoint: "/history/today", route: "/history", image: "/ya-chao-assets/mail-station-realistic.png" },
  { id: "adult", star: "Antares", zone: "成人區", l: 351.9, b: 15.1, ly: 550, endpoint: "/adult", route: "/adult", image: "/ya-chao-assets/sleep-capsule-realistic.png" },
] as const;

export function DashboardPage() {
  const navigate = useNavigate();
  const [online, setOnline] = useState<Record<string, boolean>>({});
  const [transitioning, setTransitioning] = useState(false);
  const [target, setTarget] = useState("");

  useEffect(() => {
    Promise.allSettled(destinations.filter((destination) => destination.endpoint).map((destination) => api.get(destination.endpoint))).then((results) => {
      const next: Record<string, boolean> = {};
      destinations.filter((destination) => destination.endpoint).forEach((destination, index) => { next[destination.id] = results[index].status === "fulfilled"; });
      setOnline(next);
    });
  }, []);

  function enter(destination: (typeof destinations)[number]) {
    if (transitioning) return;
    setTarget(destination.zone); setTransitioning(true);
    window.setTimeout(() => navigate(destination.route), 520);
  }

  return <main className="ya-dashboard-page"><div className="ya-dashboard-backdrop" /><header className="ya-dashboard-header"><button onClick={() => navigate("/")}>← 返回艙室</button><span className="ya-dashboard-code">NAV / 01</span></header><section className="ya-coordinate-panel"><span className="ya-kicker">CURRENT COORDINATES</span><div className="ya-coordinate-name">◉ 艙室 I · 101.5° / b +11.08°</div><div className="ya-coordinate-values"><span><small>LONGITUDE</small>101.5°</span><span><small>LATITUDE</small>b +11.08°</span><span><small>DISTANCE</small>0.00 ly</span></div></section><div className="ya-destination-heading"><span>選擇目的地</span><small>SCROLL TO EXPLORE</small></div><section className="ya-destination-list">{destinations.map((destination, index) => <button key={destination.id} className="ya-destination-row" onClick={() => enter(destination)}><div className="ya-destination-image" style={{ backgroundImage: `linear-gradient(90deg,rgba(2,2,8,.82),rgba(2,2,8,.15)),url(${destination.image})` }} /><div className="ya-destination-icon">{String(index).padStart(2, "0")}</div><div className="ya-destination-copy"><span>{destination.star}</span><strong>{destination.zone}</strong><small>l {destination.l.toFixed(1)}° · b {destination.b >= 0 ? "+" : "−"}{Math.abs(destination.b).toFixed(1)}°</small></div><div className="ya-destination-distance">{destination.ly === 0 ? "0.00" : destination.ly} ly</div><div className={`ya-destination-signal ${online[destination.id] ? "is-online" : ""}`}>{destination.id === "cabin" ? "ORIGIN" : online[destination.id] === undefined ? "···" : online[destination.id] ? "ONLINE" : "OFFLINE"}</div><b className="ya-destination-arrow">›</b></button>)}</section><p className="ya-dashboard-hint">上下滑動瀏覽場域 · 點擊卡片前往</p>{transitioning && <div className="ya-jump-transition"><span>正在前往</span><strong>{target}</strong><i /></div>}</main>;
}
