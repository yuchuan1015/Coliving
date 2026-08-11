import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FootprintSection } from "../components/FootprintSection";
import {
  ACTIVITY_LABELS,
  getPark,
  parkCheckin,
  SEASON_LABELS,
  type CheckinOut,
  type WeatherInfo,
} from "../api/park";

const WEATHER_BG: Record<string, string> = {
  sunny: "linear-gradient(135deg, #fff8e1 0%, #ffecb3 100%)",
  cloudy: "linear-gradient(135deg, #eceff1 0%, #cfd8dc 100%)",
  rainy: "linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%)",
  stormy: "linear-gradient(135deg, #cfd8dc 0%, #90a4ae 100%)",
  windy: "linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%)",
  foggy: "linear-gradient(135deg, #fafafa 0%, #e0e0e0 100%)",
};

export function ParkPage() {
  const navigate = useNavigate();
  const [weather, setWeather] = useState<WeatherInfo | null>(null);
  const [checkins, setCheckins] = useState<CheckinOut[]>([]);
  const [myCheckin, setMyCheckin] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadPark();
  }, []);

  async function loadPark() {
    try {
      const data = await getPark();
      setWeather(data.weather);
      setCheckins(data.checkins);
      setMyCheckin(data.my_checkin);
    } catch {
      setError("載入失敗");
    } finally {
      setLoading(false);
    }
  }

  async function handleCheckin(activity: string) {
    setChecking(true);
    setError("");
    try {
      await parkCheckin(activity);
      const data = await getPark();
      setWeather(data.weather);
      setCheckins(data.checkins);
      setMyCheckin(data.my_checkin);
    } catch (err: any) {
      setError(err.response?.data?.detail || "打卡失敗");
    } finally {
      setChecking(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-lg px-5 py-8">
        <p style={{ color: "var(--ink-soft)" }}>走進公園中...</p>
      </main>
    );
  }

  const activityMap = weather
    ? ACTIVITY_LABELS[weather.weather] || {}
    : {};

  return (
    <main className="mx-auto max-w-lg px-5 py-8 pb-24">
      <button
        onClick={() => navigate("/")}
        className="mb-4 text-sm"
        style={{ color: "var(--accent)" }}
      >
        &larr; 回首頁
      </button>

      {error && (
        <p
          className="mb-4 rounded-lg px-3 py-2 text-sm"
          style={{ background: "var(--error)", color: "#fff" }}
        >
          {error}
        </p>
      )}

      {/* Weather hero */}
      {weather && (
        <div
          className="mb-6 overflow-hidden rounded-2xl p-6"
          style={{
            background: WEATHER_BG[weather.weather] || WEATHER_BG.cloudy,
          }}
        >
          <div className="text-center">
            <div className="text-5xl">{weather.weather_emoji}</div>
            <div
              className="mt-2 text-2xl font-bold"
              style={{ color: "#37474f" }}
            >
              {weather.temperature}°C
            </div>
            <div
              className="mt-1 text-sm font-medium"
              style={{ color: "#546e7a" }}
            >
              {SEASON_LABELS[weather.season] || weather.season}
            </div>
            <p className="mt-3 text-sm" style={{ color: "#455a64" }}>
              {weather.description}
            </p>
          </div>
        </div>
      )}

      {/* Activity picker */}
      <section className="mb-6">
        <h2
          className="mb-3 text-xs font-medium uppercase tracking-wider"
          style={{ color: "var(--ink-soft)" }}
        >
          {myCheckin ? "換個活動？" : "今天想做什麼？"}
        </h2>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(activityMap).map(([key, label]) => {
            const isActive = myCheckin === key;
            return (
              <button
                key={key}
                disabled={checking}
                onClick={() => handleCheckin(key)}
                className="rounded-xl px-3 py-3 text-sm font-medium transition-all disabled:opacity-40"
                style={{
                  background: isActive ? "var(--accent)" : "var(--surface)",
                  color: isActive ? "var(--accent-fg)" : "var(--ink)",
                  border: `1px solid ${isActive ? "var(--accent)" : "var(--border)"}`,
                  transform: isActive ? "scale(0.97)" : "none",
                }}
              >
                {label}
                {isActive && " ✓"}
              </button>
            );
          })}
        </div>
      </section>

      {/* Today's scene */}
      <section>
        <h2
          className="mb-3 text-xs font-medium uppercase tracking-wider"
          style={{ color: "var(--ink-soft)" }}
        >
          今日公園 ({checkins.length})
        </h2>

        {checkins.length === 0 ? (
          <div
            className="flex items-center justify-center rounded-xl py-12"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
            }}
          >
            <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
              公園裡安安靜靜的，還沒有人來
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {checkins.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-3 rounded-xl px-4 py-3"
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                }}
              >
                <span className="text-lg">{c.agent_emoji}</span>
                <div className="min-w-0 flex-1">
                  <span
                    className="text-sm font-medium"
                    style={{ color: "var(--ink)" }}
                  >
                    {c.agent_name}
                  </span>
                  <span className="text-sm" style={{ color: "var(--ink-soft)" }}>
                    {" "}
                    正在{c.activity_label}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <FootprintSection space="park" />
    </main>
  );
}
