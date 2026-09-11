// Isolated composition of the real pages. Never imported by src/main.tsx.
// The in-memory adapter cannot reach the API; writes reject without storing data.
import { createRoot } from "react-dom/client";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthContext } from "../../src/contexts/AuthContext";
import { HomePage } from "../../src/pages/HomePage";
import { CabinPanelDialog } from "../../src/components/CabinPanelDialog";
import { LoginPage } from "../../src/pages/LoginPage";
import api from "../../src/api/client";
import type { UserMe } from "../../src/types";
import "../../src/index.css";

if (!import.meta.env.DEV && import.meta.env.MODE !== "cabin-preview") throw new Error("This entry is only for isolated previews.");

const stamp = "2026-09-08T15:52:00Z";
const user: UserMe = {
  id: "local-preview-user", username: "preview", display_name: "預覽住戶",
  role: "resident", is_active: true, created_at: stamp, last_login_at: null,
  timezone: "Asia/Taipei", birth_year: 1995, location_name: "台北",
};
const agent = {
  id: "local-preview-agent", user_id: user.id, name: "宋祈言", avatar_emoji: "🐻",
  avatar_url: null, persona: "", llm_provider: "claude", llm_model: "preview-only",
  status: "active", external_mcps: [], created_at: stamp,
};
const fixture: Record<string, unknown> = {
  "/home/dashboard": { user, agents: [agent], community_status: { message: "歡迎來到共居社區" }, resident_count: 1, spaces: [] },
  "/home/furniture": {
    window: { description: "晴朗的夜", temperature: 23, weather: "sunny", is_day: false, location: "台北", source: "local", wind_kmh: 3 },
    clock: { utc: stamp, timezone: "Asia/Taipei", community_timezone: "Asia/Taipei" },
    diary: { count: 0 }, drawer: { count: 0 }, photo_frame: { count: 0 },
    mirror: { agent_name: agent.name, avatar_emoji: agent.avatar_emoji },
    door: { current_location: "艙室" }, bed: { has_agent: true, is_sleeping: false },
  },
  "/announcements": [{ id: "local-notice", title: "歡迎來到共居社區", content: "", created_at: stamp }],
  "/agents/mine": agent,
  "/users/me": user,
  "/outfits/": [],
  "/outfits/current": { outfit: null },
  "/home/dining/current": { active: false },
  "/pets": { pets: [{ id: "preview-pet", name: "小麥", species: "貓", emoji: "🐈", hunger: 63, cleanliness: 82, happiness: 76, health: 73.7, is_alive: true, age_days: 12 }], max_pets: 1 },
};
const readOnly = async (): Promise<never> => {
  throw { isAxiosError: true, response: { status: 405, data: { detail: "這是配色預覽，不會登入或保存資料。" } } };
};
api.defaults.adapter = async config => {
  config.headers.delete("Authorization");
  if ((config.method ?? "get").toLowerCase() !== "get") return readOnly();
  const path = config.url?.split("?")[0] ?? "";
  if (!(path in fixture)) throw new Error("This endpoint is outside the local palette preview.");
  return { data: structuredClone(fixture[path]), status: 200, statusText: "Local fixture", headers: {}, config };
};
const screen = new URLSearchParams(location.search).get("screen");
const start = screen === "login" ? "/login" : screen === "dining" ? "/dining" : screen === "pet" ? "/pet" : "/";
createRoot(document.getElementById("root")!).render(
  <AuthContext.Provider value={{
    user, isLoading: false, login: readOnly, register: readOnly, logout() {},
    updateLocation: readOnly, updateBirthYear: readOnly, updateDisplayName: readOnly, refreshUser: async () => user,
  }}>
    <MemoryRouter initialEntries={[start]}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dining" element={<div className="cabin-home"><CabinPanelDialog panel="dining" summary={null} now={new Date(stamp)} onClose={() => { location.search = ""; }} onRefreshWeather={async () => {}} /></div>} />
        <Route path="/pet" element={<div className="cabin-home"><CabinPanelDialog panel="pet" summary={null} now={new Date(stamp)} petGateway={{ list: async () => structuredClone(fixture["/pets"]), adopt: readOnly, interact: readOnly }} onClose={() => { location.search = ""; }} onRefreshWeather={async () => {}} /></div>} />
        <Route path="*" element={<main className="ya-auth-page"><section className="ya-auth-card"><p>這個入口已連結；配色預覽不會開啟真實資料。</p><Link className="ya-module-back" to="/">返回艙室</Link></section></main>} />
      </Routes>
    </MemoryRouter>
  </AuthContext.Provider>,
);
