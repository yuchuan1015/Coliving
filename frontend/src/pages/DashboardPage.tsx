import { uiText } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { FIELDS } from "../fields/fieldData";
import { coordinateView } from "../coordinates";
import { Link } from "react-router-dom";

export function DashboardPage() {
  useUiLanguage();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [transitioning, setTransitioning] = useState(false);
  const [target, setTarget] = useState("");
  const timer = useRef<number | undefined>(undefined);
  const lock = useRef(false);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const coordinate = user?.coordinate;
  const view = coordinateView(user);
  const positioned = !user?.drifting && coordinate && [coordinate.l, coordinate.b, coordinate.r].every(Number.isFinite);
  const unpositionedLabel = user?.drifting === true ? "星空漂流中" : "座標尚未同步";
  const locationLabel = positioned ? uiText`艙室 I · ${view.longitude} / ${uiText(view.latitude)}` : user?.label || unpositionedLabel;
  const destinations = [
    { id: "cabin", star: "Cabin I", zone: "艙室 I", route: "/", image: "/field-preview/assets/home-cabin-realistic.png", l: positioned ? coordinate.l : null, b: positioned ? coordinate.b : null, ly: 0 },
    ...FIELDS.map(f => ({ id: f[0], star: f[1], zone: f[2], route: "/" + f[0], image: "/field-preview/assets/" + f[6], l: f[3], b: f[4], ly: f[5] })),
  ];
  function enter(destination: typeof destinations[number]) {
    if (lock.current) return;
    lock.current = true; setTarget(destination.zone); setTransitioning(true);
    timer.current = window.setTimeout(() => navigate(destination.route), window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 520);
  }
  return <main className="ya-dashboard-page"><div className="ya-dashboard-backdrop" />
    <header className="ya-dashboard-header"><button onClick={() => navigate("/")}>{uiText("← 返回艙室")}</button><span className="ya-dashboard-code">NAV / 01</span></header>
    <section className="ya-coordinate-panel"><span className="ya-kicker">CURRENT COORDINATES</span><div className="ya-coordinate-name">◉ {uiText(locationLabel)}</div><div className="ya-coordinate-values"><span><small>LONGITUDE</small>{positioned ? coordinate.l.toFixed(1) + "°" : "—"}</span><span><small>LATITUDE</small>{uiText(view.latitude)}</span><span><small>DISTANCE</small>{positioned ? coordinate.r.toFixed(2) + " ly" : "—"}</span></div></section>
    <div className="ya-destination-heading"><span>{uiText("選擇目的地")}</span><small>SCROLL TO EXPLORE</small></div>
    <section className="ya-destination-list">{destinations.map((destination, index) => <button key={destination.id} className="ya-destination-row" onClick={() => enter(destination)} disabled={transitioning}><div className="ya-destination-image" style={{ backgroundImage: `linear-gradient(90deg,rgba(2,2,8,.82),rgba(2,2,8,.15)),url(${destination.image})` }} /><div className="ya-destination-icon">{String(index).padStart(2, "0")}</div><div className="ya-destination-copy"><span>{destination.star}</span><strong>{uiText(destination.zone)}</strong><small>{destination.id === "cabin" ? `${view.longitude} · ${uiText(view.latitude)}` : destination.l === null || destination.b === null ? unpositionedLabel : `l ${destination.l.toFixed(1)}° · b ${destination.b >= 0 ? "+" : "−"}${Math.abs(destination.b).toFixed(1)}°`}</small></div><div className="ya-destination-distance">{destination.id === "cabin" ? "0.00" : destination.ly} ly</div><div className="ya-destination-signal">{destination.id === "cabin" ? "ORIGIN" : "ENTER"}</div><b className="ya-destination-arrow">›</b></button>)}</section>
    <p className="ya-dashboard-hint"><Link to="/residents">{uiText("居民名錄")}</Link> · <Link to="/settings">{uiText("我的座標設定")}</Link></p><p className="ya-dashboard-hint">{uiText("上下滑動瀏覽場域 · 點擊卡片前往")}</p>{transitioning && <div className="ya-jump-transition" role="status"><span>{uiText("正在前往")}</span><strong>{uiText(target)}</strong><i /></div>}
  </main>;
}
