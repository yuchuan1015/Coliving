import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { AuthContext } from "../../src/contexts/AuthContext";
import { CabinPanelDialog } from "../../src/components/CabinPanelDialog";
import { PetWishesAdminPage } from "../../src/pages/PetWishesAdminPage";
import { createPetPreview } from "./gateway";
import api from "../../src/api/client";
import type { UserMe } from "../../src/types";
import "../../src/index.css";
import "../../src/cabin-home.css";

if (!import.meta.env.DEV) throw Error("Local pet preview only");
api.interceptors.request.clear(); api.interceptors.response.clear();
api.defaults.adapter = async () => { throw Error("Pet preview never accesses an API"); };
const user: UserMe = { id: "local-pet-preview", username: "preview", display_name: "本地範例", role: "resident", is_active: true, created_at: "2026-09-12T00:00:00Z", last_login_at: null };
const denied = async (): Promise<never> => { throw Error("Outside preview scope"); };
export function Preview() {
  const [open, setOpen] = useState(true), [gateway] = useState(() => createPetPreview(new URLSearchParams(location.search).get("case") ?? "ready"));
  const admin = new URLSearchParams(location.search).get("case") === "admin", identity = admin ? { ...user, id: "local-pet-admin", role: "admin" } : user;
  return <AuthContext.Provider value={{ user: identity, isLoading: false, login: denied, register: denied, logout() {}, updateLocation: denied, updateBirthYear: denied, updateDisplayName: denied, refreshUser: async () => identity }}><MemoryRouter>
    <main className="cabin-home" style={{ display: "block", padding: "24px", height: "100dvh" }}><p style={{ color: "var(--c-muted)", marginBottom: "24px" }}>本地合成範例 · 小麥與所有數值都不是正式寵物。照顧與領養只改這頁記憶體，重新整理即重設。</p><button type="button" onClick={() => setOpen(true)}>打開寵物</button>
      {admin ? <PetWishesAdminPage gateway={gateway.wishes} /> : open && <CabinPanelDialog panel="pet" summary={null} now={new Date()} petGateway={gateway} onClose={() => setOpen(false)} onRefreshWeather={async () => {}} />}
    </main>
  </MemoryRouter></AuthContext.Provider>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
