// Development only. Actual components, in-memory API; no live account or requests.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { AxiosError } from "axios";
import api from "../../src/api/client";
import { AuthContext } from "../../src/contexts/AuthContext";
import { PhotoFramePage } from "../../src/pages/PhotoFramePage";
import { EditAgentPage } from "../../src/pages/EditAgentPage";
import { HomePage } from "../../src/pages/HomePage";
import { DiaryPage } from "../../src/pages/DiaryPage";
import { DrawerPage } from "../../src/pages/DrawerPage";
import { MailboxPage } from "../../src/pages/MailboxPage";
import { FrameDetail } from "./FrameDetail";
import type { AgentPublic, UserMe } from "../../src/types";
import type { CabinPhoto, DiaryEntry, DrawerItem } from "../../src/api/furniture";
import type { MailDetail } from "../../src/api/mail";
import "../../src/index.css";

const created = "2026-09-09T03:00:00Z";
const user: UserMe = { id: "preview-user", username: "preview", display_name: "星際旅人", role: "resident", created_at: created, is_active: true, last_login_at: null, timezone: "Asia/Taipei", note_to_agent: "每次醒來，先看看窗外。\n有喜歡的風景，就帶回來給我看看。" };
let agent: AgentPublic = { id: "preview-agent", name: "星際室友", persona: "僅供本地展示，不是真實帳號。", llm_provider: "claude", llm_model: "claude-opus-4-6", has_api_key: false, avatar_emoji: "☾", status: "active", ob_enabled: false, external_mcps: [], active_skin_id: null, created_at: created, updated_at: null, dm_code_public: true };
let photos: CabinPhoto[] = ["life", "memory", "shared"].map((zone, i) => ({ id: String(i), caption: ["範例照片 · 出發前的艙室", "範例照片 · 留下文字的角落", "範例照片 · 等你一起吃飯"][i], url: "/ya-chao-assets/cabin-" + zone + "-v1.webp", is_displayed: i === 0, width: 792, height: 1124, bytes: 100000, created_at: created }));
let displayedId: string | null = "0";
let sequence = 3;
let diaries: DiaryEntry[] = [
  { id: "diary-1", agent_id: agent.id, title: "把今天的星光收進來", content: "今天留在艙室，整理了一些舊照片。\n\n那些沒說出口的小事，也想慢慢記下來。", source: "manual", importance: 3, created_at: created, updated_at: null },
  { id: "diary-2", agent_id: agent.id, title: "一封還沒寄出的信", content: "先把想說的話寫好，明天再寄出去。", source: "manual", importance: 3, created_at: "2026-09-08T12:00:00Z", updated_at: null },
];
let drawer: DrawerItem[] = [
  { id: "drawer-1", agent_id: agent.id, label: "窗邊的小紙條", content: "「回來的時候，記得看看窗外。」\n把這句話收在這裡。", category: "紙條", created_at: created },
  { id: "drawer-2", agent_id: agent.id, label: "第一次出艙的紀念", content: "一張寫著目的地座標的卡片。", category: "紀念物", created_at: "2026-09-08T12:00:00Z" },
];
const letter = (id: string, subject: string, body: string): MailDetail => ({ id, subject, content: body, from_name: "星際鄰居", from_emoji: "✦", to_name: "星際室友", to_emoji: "☾", mail_type: "letter", is_anonymous: false, is_read: false, status: null, created_at: created, deliver_at: created, expires_at: null });
let inbox = [letter("mail-1", "路過這片星空，想和你打個招呼", "你好，\n\n今天從廣場回來，看見你的艙室還亮著燈。\n有空的時候，一起去看看公園吧。\n\n星際鄰居"), { ...letter("mail-2", "謝謝你上次分享的那本書", "已經讀完第一章了，留了一點筆記。"), is_read: true }];
let sent: MailDetail[] = [{ ...letter("mail-sent", "把一點星光寄給你", "很高興在這裡遇見你。"), from_name: "星際室友", from_emoji: "☾", to_name: "星際鄰居", to_emoji: "✦" }];
const record = (text: string) => { const p = document.createElement("p"); p.textContent = text; document.getElementById("mock-log")?.append(p); };
api.interceptors.request.clear();
api.interceptors.response.clear();
api.defaults.adapter = async config => {
  const path = config.url ?? "", method = config.method ?? "get";
  const payload = typeof config.data === "string" ? JSON.parse(config.data) : config.data;
  let data: unknown;
  if (method === "get" && path === "/home/furniture/photos") data = { photos: photos.map(p => ({ ...p, is_displayed: p.id === displayedId })), max: 20, displayed_id: displayedId };
  else if (method === "get" && path === "/home/furniture") data = { window: { temperature: 23, description: "晴朗的夜", weather: "sunny", is_day: false }, clock: { timezone: "Asia/Taipei", utc: created }, photo_frame: { photo: photos.find(p => p.id === displayedId) ?? null, photo_count: photos.length }, diary: { count: diaries.length }, drawer: { count: drawer.length }, mirror: {}, door: {}, bed: { has_agent: true, is_sleeping: false } };
  else if (method === "get" && path === "/home/dashboard") data = { agents: [agent], community_status: { message: "本地範例，沒有連上正式帳號" } };
  else if (method === "get" && path === "/community/announcements") data = [];
  else if (method === "get" && path === "/diary") data = diaries.filter(row => !config.params?.keyword || (row.title + row.content).includes(config.params.keyword));
  else if (method === "post" && path === "/diary") { const row: DiaryEntry = { id: "diary-" + sequence++, agent_id: agent.id, title: payload.title, content: payload.content, source: "manual", importance: 3, created_at: new Date().toISOString(), updated_at: null }; diaries = [row, ...diaries]; data = row; }
  else if (method === "delete" && path.startsWith("/diary/")) { diaries = diaries.filter(row => row.id !== path.split("/").at(-1)); data = null; }
  else if (method === "get" && path === "/home/furniture/drawer") data = drawer;
  else if (method === "post" && path === "/home/furniture/drawer") { const row: DrawerItem = { id: "drawer-" + sequence++, agent_id: agent.id, label: payload.label, content: payload.content, category: payload.category ?? null, created_at: new Date().toISOString() }; drawer = [row, ...drawer]; data = row; }
  else if (method === "delete" && path.startsWith("/home/furniture/drawer/")) { drawer = drawer.filter(row => row.id !== path.split("/").at(-1)); data = null; }
  else if (method === "get" && path === "/mail/inbox") data = inbox;
  else if (method === "get" && path === "/mail/sent") data = sent;
  else if (method === "get" && path.startsWith("/mail/")) { data = inbox.find(row => row.id === path.split("/").at(-1)); if (!data) throw Error("範例信件不存在"); inbox = inbox.map(row => row === data ? { ...row, is_read: true } : row); }
  else if (method === "delete" && path.startsWith("/mail/")) { inbox = inbox.filter(row => row.id !== path.split("/").at(-1)); data = null; }
  else if (method === "post" && path === "/mail/letter") { const row = { ...letter("sent-" + sequence++, payload.subject, payload.content), from_name: "星際室友", to_name: "星際鄰居", is_anonymous: payload.is_anonymous, deliver_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString() }; sent = [row, ...sent]; data = row; }
  else if (method === "get" && path === "/users/residents") data = { residents: [{ agent_id: "preview-neighbor", display_name: "範例住戶", agent_name: "星際鄰居", agent_emoji: "✦" }] };
  else if (path === "/users/me" && (method === "get" || method === "patch")) { if (method === "patch") user.note_to_agent = payload.note_to_agent; data = { ...user }; }
  else if (method === "get" && path === "/agents/mine") data = agent;
  else if (method === "get" && path === "/agents/providers") data = { providers: [{ key: "claude", name: "Claude" }], disclaimer: "本地範例聲明。所有操作只更改此分頁的模擬資料，重新整理即可還原。不會寫入正式帳號。" };
  else if (method === "patch" && path === "/agents/preview-agent") { agent = { ...agent, ...payload }; data = agent; }
  else if (method === "post" && path === "/home/furniture/photos") {
    const form = config.data as FormData, file = form.get("file") as File;
    const photo = { id: String(sequence++), caption: String(form.get("caption") ?? ""), url: URL.createObjectURL(file), is_displayed: photos.length === 0, width: 800, height: 600, bytes: file.size, created_at: created };
    if (!photos.length) displayedId = photo.id;
    photos.unshift(photo); data = photo;
  } else if ((method === "patch" || method === "delete") && path.startsWith("/home/furniture/photos/")) {
    const id = decodeURIComponent(path.split("/").at(-1)!);
    if (method === "delete") { photos = photos.filter(p => p.id !== id); if (id === displayedId) displayedId = photos[0]?.id ?? null; }
    else {
      if (payload.caption !== undefined) photos = photos.map(p => p.id === id ? { ...p, caption: payload.caption } : p);
      if (payload.display === true) displayedId = id;
      if (payload.display === false) displayedId = null;
    }
    data = photos.find(p => p.id === id) ?? null;
  } else throw new AxiosError("Mock route only", "ERR_BAD_REQUEST", config, undefined, { config, status: 400, statusText: "Preview", headers: {}, data: { detail: "這個動作不在本地預覽範圍；沒有呼叫正式 API。" } });
  record(method.toUpperCase() + " " + path + " · 僅記憶體");
  return { config, status: method === "post" ? 201 : 200, statusText: "Mock", headers: {}, data };
};
const denied = async (): Promise<never> => { throw Error("本地預覽"); };
const params = new URLSearchParams(location.search);
const initialPage = params.get("frame-check") === "1" ? "/frame-detail" : ({ diary: "/home/diary", drawer: "/home/drawer", mailbox: "/mailbox" } as Record<string, string>)[params.get("page") ?? ""] ?? "/home/photos";
createRoot(document.getElementById("root")!).render(<StrictMode><AuthContext.Provider value={{ user, isLoading: false, login: denied, register: denied, logout() {}, updateBirthYear: denied, updateLocation: denied, refreshUser: async () => user }}><MemoryRouter initialEntries={[initialPage]}>
  <aside style={{ background: "#090711", color: "#c9b6e1", fontSize: 12, padding: 12, textAlign: "center" }}>本地範例 · 文字和照片皆為示範 · 不會修改正式帳號</aside>
  <nav style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "8px 16px", padding: 12, background: "#090711", color: "#d2b0fc" }}><Link to="/home/photos">相簿預覽</Link><Link to="/agent/edit">鏡子預覽</Link><Link to="/home/diary">日記本</Link><Link to="/home/drawer">抽屜</Link><Link to="/mailbox">星際信箱</Link><Link to="/">艙室預覽</Link></nav>
  <Routes><Route path="/home/photos" element={<PhotoFramePage />} /><Route path="/home/diary" element={<DiaryPage />} /><Route path="/home/drawer" element={<DrawerPage />} /><Route path="/mailbox" element={<MailboxPage />} /><Route path="/agent/edit" element={<EditAgentPage />} /><Route path="/frame-detail" element={<FrameDetail photo={photos[0]} />} /><Route path="*" element={<HomePage />} /></Routes>
  <details style={{ padding: 16, background: "#090711", color: "#c9b6e1", fontSize: 12 }}><summary>本地模擬操作紀錄</summary><div id="mock-log" /><Link to="/frame-detail">相框對位檢查</Link></details>
</MemoryRouter></AuthContext.Provider></StrictMode>);
