// Local navigation preview. No AuthProvider/network bootstrap or live account.
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthContext } from "../../src/contexts/AuthContext";
import { DashboardPage } from "../../src/pages/DashboardPage";
import { FrontierPage } from "../../src/pages/FrontierPage";
import { GardenPreview } from "./garden-preview";
import "./garden-preview.css";
import { LanguageDocument } from "../../src/i18n/LanguageControl";
import api from "../../src/api/client";
import type { UserMe } from "../../src/types";
import "../../src/index.css";

api.interceptors.request.clear();
api.interceptors.response.clear();
api.defaults.adapter = async () => { throw new Error("本地導覽預覽，不連接 API。"); };
const unavailable = async (): Promise<never> => { throw new Error("本地導覽預覽不提供帳號操作。"); };
const user: UserMe = { id: "frontier-preview", username: "preview", display_name: "範例旅人", role: "resident", created_at: "2026-09-11T00:00:00Z", is_active: true, last_login_at: null, coordinate: { l: 101.5, b: 11.08, r: 0 }, drifting: false };
const params = new URLSearchParams(location.search);
const page = params.get("page") === "outside" ? "/outside" : params.get("page") === "garden" ? "/frontier/garden" : "/frontier";

export function PreviewFrame() {
  const [width, setWidth] = useState("390");
  return <div style={{ minHeight: "100dvh", background: "#04090e", color: "#edf2f1", padding: 16 }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: 16, marginBottom: 16 }}>
      <span>本機預覽 · 未部署</span>
      <label>畫面寬度 <select value={width} onChange={event => setWidth(event.target.value)} style={{ background: "#0b171c", color: "#edf2f1", border: "1px solid #385b61", padding: 8 }}>
        <option value="390">手機 390px</option><option value="320">小手機 320px</option><option value="1280">桌面</option>
      </select></label>
    </div>
    <iframe title="Procyon 開荒畫面" src={`./index.html?embedded=1&page=${page === "/outside" ? "outside" : page === "/frontier/garden" ? "garden" : "frontier"}`}
      style={{ display: "block", width: Number(width), maxWidth: "100%", height: "calc(100dvh - 100px)", minHeight: 600, margin: "auto", border: "1px solid #385b61", borderRadius: 16 }} />
  </div>;
}

createRoot(document.getElementById("root")!).render(params.get("embedded") !== "1" ? <PreviewFrame /> : <AuthContext.Provider value={{ user, isLoading: false, login: unavailable, register: unavailable, logout: () => {}, updateLocation: unavailable, updateBirthYear: unavailable, refreshUser: async () => user, updateDisplayName: unavailable }}>
  <LanguageDocument /><MemoryRouter initialEntries={[page]}><Routes>
    <Route path="/outside" element={<DashboardPage />} />
    <Route path="/frontier" element={<FrontierPage />} />
    <Route path="/frontier/garden" element={<GardenPreview />} />
    <Route path="*" element={<main className="frontier-page"><p>此預覽只展示出艙目的地與 Procyon · 開荒。</p><Link to="/outside">← 返回目的地</Link></main>} />
  </Routes></MemoryRouter>
</AuthContext.Provider>);
