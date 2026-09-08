import { useRef, useState, type FormEvent } from "react";
import { useAuth } from "../hooks/useAuth";
import { shelfError } from "../hooks/useBookshelf";

export function CitySettings({ onRefreshWeather, onBusyChange }: { onRefreshWeather: () => Promise<void>; onBusyChange: (busy: boolean) => void }) {
  const { user, updateLocation } = useAuth();
  const [city, setCity] = useState(user?.location_name ?? "");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [weatherPending, setWeatherPending] = useState(false);
  async function run(saveCity: boolean) {
    if (lock.current) return;
    lock.current = true; setBusy(true); onBusyChange(true); setError(""); setMessage("");
    try {
      if (saveCity) {
        const saved = await updateLocation(city.trim());
        setCity(saved.location_name ?? "");
      }
      setMessage("城市設定已保存。");
      try { await onRefreshWeather(); setWeatherPending(false); }
      catch { setWeatherPending(true); setMessage("城市設定已保存，天氣暫時無法更新。可以只重試讀取天氣。"); }
    } catch (err) { setError(shelfError(err).message); }
    finally { lock.current = false; setBusy(false); onBusyChange(false); }
  }
  function submit(event: FormEvent) { event.preventDefault(); void run(true); }
  return <form className="cabin-city-form" onSubmit={submit}>
    <label htmlFor="cabin-city">所在城市</label>
    <input id="cabin-city" type="text" autoComplete="address-level2" maxLength={64} value={city} onChange={event => { setCity(event.target.value); setError(""); setMessage(""); }} disabled={busy} placeholder="例如：台北、Tokyo" aria-describedby="cabin-city-hint" />
    <small id="cabin-city-hint">只用城市查詢天氣，不取得裝置定位。留白使用時區推定的城市；公園仍用社區天氣。</small>
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    <button type="submit" disabled={busy}>{busy ? "處理中…" : "保存城市"}</button>
    {weatherPending && <button type="button" disabled={busy} onClick={() => void run(false)}>重新讀取天氣</button>}
  </form>;
}
