import { useState, type ContextType } from "react";
import { createRoot } from "react-dom/client";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { PrivateGardenPage } from "../../src/pages/PrivateGardenPage";
import { AuthContext } from "./context";
import { createPrivatePreview, previewModes, type PreviewMode } from "./gateway";
import "../../src/index.css";
import "./hosted.css";

const choices: [PreviewMode, string][] = [["ready", "成熟可偷菜"], ["growing", "生長中"], ["four-plots", "四塊田示意"], ["own-proposal", "我提出的挖除"], ["agent-proposal", "室友提出的挖除"], ["harvested", "室友採收後"], ["fractions", "雙方倉庫示意"]];
function GardenCase({ mode }: { mode: PreviewMode }) {
  const [preview] = useState(() => createPrivatePreview(mode));
  const blocked = async (): Promise<never> => { throw Error("Preview accounts disabled"); };
  const value: ContextType<typeof AuthContext> = { user: { id: preview.userId, username: "isolated-preview", timezone: "Asia/Taipei", is_admin: false, is_active: true, last_login_at: null, display_name: "示範居民", role: "resident", created_at: "2026-09-11T00:00:00Z" } as ContextType<typeof AuthContext>["user"], isLoading: false, login: blocked, register: blocked, logout() {}, updateLocation: blocked, updateBirthYear: blocked, updateDisplayName: blocked, refreshUser: blocked };
  return <AuthContext.Provider value={value}><MemoryRouter initialEntries={["/home/garden"]}><Routes><Route path="/home/garden" element={<PrivateGardenPage gateway={preview.gateway} />} /><Route path="*" element={<main className="hosted-away"><p>這裡只展示私人菜園，其他場域請回鴉巢正式站查看。</p><Link to="/home/garden">← 回到菜園預覽</Link></main>} /></Routes></MemoryRouter></AuthContext.Provider>;
}
function HostedGarden() {
  const requested = new URLSearchParams(location.search).get("case") as PreviewMode;
  const [mode, setMode] = useState<PreviewMode>(() => previewModes.includes(requested) ? requested : "ready");
  return <><aside className="hosted-note"><span>私人菜園預覽 · 示範資料</span><label>查看狀態<select value={mode} onChange={e => setMode(e.target.value as PreviewMode)}>{!choices.some(([v]) => v === mode) && <option value={mode}>{mode}</option>}{choices.map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label><small>這裡的操作不會影響正式農田。</small></aside><GardenCase key={mode} mode={mode} /></>;
}
createRoot(document.getElementById("root")!).render(<HostedGarden />);
