import { useId, useRef, useState } from "react";
import api from "../api/client";
import { useAuth } from "../hooks/useAuth";
import { shelfError } from "../hooks/useBookshelf";

export function TimezoneSettings({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) {
  const { user, refreshUser } = useAuth(); const [zone, setZone] = useState(user?.timezone ?? "Asia/Taipei");
  const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false); const lock = useRef(false); const id = useId();
  const zones = [...new Set([user?.timezone ?? "Asia/Taipei", Intl.DateTimeFormat().resolvedOptions().timeZone, ...((Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? ["Asia/Taipei", "Asia/Tokyo", "Asia/Hong_Kong", "America/New_York", "America/Los_Angeles", "Europe/London", "UTC"])])];
  return <form className="cabin-city-form" onSubmit={async e => {
    e.preventDefault(); if (lock.current) return; lock.current = true; setBusy(true); onBusyChange?.(true); setNotice("");
    try { new Intl.DateTimeFormat("zh-TW", { timeZone: zone }); await api.patch("/users/me", { timezone: zone }); await refreshUser(); setNotice("時區已保存。"); }
    catch (err) { setNotice(shelfError(err).message); }
    finally { lock.current = false; setBusy(false); onBusyChange?.(false); }
  }}><label htmlFor={id}>艙室與排程的時區</label><select id={id} value={zone} disabled={busy} onChange={e => setZone(e.target.value)}>{zones.map(z => <option key={z} value={z}>{z}</option>)}</select><small>排程依此時區執行；公共場域仍使用台北時間。修改會影響既有排程的執行時間。</small><button type="submit" disabled={busy}>保存時區</button><p role="status">{notice}</p></form>;
}
