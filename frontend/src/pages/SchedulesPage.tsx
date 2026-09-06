import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createSchedule,
  deleteSchedule,
  listSchedules,
  updateSchedule,
  type ScheduleOut,
} from "../api/schedules";

const CRON_PRESETS = [
  { label: "每小時", value: "0 * * * *" },
  { label: "每天 9:00", value: "0 9 * * *" },
  { label: "每天 21:00", value: "0 21 * * *" },
  { label: "每 30 分鐘", value: "*/30 * * * *" },
  { label: "自訂", value: "" },
];

export function SchedulesPage() {
  const navigate = useNavigate();
  const [schedules, setSchedules] = useState<ScheduleOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [cronExpr, setCronExpr] = useState("0 * * * *");
  const [customCron, setCustomCron] = useState("");
  const [message, setMessage] = useState("");
  const [callbackUrl, setCallbackUrl] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listSchedules()
      .then(setSchedules)
      .catch(() => setError("載入失敗"))
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    const cron = cronExpr || customCron;
    if (!cron) {
      setError("請選擇或輸入排程時間");
      setSaving(false);
      return;
    }
    try {
      const s = await createSchedule({
        name,
        cron_expr: cron,
        message,
        callback_url: callbackUrl || undefined,
      });
      setSchedules([...schedules, s]);
      setName("");
      setCronExpr("0 * * * *");
      setCustomCron("");
      setMessage("");
      setCallbackUrl("");
    } catch (err: any) {
      setError(err.response?.data?.detail || "新增失敗");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(s: ScheduleOut) {
    try {
      const updated = await updateSchedule(s.id, { enabled: !s.enabled });
      setSchedules(schedules.map((x) => (x.id === s.id ? updated : x)));
    } catch {
      setError("更新失敗");
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteSchedule(id);
      setSchedules(schedules.filter((x) => x.id !== id));
    } catch {
      setError("刪除失敗");
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-lg px-5 py-8">
        <p style={{ color: "var(--ink-soft)" }}>載入中...</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg px-5 py-8 pb-40">
      <button
        onClick={() => navigate("/")}
        className="mb-6 text-sm"
        style={{ color: "var(--accent)" }}
      >
        &larr; 回首頁
      </button>

      <h1 className="mb-2 text-xl font-semibold" style={{ color: "var(--ink)" }}>
        排程喚醒
      </h1>
      <p className="mb-6 text-sm" style={{ color: "var(--ink-soft)" }}>
        設定定時喚醒，讓室友按時做事。
      </p>

      {/* Existing schedules */}
      {schedules.length > 0 && (
        <div className="mb-6 space-y-3">
          {schedules.map((s) => (
            <div
              key={s.id}
              className="rounded-xl p-4"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                opacity: s.enabled ? 1 : 0.5,
              }}
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium" style={{ color: "var(--ink)" }}>
                    {s.name}
                  </div>
                  <div className="mt-1 text-[10px] font-mono" style={{ color: "var(--ink-soft)" }}>
                    {s.cron_expr}
                  </div>
                  <div className="mt-1 text-xs" style={{ color: "var(--ink-soft)" }}>
                    {s.message.length > 60 ? s.message.slice(0, 60) + "..." : s.message}
                  </div>
                  {s.next_run && (
                    <div className="mt-1 text-[10px]" style={{ color: "var(--ink-soft)" }}>
                      下次：{new Date(s.next_run).toLocaleString("zh-TW")}
                    </div>
                  )}
                </div>
                <div className="ml-3 flex gap-2">
                  <button
                    onClick={() => handleToggle(s)}
                    className="rounded-full px-2 py-1 text-[10px] font-medium"
                    style={{
                      background: s.enabled ? "var(--accent)" : "var(--surface-dim)",
                      color: s.enabled ? "var(--accent-fg)" : "var(--ink-soft)",
                    }}
                  >
                    {s.enabled ? "啟用" : "停用"}
                  </button>
                  <button
                    onClick={() => handleDelete(s.id)}
                    className="text-[10px]"
                    style={{ color: "var(--error)" }}
                  >
                    刪除
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create form */}
      <form
        onSubmit={handleCreate}
        className="space-y-4 rounded-xl p-4"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
      >
        <div className="text-sm font-medium" style={{ color: "var(--ink)" }}>
          新增排程
        </div>

        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="排程名稱（如：每日巡邏）"
          required
          maxLength={64}
          className="w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={{
            background: "var(--surface-dim)",
            color: "var(--ink)",
            border: "1px solid var(--border)",
          }}
        />

        <div>
          <div className="mb-2 flex flex-wrap gap-2">
            {CRON_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setCronExpr(p.value)}
                className="rounded-lg px-3 py-1.5 text-xs font-medium"
                style={{
                  background: cronExpr === p.value ? "var(--accent)" : "var(--surface-dim)",
                  color: cronExpr === p.value ? "var(--accent-fg)" : "var(--ink-soft)",
                  border: "1px solid " + (cronExpr === p.value ? "var(--accent)" : "var(--border)"),
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          {cronExpr === "" && (
            <input
              type="text"
              value={customCron}
              onChange={(e) => setCustomCron(e.target.value)}
              placeholder="cron 表達式（如 */15 * * * *）"
              className="w-full rounded-lg px-3 py-2 font-mono text-xs outline-none"
              style={{
                background: "var(--surface-dim)",
                color: "var(--ink)",
                border: "1px solid var(--border)",
              }}
            />
          )}
        </div>

        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="喚醒訊息（室友收到後會看到這段話）"
          required
          maxLength={2000}
          rows={3}
          className="w-full resize-none rounded-lg px-3 py-2 text-sm outline-none"
          style={{
            background: "var(--surface-dim)",
            color: "var(--ink)",
            border: "1px solid var(--border)",
          }}
        />

        <input
          type="url"
          value={callbackUrl}
          onChange={(e) => setCallbackUrl(e.target.value)}
          placeholder="Webhook URL（選填，到時間會 POST 過去）"
          className="w-full rounded-lg px-3 py-2 text-xs outline-none"
          style={{
            background: "var(--surface-dim)",
            color: "var(--ink)",
            border: "1px solid var(--border)",
          }}
        />

        {error && (
          <p className="rounded-lg px-3 py-2 text-sm" style={{ background: "var(--error)", color: "#fff" }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={saving || !name || !message}
          className="w-full rounded-lg py-2.5 text-sm font-medium disabled:opacity-40"
          style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
        >
          {saving ? "新增中..." : "新增排程"}
        </button>
      </form>
    </main>
  );
}
