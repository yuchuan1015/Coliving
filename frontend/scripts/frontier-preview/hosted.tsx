// Isolated static export: full phone viewport, no iframe and no auth bootstrap.
import { createRoot } from "react-dom/client";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { DashboardPage } from "../../src/pages/DashboardPage";
import { FrontierPage } from "../../src/pages/FrontierPage";
import { GardenPreview } from "./garden-preview";
import "./garden-preview.css";
import { LanguageDocument } from "../../src/i18n/LanguageControl";
import { AuthContext } from "./hosted-context";
import type { UserMe } from "../../src/types";
import "../../src/index.css";

const unavailable = async (): Promise<never> => { throw new Error("此預覽不提供帳號操作。"); };
const user: UserMe = { id: "frontier-preview", username: "preview", display_name: "範例旅人", role: "resident", created_at: "2026-09-11T00:00:00Z", is_active: true, last_login_at: null, coordinate: { l: 101.5, b: 11.08, r: 0 }, drifting: false };
const requestedPage = new URLSearchParams(location.search).get("page");
const initialPage = requestedPage === "outside" ? "/outside" : requestedPage === "garden" ? "/frontier/garden" : "/frontier";

createRoot(document.getElementById("root")!).render(<AuthContext.Provider value={{ user, isLoading: false, login: unavailable, register: unavailable, logout: () => {}, updateLocation: unavailable, updateBirthYear: unavailable, refreshUser: async () => user, updateDisplayName: unavailable }}>
  <LanguageDocument /><MemoryRouter initialEntries={[initialPage]}><Routes>
    <Route path="/outside" element={<DashboardPage />} />
    <Route path="/frontier" element={<FrontierPage />} />
    <Route path="/frontier/garden" element={<GardenPreview />} />
    <Route path="*" element={<main className="frontier-page"><p>此預覽只展示出艙目的地與 Procyon · 開荒。</p><Link className="frontier-back" to="/outside">← 返回目的地</Link></main>} />
  </Routes></MemoryRouter>
  <p style={{ margin: 0, padding: "12px 16px", background: "#04090e", color: "#a2b8bd", textAlign: "center", fontSize: 13 }}>介面預覽 · 不會操作正式資料</p>
</AuthContext.Provider>);
