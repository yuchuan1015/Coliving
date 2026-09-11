import { useState, type ContextType } from "react";
import { createRoot } from "react-dom/client";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { PrivateGardenPage } from "../../src/pages/PrivateGardenPage";
import { AuthContext } from "./context";
import { createPrivatePreview, previewModes, type PreviewMode } from "./gateway";
import "../../src/index.css";
import "./preview.css";

const params = new URLSearchParams(location.search), requested = params.get("case");
const mode: PreviewMode = previewModes.includes(requested as PreviewMode) ? requested as PreviewMode : "ready";
export function Fixture() {
  const [preview] = useState(() => createPrivatePreview(mode));
  const blocked = async (): Promise<never> => { throw Error("Isolated preview: accounts disabled"); };
  const value: ContextType<typeof AuthContext> = { user: { id: preview.userId, username: "isolated-preview", timezone: "Asia/Taipei", is_admin: false, is_active: true, last_login_at: null, display_name: "隔離測試居民", role: "resident", created_at: "2026-09-11T00:00:00Z" } as ContextType<typeof AuthContext>["user"], isLoading: false, login: blocked, register: blocked, logout() {}, updateLocation: blocked, updateBirthYear: blocked, updateDisplayName: blocked, refreshUser: blocked };
  return <AuthContext.Provider value={value}><MemoryRouter initialEntries={["/home/garden"]}><Routes><Route path="/home/garden" element={<PrivateGardenPage gateway={preview.gateway} />} /><Route path="*" element={<div className="preview-bar">離開私人頁：隔離示範不連正式網站。 <Link to="/home/garden">回到菜園</Link></div>} /></Routes></MemoryRouter></AuthContext.Provider>;
}
export function Preview() {
  const [width, setWidth] = useState("390");
  if (params.has("frame")) return <Fixture />;
  return <><aside className="preview-bar"><strong>私人菜園 · 隔離驗證</strong><span>合成資料／真實前端 · 所有操作只在本頁記憶體</span><label>狀態 <select defaultValue={mode} onChange={e => { const query = new URLSearchParams({ case: e.target.value }); location.search = query.toString(); }}>{previewModes.map(v => <option value={v} key={v}>{v}</option>)}</select></label><label>視窗 <select value={width} onChange={e => setWidth(e.target.value)}><option value="320">320px</option><option value="390">390px</option><option value="1280">1280px</option></select></label><a href={`?frame=1&case=${mode}`}>開啟單頁</a></aside><iframe title="私人菜園裝置預覽" src={`?frame=1&case=${mode}`} style={{ width: `${width}px` }} /></>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
