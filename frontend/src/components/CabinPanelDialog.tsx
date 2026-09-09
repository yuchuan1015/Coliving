import { uiText, getUiLanguage } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { FurnitureSummary } from "../api/furniture";
import type { CabinPanel } from "../data/cabin";
import { useAuth } from "../hooks/useAuth";
import { CitySettings } from "./CitySettings";
import { BirthYearSettings } from "./BirthYearSettings";
import { CoordinateSettings } from "./CoordinateSettings";
import { MyDMCode } from "./MyDMCode";
import { TimezoneSettings } from "./TimezoneSettings";
import { WardrobeActions, DiningActions, PetActions } from "./FurnitureActions";
import { LanguageControl } from "../i18n/LanguageControl";

const titles: Record<CabinPanel, string> = { settings: "設定", window: "窗外天氣", clock: "時鐘", wardrobe: "衣櫃", dining: "餐桌", pet: "寵物" };
export function CabinPanelDialog({ panel, summary, now, onClose, onRefreshWeather }: { panel: CabinPanel; summary: FurnitureSummary | null; now: Date; onClose: () => void; onRefreshWeather: () => Promise<void> }) {
  useUiLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [cityBusy, setCityBusy] = useState(false);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { previousFocus?.focus(); };
  }, []);

  function close() { if (!cityBusy) onClose(); }
  function go(path: string) { if (cityBusy) return; onClose(); navigate(path); }
  const format = (timeZone?: string) => new Intl.DateTimeFormat(getUiLanguage(), { hour: "2-digit", minute: "2-digit", timeZone }).format(now);
  return <dialog ref={dialog} className="cabin-panel" aria-labelledby="cabin-panel-title" onCancel={event => { event.preventDefault(); close(); }} onClose={close} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close(); } }}>
    <header><h2 id="cabin-panel-title">{uiText(titles[panel])}</h2><button disabled={cityBusy} onClick={close} aria-label={uiText("關閉彈窗")}>×</button></header>
    {panel === "settings" && <><fieldset disabled={cityBusy} style={{ border: 0, padding: 0, margin: 0 }}><LanguageControl /><CitySettings onRefreshWeather={onRefreshWeather} onBusyChange={setCityBusy} /><BirthYearSettings onBusyChange={setCityBusy} /><CoordinateSettings onBusyChange={setCityBusy} /><TimezoneSettings onBusyChange={setCityBusy} /><MyDMCode /></fieldset><fieldset disabled={cityBusy} className="cabin-panel-actions">
      <button onClick={() => go("/agent/advanced")}>{uiText("進階連線與房間設定")}</button>
      <button onClick={() => go("/schedules")}>{uiText("排程管理")}</button>
      {user?.role === "admin" && <button onClick={() => go("/admin")}>{uiText("系統儀表板")}</button>}
      <button onClick={() => { onClose(); logout(); }}>{uiText("登出")}</button>
    </fieldset></>}
    {panel === "clock" && <><dl><dt>{uiText("當地時間")}</dt><dd>{format(user?.timezone ?? summary?.clock.timezone)}</dd><dt>{uiText("社區時間")}</dt><dd>{format(summary?.clock.community_timezone ?? "Asia/Taipei")}</dd></dl><p><small>{uiText("社區使用台北時區；艙室使用你的當地時區。")}</small></p></>}
    {panel === "window" && <>{summary?.weather ? <>
      <p>{uiText(summary.weather.description)} · {summary.weather.temperature}°C</p>
      <dl><dt>{uiText("城市")}</dt><dd>{summary.weather.source === "community" ? uiText("社區") : summary.weather.location ?? uiText("未提供")}</dd>
        {typeof summary.weather.wind_kmh === "number" && <><dt>{uiText("風速")}</dt><dd>{summary.weather.wind_kmh} km/h</dd></>}
        {typeof summary.weather.is_day === "boolean" && <><dt>{uiText("日夜")}</dt><dd>{summary.weather.is_day ? uiText("白天") : uiText("夜間")}</dd></>}
      </dl>
      <p><small>{summary.weather.source === "local" ? uiText("當地實際天氣 · Open-Meteo") : summary.weather.source === "community" ? uiText("當地天氣暫不可用，目前顯示社區天氣。") : uiText("天氣來源尚未提供。")}</small></p>
    </> : <p>{uiText("天氣尚未同步，請稍後再來看看。")}</p>}</>}
    {["wardrobe", "dining", "pet"].includes(panel) && <fieldset className="cabin-action-fields" disabled={cityBusy}>
      {panel === "wardrobe" && <WardrobeActions onBusyChange={setCityBusy} />}
      {panel === "dining" && <DiningActions onBusyChange={setCityBusy} />}
      {panel === "pet" && <PetActions onBusyChange={setCityBusy} />}
    </fieldset>}
  </dialog>;
}
