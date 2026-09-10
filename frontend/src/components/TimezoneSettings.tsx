import { uiText, getUiLanguage } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import { useId, useRef, useState } from "react";
import api from "../api/client";
import { useAuth } from "../hooks/useAuth";
import { shelfError } from "../hooks/useBookshelf";
import { useTimezoneMinute } from "../hooks/useTimezoneMinute";
import { availableTimezones, COMMON_TIMEZONES, initialTimezone, matchesTimezone, timezoneLabel, timezoneTime } from "../data/timezones";
import "../timezone-settings.css";

export function TimezoneSettings({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) {
  useUiLanguage();
  const { user, refreshUser } = useAuth(); const [zone, setZone] = useState(() => initialTimezone(user?.timezone));
  const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false); const lock = useRef(false); const id = useId();
  const [zones] = useState(() => availableTimezones(user?.timezone));
  const [query, setQuery] = useState(""); const [expanded, setExpanded] = useState(false);
  const now = useTimezoneMinute();
  const filtered = zones.filter(z => matchesTimezone(z, query));
  const showResults = expanded || !!query.trim();
  function choose(value: string) { if (!lock.current && zones.includes(value)) { setZone(value); setNotice(""); } }
  return <form className="cabin-city-form timezone-settings" aria-labelledby={id + "-title"} onSubmit={async e => {
    e.preventDefault(); if (lock.current) return; lock.current = true; setBusy(true); onBusyChange?.(true); setNotice("");
    try { new Intl.DateTimeFormat(getUiLanguage(), { timeZone: zone }); await api.patch("/users/me", { timezone: zone }); await refreshUser(); setNotice("時區已保存。"); }
    catch (err) { setNotice(shelfError(err).message); }
    finally { lock.current = false; setBusy(false); onBusyChange?.(false); }
  }}>
    <p id={id + "-title"}>{uiText("艙室與排程的時區")}</p>
    <div className="timezone-selection">
      <span>{uiText("已選時區")}</span>
      <strong>{uiText(timezoneLabel(zone))}<time dateTime={now.toISOString()}>{timezoneTime(zone, now)}</time></strong>
      <small>{zone}</small>
    </div>
    <div className="timezone-common" role="group" aria-label={uiText("常用城市")}>
      {COMMON_TIMEZONES.map(z => <button type="button" key={z} disabled={busy} aria-pressed={zone === z} onClick={() => choose(z)}>
        <span>{uiText(timezoneLabel(z))}</span><time dateTime={now.toISOString()}>{timezoneTime(z, now)}</time>
      </button>)}
    </div>
    <label htmlFor={id + "-search"}>{uiText("搜尋城市或時區")}</label>
    <input id={id + "-search"} type="search" value={query} disabled={busy} autoComplete="off" spellCheck={false}
      placeholder={uiText("台北、Taipei 或 Asia/Tai")}
      aria-controls={showResults ? id + "-results" : undefined}
      onChange={e => { if (!lock.current) setQuery(e.target.value); }} />
    <small>{uiText("北京、上海、廣州、深圳等城市，請選北京時間（Asia/Shanghai）。")}</small>
    <button type="button" className="timezone-expand" disabled={busy} aria-expanded={showResults} aria-controls={id + "-results"}
      onClick={() => { if (!lock.current) { setExpanded(!showResults); setQuery(""); } }}>{uiText(showResults ? "收起完整清單" : "其他城市／完整清單")}</button>
    {showResults && <div id={id + "-results"} className="timezone-results">
      <p role="status" className="timezone-count">{uiText`找到 ${filtered.length} 個時區`}</p>
      {filtered.length ? <><label htmlFor={id}>{uiText("選擇時區")}</label>
        <select id={id} value={filtered.includes(zone) ? zone : ""} disabled={busy} onChange={e => choose(e.target.value)}>
          <option value="" disabled>{uiText("請選擇時區")}</option>
          {filtered.map(z => <option key={z} value={z}>{uiText(timezoneLabel(z))} · {timezoneTime(z, now)} · {z}</option>)}
        </select></> : <p>{uiText("找不到這個城市或時區，試試英文城市名或 IANA 代號。")}</p>}
    </div>}
    <small>{uiText("按「保存時區」後才會生效。排程依此時區執行；公共場域仍使用台北時間。修改會影響既有排程的執行時間。")}</small>
    <button type="submit" disabled={busy}>{uiText(busy ? "正在保存…" : "保存時區")}</button>
    <p role="status">{uiText(notice)}</p>
  </form>;
}
