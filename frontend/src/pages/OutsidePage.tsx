import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/client";

const MAP = { width: 480, height: 760 };
type Destination = { id: string; name: string; english: string; tier: 1 | 2; endpoint: string; route: string; planet: { x: number; y: number; r: number }; cardOffset: { dx: number; dy: number } };
const destinations: Destination[] = [
  { id: "plaza", name: "廣場", english: "PLAZA", tier: 1, endpoint: "/posts?limit=1", route: "/plaza", planet: { x: 90, y: 155, r: 18 }, cardOffset: { dx: 28, dy: -52 } },
  { id: "library", name: "圖書館", english: "LIBRARY", tier: 1, endpoint: "/library/works", route: "/library", planet: { x: 265, y: 125, r: 22 }, cardOffset: { dx: -82, dy: -62 } },
  { id: "park", name: "公園", english: "PARK", tier: 1, endpoint: "/park", route: "/park", planet: { x: 405, y: 235, r: 14 }, cardOffset: { dx: -88, dy: -28 } },
  { id: "workshop", name: "工坊", english: "WORKSHOP", tier: 1, endpoint: "/skins/store", route: "/workshop", planet: { x: 145, y: 335, r: 13 }, cardOffset: { dx: 24, dy: -28 } },
  { id: "weilan", name: "微瀾", english: "WEILAN", tier: 1, endpoint: "/weilan", route: "/weilan", planet: { x: 340, y: 365, r: 17 }, cardOffset: { dx: -90, dy: 20 } },
  { id: "museum", name: "美術館", english: "MUSEUM", tier: 2, endpoint: "/museum?floor=1", route: "/museum", planet: { x: 82, y: 485, r: 12 }, cardOffset: { dx: 28, dy: -28 } },
  { id: "history", name: "歷史館", english: "HISTORY", tier: 2, endpoint: "/history/today", route: "/history", planet: { x: 238, y: 520, r: 11 }, cardOffset: { dx: 25, dy: 18 } },
  { id: "adult", name: "成人區", english: "ADULT", tier: 2, endpoint: "/adult", route: "/adult", planet: { x: 405, y: 500, r: 10 }, cardOffset: { dx: -92, dy: -25 } },
  { id: "health", name: "女性健康中心", english: "HEALTH", tier: 2, endpoint: "/health-center", route: "/health", planet: { x: 122, y: 650, r: 12 }, cardOffset: { dx: 30, dy: -26 } },
  { id: "mail", name: "郵驛", english: "MAIL", tier: 2, endpoint: "/mail/unread", route: "/mail", planet: { x: 290, y: 640, r: 12 }, cardOffset: { dx: -76, dy: 20 } },
  { id: "ai-chat", name: "AI 私訊", english: "AI CHAT", tier: 2, endpoint: "/ai-chat/conversations", route: "/ai-chat", planet: { x: 425, y: 710, r: 10 }, cardOffset: { dx: -100, dy: -30 } },
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function OutsidePage() {
  const navigate = useNavigate();
  const viewportRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ x: 0, y: 0, tx: 0, ty: 0, distance: 0, scale: 1 });
  const [transform, setTransform] = useState({ scale: 1, tx: 0, ty: 0 });
  const [selected, setSelected] = useState<Destination | null>(null);
  const [online, setOnline] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const box = viewportRef.current?.getBoundingClientRect();
    if (box) setTransform({ scale: 1, tx: (box.width - MAP.width) / 2, ty: (box.height - MAP.height) / 2 });
    Promise.allSettled(destinations.map((destination) => api.get(destination.endpoint))).then((results) => {
      const next: Record<string, boolean> = {};
      results.forEach((result, index) => { next[destinations[index].id] = result.status === "fulfilled"; });
      setOnline(next);
    });
  }, []);

  function applyZoom(nextScale: number, centerX?: number, centerY?: number) {
    const box = viewportRef.current?.getBoundingClientRect(); if (!box) return;
    const cx = centerX ?? box.width / 2; const cy = centerY ?? box.height / 2; const scale = clamp(nextScale, 1, 3);
    setTransform((current) => ({ scale, tx: cx - (cx - current.tx) * (scale / current.scale), ty: cy - (cy - current.ty) * (scale / current.scale) }));
  }

  function focus(destination: Destination) {
    const box = viewportRef.current?.getBoundingClientRect(); if (!box) return;
    const scale = 2;
    setTransform({ scale, tx: box.width / 2 - destination.planet.x * scale, ty: box.height / 2 - destination.planet.y * scale });
    setSelected(destination);
  }

  function activate(destination: Destination) {
    if (destination.tier === 2 && transform.scale < 1.8) { focus(destination); return; }
    navigate(destination.route);
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId); pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointers.current.values()];
    gesture.current = { x: event.clientX, y: event.clientY, tx: transform.tx, ty: transform.ty, distance: points.length === 2 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0, scale: transform.scale };
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY }); const points = [...pointers.current.values()]; const box = viewportRef.current?.getBoundingClientRect(); if (!box) return;
    if (points.length >= 2 && gesture.current.distance) {
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y); const centerX = (points[0].x + points[1].x) / 2 - box.left; const centerY = (points[0].y + points[1].y) / 2 - box.top; const scale = clamp(gesture.current.scale * distance / gesture.current.distance, 1, 3);
      setTransform({ scale, tx: centerX - (centerX - gesture.current.tx) * (scale / gesture.current.scale), ty: centerY - (centerY - gesture.current.ty) * (scale / gesture.current.scale) });
    } else if (points.length === 1) {
      setTransform((current) => ({ ...current, tx: current.tx + event.clientX - gesture.current.x, ty: current.ty + event.clientY - gesture.current.y })); gesture.current.x = event.clientX; gesture.current.y = event.clientY;
    }
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) { pointers.current.delete(event.pointerId); }

  return <main className="ya-outside-page"><div className="ya-outside-stars" /><header className="ya-outside-topbar"><button onClick={() => navigate("/")}>← 返回艙室</button><span className="ya-outside-count">11 DESTINATIONS</span></header><div ref={viewportRef} className="ya-map-viewport" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
    <div className="ya-map-world" style={{ width: MAP.width, height: MAP.height, transform: `translate3d(${transform.tx}px,${transform.ty}px,0) scale(${transform.scale})` }}><div className="ya-map-background" /><div className="ya-map-planets">{destinations.map((destination) => { const hiddenCard = destination.tier === 2 && transform.scale < 1.8; return <div key={destination.id} className={`ya-map-destination ${destination.tier === 2 && hiddenCard ? "has-hidden-card" : ""}`} style={{ left: destination.planet.x - destination.planet.r, top: destination.planet.y - destination.planet.r }}><button className={`ya-planet-hit ${selected?.id === destination.id ? "is-selected" : ""}`} style={{ width: destination.planet.r * 2, height: destination.planet.r * 2 }} onClick={(event) => { event.stopPropagation(); activate(destination); }} aria-label={destination.name}><span /></button>{!hiddenCard && <button className={`ya-map-card ${selected?.id === destination.id ? "is-selected" : ""}`} style={{ left: destination.planet.r * 2 + destination.cardOffset.dx, top: destination.cardOffset.dy, transform: `scale(${1 / transform.scale})` }} onClick={(event) => { event.stopPropagation(); activate(destination); }}><strong>{destination.name}</strong><small>{destination.english}</small></button>}</div>; })}</div></div>
  </div><div className="ya-map-controls"><button onClick={() => applyZoom(transform.scale + .4)}>＋</button><button onClick={() => applyZoom(transform.scale - .4)}>−</button></div>{selected && <aside className="ya-destination-card"><button className="ya-destination-close" onClick={() => setSelected(null)}>×</button><span className="ya-kicker">{selected.english}</span><h2>{selected.name}</h2><p>{online[selected.id] ? "目的地訊號已連線。" : "目的地正在等待前端介面。"}</p><button className="ya-destination-enter" onClick={() => activate(selected)}>進入場域 <span>↗</span></button></aside>}<p className="ya-outside-hint">拖曳平移 · 雙指縮放 · tier 2 於 1.8 倍放大</p></main>;
}
