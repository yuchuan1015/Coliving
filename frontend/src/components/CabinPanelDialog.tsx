import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { isAxiosError } from "axios";
import api from "../api/client";
import type { FurnitureSummary } from "../api/furniture";
import type { CabinPanel } from "../data/cabin";
import { useAuth } from "../hooks/useAuth";

const titles: Record<CabinPanel, string> = { settings: "設定", window: "窗外天氣", clock: "時鐘", wardrobe: "衣櫃", dining: "餐桌", pet: "寵物" };
type SummaryRow = { title: string; detail: string };
interface Outfit { id: string; name: string; description?: string }
interface Pet { id: string; name: string; species: string; hunger: number; cleanliness: number; happiness: number }

export function CabinPanelDialog({ panel, summary, now, onClose }: { panel: CabinPanel; summary: FurnitureSummary | null; now: Date; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<SummaryRow[]>([]);
  const [loading, setLoading] = useState(["wardrobe", "dining", "pet"].includes(panel));
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { previousFocus?.focus(); };
  }, []);
  useEffect(() => {
    if (!["wardrobe", "dining", "pet"].includes(panel)) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        let result: SummaryRow[] = [];
        if (panel === "wardrobe") {
          const [all, current] = await Promise.all([api.get<Outfit[]>("/outfits/"), api.get<{ outfit: Outfit | null; message?: string }>("/outfits/current")]);
          result = [{ title: "目前造型", detail: current.data.outfit?.name ?? current.data.message ?? "尚未穿戴造型" }, ...all.data.map(item => ({ title: item.name, detail: item.description ?? "收藏中的造型" }))];
        } else if (panel === "dining") {
          const { data } = await api.get<{ active: boolean; status?: string; description?: string }>("/home/dining/current");
          result = [{ title: data.active ? "目前的共餐" : "餐桌還空著", detail: data.active ? `${data.status ?? ""} · ${data.description ?? "等待室友回應"}` : "目前沒有進行中的用餐。" }];
        } else {
          const { data } = await api.get<{ pets: Pet[] }>("/pets");
          result = data.pets.map(item => ({ title: `${item.name} · ${item.species}`, detail: `飢餓 ${item.hunger}／清潔 ${item.cleanliness}／心情 ${item.happiness}` }));
          if (!result.length) result = [{ title: "還沒有寵物入住", detail: "艙室裡的貓咪是空間示意，不代表已經領養。" }];
        }
        if (!cancelled) setRows(result);
      } catch (err) {
        if (!cancelled) setError(isAxiosError(err) && typeof err.response?.data?.detail === "string" ? err.response.data.detail : "暫時無法讀取資料，請稍後重試。");
      } finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, [panel, retry]);

  function go(path: string) { onClose(); navigate(path); }
  const format = (timeZone?: string) => new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit", timeZone }).format(now);
  return <dialog ref={dialog} className="cabin-panel" aria-labelledby="cabin-panel-title" onCancel={onClose} onClose={onClose} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}>
    <header><h2 id="cabin-panel-title">{titles[panel]}</h2><button onClick={onClose} aria-label="關閉彈窗">×</button></header>
    {panel === "settings" && <div className="cabin-panel-actions">
      <button onClick={() => go("/agent/edit")}>Agent 設定</button>
      <button onClick={() => go("/schedules")}>排程管理</button>
      {user?.role === "admin" && <button onClick={() => go("/admin")}>系統儀表板</button>}
      <button onClick={() => { onClose(); logout(); }}>登出</button>
    </div>}
    {panel === "clock" && <><dl><dt>當地時間</dt><dd>{format(user?.timezone ?? summary?.clock.timezone)}</dd><dt>社區時間</dt><dd>{format(summary?.clock.community_timezone ?? "Asia/Taipei")}</dd></dl><p><small>社區使用台北時區；艙室使用你的當地時區。</small></p></>}
    {panel === "window" && <p>{summary?.weather ? `${summary.weather.description} · ${summary.weather.temperature}°C` : "天氣尚未同步，請稍後再來看看。"}</p>}
    {loading && <p role="status">正在讀取…</p>}
    {error && <><p role="alert">{error}</p><button onClick={() => setRetry(value => value + 1)}>重試</button></>}
    {!loading && !error && rows.length > 0 && <><ul>{rows.map((row, index) => <li key={index}>{row.title}<br /><small>{row.detail}</small></li>)}</ul><p><small>目前提供資料檢視；{panel === "wardrobe" ? "換裝" : panel === "dining" ? "發起共餐" : "領養與互動"}操作介面尚待製作。</small></p></>}
  </dialog>;
}
