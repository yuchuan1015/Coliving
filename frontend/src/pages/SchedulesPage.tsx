import { uiText, getUiLanguage } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { isAxiosError } from "axios";
import { useAuth } from "../hooks/useAuth";
import { CabinUtilityShell } from "../components/CabinUtilityShell";
import { createSchedule, deleteSchedule, listSchedules, updateSchedule, type ScheduleOut } from "../api/schedules";
import "../schedules.css";

const CRON_PRESETS = [
  { label: "每小時", value: "0 * * * *" },
  { label: "每天 9:00", value: "0 9 * * *" },
  { label: "每天 21:00", value: "0 21 * * *" },
  { label: "每 30 分鐘", value: "*/30 * * * *" },
  { label: "自訂", value: "" },
];

function errorMessage(error: unknown, fallback: string) {
  const detail = isAxiosError(error) ? error.response?.data?.detail : undefined;
  return typeof detail === "string" ? detail : fallback;
}

function scheduleNextRun(value: string | null, timezone: string) {
  if (!value) return uiText("尚未排定");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return uiText("時間未取得");
  try { return date.toLocaleString(getUiLanguage(), { timeZone: timezone }); }
  catch { return uiText("時間未取得"); }
}

export function SchedulesPage() {
  useUiLanguage();
  const { user } = useAuth();
  const timezone = user?.timezone || "UTC";
  const [schedules, setSchedules] = useState<ScheduleOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [name, setName] = useState("");
  const [cronExpr, setCronExpr] = useState("0 * * * *");
  const [customCron, setCustomCron] = useState("");
  const [message, setMessage] = useState("");
  const [callbackUrl, setCallbackUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const pending = useRef(false);

  useEffect(() => {
    let active = true;
    setLoading(true); setLoadError(false);
    listSchedules().then(value => { if (active) setSchedules(value); })
      .catch(() => { if (active) setLoadError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (pending.current || loading || loadError) return;
    const cron = cronExpr || customCron.trim();
    if (!name.trim() || !message.trim() || !cron) {
      setError("請填寫名稱、喚醒訊息與排程時間"); return;
    }
    pending.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const schedule = await createSchedule({ name, cron_expr: cron, message, callback_url: callbackUrl || undefined });
      setSchedules(previous => [...previous, schedule]);
      setName(""); setCronExpr("0 * * * *"); setCustomCron(""); setMessage(""); setCallbackUrl("");
      setNotice("排程已新增");
    } catch (err) { setError(errorMessage(err, "新增失敗，輸入的內容已保留。")); }
    finally { pending.current = false; setBusy(false); }
  }

  async function handleToggle(schedule: ScheduleOut) {
    if (pending.current || loading || loadError) return;
    pending.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const updated = await updateSchedule(schedule.id, { enabled: !schedule.enabled });
      setSchedules(previous => previous.map(item => item.id === schedule.id ? updated : item));
      setNotice(updated.enabled ? "排程已啟用" : "排程已暫停");
    } catch (err) { setError(errorMessage(err, "更新失敗，排程狀態未變更。")); }
    finally { pending.current = false; setBusy(false); }
  }

  async function handleDelete(id: string) {
    if (pending.current || loading || loadError) return;
    pending.current = true; setBusy(true); setError(""); setNotice("");
    try {
      await deleteSchedule(id);
      setSchedules(previous => previous.filter(item => item.id !== id));
      setDeleting(null); setNotice("排程已刪除");
    } catch (err) { setError(errorMessage(err, "刪除失敗，請稍後再試。")); }
    finally { pending.current = false; setBusy(false); }
  }

  return <CabinUtilityShell title={uiText("排程喚醒")} code="SCHEDULES">
    <div className="schedule-page">
      <section className="photo-panel schedule-context">
        <p>{uiText("設定定時喚醒，讓室友按時做事。")}</p>
        <div className="utility-meta"><span>{uiText("執行時區")}</span><code>{timezone}</code></div>
        <p className="schedule-hint">{uiText("Cron 依帳號設定的當地時區執行；更換時區會影響排程時間。")}</p>
      </section>
      <form className="photo-panel schedule-form" onSubmit={handleCreate}>
        <h2>{uiText("新增排程")}</h2>
        <fieldset disabled={busy || loading || loadError}>
          <label htmlFor="schedule-name">{uiText("排程名稱")}
            <input id="schedule-name" type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder={uiText("例如：每日巡邏")} required maxLength={64} />
          </label>
          <fieldset className="schedule-frequency">
            <legend>{uiText("喚醒頻率")}</legend>
            <div className="schedule-presets">
              {CRON_PRESETS.map(p => <button key={p.label} type="button" aria-pressed={cronExpr === p.value}
                onClick={() => setCronExpr(p.value)}>{uiText(p.label)}</button>)}
            </div>
            {cronExpr === "" && <label htmlFor="schedule-cron">{uiText("Cron 表達式")}
              <input id="schedule-cron" type="text" value={customCron} onChange={e => setCustomCron(e.target.value)}
                placeholder="*/15 * * * *" required maxLength={64} autoCapitalize="none" spellCheck={false} />
            </label>}
          </fieldset>
          <label htmlFor="schedule-message">{uiText("喚醒訊息")}
            <textarea id="schedule-message" value={message} onChange={e => setMessage(e.target.value)}
              placeholder={uiText("室友收到後會看到這段話")} required maxLength={2000} rows={4} />
          </label>
          <label htmlFor="schedule-webhook">{uiText("Webhook URL（選填）")}
            <input id="schedule-webhook" type="url" value={callbackUrl} onChange={e => setCallbackUrl(e.target.value)}
              placeholder="https://" maxLength={512} autoCapitalize="none" spellCheck={false} aria-describedby="schedule-webhook-help" />
            <span id="schedule-webhook-help" className="schedule-hint">{uiText("到時間會向這個網址傳送 POST 請求。")}</span>
          </label>
          <button className="photo-primary schedule-submit" type="submit"
            disabled={busy || !name.trim() || !message.trim() || !(cronExpr || customCron.trim())}>
            {busy ? uiText("處理中…") : uiText("新增排程")}
          </button>
        </fieldset>
      </form>
      <div className="photo-status" aria-live="polite">
        {error && <p role="alert">{uiText(error)}</p>}
        {notice && <p role="status">{uiText(notice)}</p>}
      </div>
      <section className="schedule-list" aria-labelledby="schedule-list-title" aria-busy={loading}>
        <div className="utility-toolbar"><h2 id="schedule-list-title">{uiText("我的排程")}</h2>
          {!loading && !loadError && <span className="photo-badge">{uiText`${schedules.length} 個排程`}</span>}
        </div>
        {loading ? <div className="photo-panel"><p role="status">{uiText("正在讀取排程…")}</p></div>
          : loadError ? <div className="photo-panel"><p role="alert">{uiText("暫時無法讀取排程，請稍後再試。")}</p>
            <button type="button" disabled={busy} onClick={() => setRevision(value => value + 1)}>{uiText("重新讀取")}</button></div>
          : schedules.length === 0 ? <div className="photo-panel schedule-empty"><span aria-hidden="true">◷</span>
            <h3>{uiText("還沒有排程")}</h3><p>{uiText("新增一個喚醒時間，讓室友在約好的時候收到訊息。")}</p></div>
          : schedules.map(schedule => <article className="photo-panel schedule-entry" key={schedule.id}>
            <header className="schedule-entry-head"><h3>{schedule.name}</h3>
              <span className="photo-badge">{schedule.enabled ? uiText("啟用中") : uiText("已暫停")}</span></header>
            <p className="schedule-cron"><span>{uiText("喚醒頻率")}</span><code>{schedule.cron_expr}</code></p>
            <p className="utility-body">{schedule.message}</p>
            <p className="schedule-hint">{uiText("下次喚醒：")}{scheduleNextRun(schedule.next_run, timezone)}</p>
            {deleting === schedule.id ? <div className="schedule-confirm" role="group" aria-label={uiText("刪除排程確認")}>
              <p>{uiText("刪除後無法復原，確定移除這個排程？")}</p>
              <div className="utility-actions"><button type="button" disabled={busy} onClick={() => setDeleting(null)}>{uiText("取消")}</button>
                <button type="button" className="utility-danger" disabled={busy} onClick={() => handleDelete(schedule.id)}>{uiText("確認刪除")}</button></div>
            </div> : <div className="utility-actions">
              <button type="button" disabled={busy} onClick={() => handleToggle(schedule)}>{schedule.enabled ? uiText("暫停") : uiText("啟用")}</button>
              <button type="button" className="utility-danger" disabled={busy} onClick={() => setDeleting(schedule.id)}>{uiText("刪除")}</button>
            </div>}
          </article>)}
      </section>
    </div>
  </CabinUtilityShell>;
}
