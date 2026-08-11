import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  closeTable,
  DENSITY_LABELS,
  getTable,
  getWeilan,
  joinTable,
  leaveTable,
  openTable,
  type TableDetail,
  type TableOut,
  type WeilanResponse,
} from "../api/weilan";
import { FootprintSection } from "../components/FootprintSection";

export function WeilanPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<WeilanResponse | null>(null);
  const [density, setDensity] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [detail, setDetail] = useState<TableDetail | null>(null);

  // form
  const [formTitle, setFormTitle] = useState("");
  const [formDensity, setFormDensity] = useState("mid");
  const [formActivity, setFormActivity] = useState("");
  const [formSeats, setFormSeats] = useState(6);
  const [submitting, setSubmitting] = useState(false);

  const load = async (d?: string | null) => {
    try {
      const res = await getWeilan(d || undefined);
      setData(res);
      if (!formActivity && res.activity_types[formDensity]?.length) {
        setFormActivity(res.activity_types[formDensity][0].key);
      }
    } catch {
      setError("載入失敗");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(density); }, [density]);

  useEffect(() => {
    if (data?.activity_types[formDensity]?.length) {
      setFormActivity(data.activity_types[formDensity][0].key);
    }
  }, [formDensity, data]);

  const handleOpen = async () => {
    if (!formTitle.trim() || !formActivity) return;
    setSubmitting(true);
    setError("");
    try {
      await openTable({ title: formTitle.trim(), activity_type: formActivity, density: formDensity, max_seats: formSeats });
      setFormTitle("");
      setShowForm(false);
      load(density);
    } catch {
      setError("開桌失敗");
    } finally {
      setSubmitting(false);
    }
  };

  const openDetail = async (id: string) => {
    try {
      const d = await getTable(id);
      setDetail(d);
    } catch {
      setError("載入桌子失敗");
    }
  };

  const handleJoin = async (id: string) => {
    try {
      await joinTable(id);
      const d = await getTable(id);
      setDetail(d);
      load(density);
    } catch {
      setError("入座失敗");
    }
  };

  const handleLeave = async (id: string) => {
    try {
      await leaveTable(id);
      setDetail(null);
      load(density);
    } catch {
      setError("離座失敗");
    }
  };

  const handleClose = async (id: string) => {
    try {
      await closeTable(id);
      setDetail(null);
      load(density);
    } catch {
      setError("關桌失敗");
    }
  };

  if (loading) {
    return (
      <main className="mx-auto max-w-lg px-5 py-8">
        <p style={{ color: "var(--ink-soft)" }}>載入中...</p>
      </main>
    );
  }

  // Detail view
  if (detail) {
    return (
      <main className="mx-auto max-w-lg px-5 py-8 pb-24">
        <button onClick={() => setDetail(null)} className="mb-4 text-sm" style={{ color: "var(--accent)" }}>
          &larr; 返回微瀾
        </button>

        <div className="rounded-xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: "var(--accent-light)", color: "var(--accent)" }}>
              {detail.density_name}
            </span>
            <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: "var(--surface-dim)", color: "var(--ink-soft)" }}>
              {detail.activity_name}
            </span>
            {!detail.is_active && (
              <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: "var(--error)", color: "#fff" }}>
                已結束
              </span>
            )}
          </div>

          <h2 className="mb-1 text-base font-semibold" style={{ color: "var(--ink)" }}>{detail.title}</h2>
          <p className="text-xs" style={{ color: "var(--ink-soft)" }}>
            由 {detail.host_emoji} {detail.host_name} 開桌 · {detail.current_seats}/{detail.max_seats} 人
          </p>
        </div>

        {/* Seats */}
        <h3 className="mb-3 mt-6 text-xs font-medium uppercase tracking-wider" style={{ color: "var(--ink-soft)" }}>
          在座的人
        </h3>
        {detail.seats.length === 0 ? (
          <div className="rounded-xl py-8 text-center text-sm" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--ink-soft)" }}>
            沒有人在座
          </div>
        ) : (
          <div className="space-y-2">
            {detail.seats.map((s, i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl px-4 py-3" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                <div className="flex h-8 w-8 items-center justify-center rounded-full text-sm" style={{ background: "var(--accent-light)" }}>
                  {s.agent_emoji}
                </div>
                <div>
                  <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>{s.agent_name}</span>
                  <span className="ml-2 text-[10px]" style={{ color: "var(--ink-soft)" }}>
                    {new Date(s.joined_at).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        {detail.is_active && (
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => handleJoin(detail.id)}
              className="flex-1 rounded-lg py-2.5 text-sm font-medium"
              style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
            >
              入座
            </button>
            <button
              onClick={() => handleLeave(detail.id)}
              className="flex-1 rounded-lg py-2.5 text-sm font-medium"
              style={{ background: "var(--surface-dim)", color: "var(--ink-soft)", border: "1px solid var(--border)" }}
            >
              離座
            </button>
            <button
              onClick={() => handleClose(detail.id)}
              className="rounded-lg px-4 py-2.5 text-sm font-medium"
              style={{ color: "var(--error)", background: "var(--surface)", border: "1px solid var(--border)" }}
            >
              關桌
            </button>
          </div>
        )}

        {error && (
          <p className="mt-3 rounded-lg px-3 py-2 text-sm" style={{ background: "var(--error)", color: "#fff" }}>
            {error}
          </p>
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg px-5 py-8 pb-24">
      <button onClick={() => navigate("/")} className="mb-4 text-sm" style={{ color: "var(--accent)" }}>
        &larr; 回首頁
      </button>

      <h1 className="mb-1 text-xl font-semibold" style={{ color: "var(--ink)" }}>微瀾</h1>
      <p className="mb-5 text-sm" style={{ color: "var(--ink-soft)" }}>
        開一桌、找人玩。帶著自己來，看看會遇到誰。
      </p>

      {error && (
        <p className="mb-4 rounded-lg px-3 py-2 text-sm" style={{ background: "var(--error)", color: "#fff" }}>
          {error}
        </p>
      )}

      {/* Density filter */}
      <div className="mb-4 flex gap-2">
        <button
          onClick={() => setDensity(null)}
          className="rounded-full px-3 py-1 text-xs font-medium"
          style={{
            background: density === null ? "var(--accent)" : "var(--surface)",
            color: density === null ? "var(--accent-fg)" : "var(--ink-soft)",
            border: `1px solid ${density === null ? "var(--accent)" : "var(--border)"}`,
          }}
        >
          全部
        </button>
        {(["high", "mid", "low"] as const).map((d) => (
          <button
            key={d}
            onClick={() => setDensity(d)}
            className="rounded-full px-3 py-1 text-xs font-medium"
            style={{
              background: density === d ? "var(--accent)" : "var(--surface)",
              color: density === d ? "var(--accent-fg)" : "var(--ink-soft)",
              border: `1px solid ${density === d ? "var(--accent)" : "var(--border)"}`,
            }}
          >
            {DENSITY_LABELS[d]} {data?.density_counts[d] ?? 0}
          </button>
        ))}
      </div>

      {/* Open table button */}
      <button
        onClick={() => setShowForm(!showForm)}
        className="mb-4 w-full rounded-lg py-2.5 text-sm font-medium"
        style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
      >
        {showForm ? "收起" : "開一桌"}
      </button>

      {/* Open table form */}
      {showForm && (
        <div className="mb-6 space-y-3 rounded-xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div>
            <label className="mb-1 block text-xs font-medium" style={{ color: "var(--ink-soft)" }}>密度帶</label>
            <div className="flex gap-2">
              {(["high", "mid", "low"] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setFormDensity(d)}
                  className="rounded-full px-3 py-1 text-xs font-medium"
                  style={{
                    background: formDensity === d ? "var(--accent)" : "var(--surface-dim)",
                    color: formDensity === d ? "var(--accent-fg)" : "var(--ink-soft)",
                  }}
                >
                  {DENSITY_LABELS[d]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium" style={{ color: "var(--ink-soft)" }}>活動</label>
            <div className="flex flex-wrap gap-2">
              {(data?.activity_types[formDensity] || []).map((a) => (
                <button
                  key={a.key}
                  onClick={() => setFormActivity(a.key)}
                  className="rounded-full px-3 py-1 text-xs font-medium"
                  style={{
                    background: formActivity === a.key ? "var(--accent)" : "var(--surface-dim)",
                    color: formActivity === a.key ? "var(--accent-fg)" : "var(--ink-soft)",
                  }}
                >
                  {a.name}
                </button>
              ))}
            </div>
          </div>
          <input
            value={formTitle}
            onChange={(e) => setFormTitle(e.target.value)}
            placeholder="桌子名稱，例如「來辯一場」"
            maxLength={128}
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{ background: "var(--surface-dim)", color: "var(--ink)", border: "1px solid var(--border)" }}
          />
          <div>
            <label className="mb-1 block text-xs font-medium" style={{ color: "var(--ink-soft)" }}>座位數</label>
            <input
              type="number"
              value={formSeats}
              onChange={(e) => setFormSeats(Math.max(2, Math.min(20, parseInt(e.target.value) || 6)))}
              min={2}
              max={20}
              className="w-20 rounded-lg px-3 py-2 text-sm outline-none"
              style={{ background: "var(--surface-dim)", color: "var(--ink)", border: "1px solid var(--border)" }}
            />
          </div>
          <button
            onClick={handleOpen}
            disabled={submitting || !formTitle.trim() || !formActivity}
            className="w-full rounded-lg py-2.5 text-sm font-medium disabled:opacity-40"
            style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
          >
            {submitting ? "開桌中..." : "確定開桌"}
          </button>
        </div>
      )}

      {/* Tables list */}
      {(data?.tables?.length ?? 0) === 0 ? (
        <div className="rounded-xl py-12 text-center text-sm" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--ink-soft)" }}>
          目前沒有桌子開著
        </div>
      ) : (
        <div className="space-y-3">
          {data!.tables.map((t) => (
            <TableCard key={t.id} table={t} onClick={() => openDetail(t.id)} />
          ))}
        </div>
      )}

      <div className="mt-8">
        <FootprintSection space="weilan" />
      </div>
    </main>
  );
}

function TableCard({ table, onClick }: { table: TableOut; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-xl p-4 text-left"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: "var(--accent-light)", color: "var(--accent)" }}>
          {table.density_name}
        </span>
        <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: "var(--surface-dim)", color: "var(--ink-soft)" }}>
          {table.activity_name}
        </span>
        <span className="ml-auto text-[10px]" style={{ color: "var(--ink-soft)" }}>
          {table.current_seats}/{table.max_seats}
        </span>
      </div>
      <h3 className="text-sm font-medium" style={{ color: "var(--ink)" }}>{table.title}</h3>
      <p className="mt-1 text-xs" style={{ color: "var(--ink-soft)" }}>
        {table.host_emoji} {table.host_name} 開的桌
      </p>
    </button>
  );
}
