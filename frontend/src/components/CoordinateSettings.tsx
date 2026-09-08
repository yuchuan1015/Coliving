import { useRef, useState, type FormEvent } from "react";
import api from "../api/client";
import { useAuth } from "../hooks/useAuth";
import { shelfError } from "../hooks/useBookshelf";
import { coordinateView, validMonthDay } from "../coordinates";

export function CoordinateSettings({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) {
  const { user, refreshUser } = useAuth();
  const [day, setDay] = useState(""); const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false); const [uncertain, setUncertain] = useState(false); const [notice, setNotice] = useState("");
  const lock = useRef(false), view = coordinateView(user);
  const unknown = user?.anchor_date_1 === undefined || user?.anchor_date_2 === undefined;
  const saved = !!user?.anchor_date_2;
  async function run(reload: boolean) {
    if (lock.current || (!reload && (!confirming || saved || unknown || uncertain || !validMonthDay(day)))) return;
    lock.current = true; setBusy(true); onBusyChange?.(true); setNotice("");
    try {
      if (!reload) await api.patch("/users/me/anchors", { anchor_date_2: day });
      await refreshUser(); setConfirming(false); setUncertain(false); setNotice(reload ? "座標狀態已同步。" : "第二個日子已保存，不能再次更改。");
    } catch (err) { setNotice(shelfError(err).message); if (!reload) setUncertain(true); }
    finally { lock.current = false; setBusy(false); onBusyChange?.(false); }
  }
  function submit(e: FormEvent) {
    e.preventDefault(); if (busy || saved || unknown || uncertain) return;
    if (!validMonthDay(day)) { setNotice("請填有效月日，例如 10-15；不需要年份，02-29 也可以。"); return; }
    setNotice(""); setConfirming(true);
  }
  return <form className="cabin-city-form" onSubmit={submit}><h3>我的星球座標</h3><p>{view.label} · {view.longitude} / {view.latitude}</p>
    <label>第一個日子<input value={user?.anchor_date_1 ?? ""} readOnly placeholder="領養室友時自動記下" /></label><small>領養室友的那一天，由系統記錄，不需手動填寫。</small>
    <label>第二個日子<input value={user?.anchor_date_2 || day} readOnly={saved || confirming || unknown || uncertain} disabled={busy} onChange={e => setDay(e.target.value)} placeholder="MM-DD，例如 10-15" maxLength={5} inputMode="text" /></label><small>{saved ? "已保存，不能再次更改。" : "等那一天真的有了再填。只填月日，保存後不能更改。"}</small>
    {unknown && <p>帳號資料尚未完整同步，請先重新讀取。</p>}{notice && <p role="status">{notice}</p>}{uncertain && <p role="alert">請先重新讀取，確認是否已保存；不會直接重送。</p>}
    <button type="button" disabled={busy} onClick={() => void run(true)}>重新讀取座標</button>
    {!saved && !unknown && !uncertain && (confirming ? <><p role="alert">確認第二個日子是 {day}？保存後不能更改。</p><button type="button" disabled={busy} onClick={() => void run(false)}>確認保存第二個日子</button><button type="button" disabled={busy} onClick={() => setConfirming(false)}>返回修改</button></> : <button type="submit" disabled={busy}>檢查日子</button>)}
  </form>;
}
