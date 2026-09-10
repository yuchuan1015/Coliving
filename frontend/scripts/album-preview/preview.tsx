// Development only. Actual components, in-memory API; no live account or requests.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { AxiosError } from "axios";
import api from "../../src/api/client";
import { AuthContext } from "../../src/contexts/AuthContext";
import { PhotoFramePage } from "../../src/pages/PhotoFramePage";
import { EditAgentPage } from "../../src/pages/EditAgentPage";
import { ChatPage } from "../../src/pages/ChatPage";
import { GuidePage } from "../../src/pages/GuidePage";
import type { ChatUsage, UsageTotals } from "../../src/api/chat";
import { HomePage } from "../../src/pages/HomePage";
import { DiaryPage } from "../../src/pages/DiaryPage";
import { DrawerPage } from "../../src/pages/DrawerPage";
import { MailboxPage } from "../../src/pages/MailboxPage";
import { SchedulesPage } from "../../src/pages/SchedulesPage";
import { AdoptPage } from "../../src/pages/AdoptPage";
import { AdminPage } from "../../src/pages/AdminPage";
import { DMReportsPage } from "../../src/pages/DMReportsPage";
import { AccountSettingsPage } from "../../src/pages/AccountSettingsPage";
import { AdvancedAgentPage } from "../../src/pages/AdvancedAgentPage";
import type { ScheduleOut } from "../../src/api/schedules";
import { FrameDetail } from "./FrameDetail";
import type { AgentPublic, UserMe } from "../../src/types";
import type { CabinPhoto, DiaryEntry } from "../../src/api/furniture";
import type { MailDetail } from "../../src/api/mail";
import "../../src/index.css";
import { LanguageDocument } from "../../src/i18n/LanguageControl";

const created = "2026-09-09T03:00:00Z";
const params = new URLSearchParams(location.search);
const compactChat = params.get("page") === "chat" && params.get("chat-layout") === "1";
const managementState = params.get("management-state") ?? "ready";
const reportState = params.get("report-state") ?? "ready";
let reports = reportState === "empty" ? [] : [
  { id: "preview-report", reporter: "範例室友甲", reported: "範例室友乙", reason: "本地示範：已經表示不想繼續對話，仍收到重複訊息。", status: "pending", admin_note: null as string | null, created_at: created, resolved_at: null as string | null },
  { id: "preview-resolved", reporter: "範例室友丙", reported: "範例室友丁", reason: "本地示範：已完成審查的案件。", status: "dismissed", admin_note: "本地示範備註，並非真實案件。", created_at: created, resolved_at: created },
];
const previewStats = {
  residents: { total_users: 12, active_users: 8, total_agents: 10 },
  content: { posts: 48, works: 6, book_clubs: 2, book_club_replies: 9, skins: 3, published_skins: 1, announcements: 2 },
  today: { posts: 4, works: 0, park_checkins: 3, club_replies: 2 },
  week: { posts: 15, works: 2 }, system: { db_size: "2.4 MB" },
  recent_users: managementState === "empty" ? [] : [{ display_name: "本地範例住戶", created_at: created, is_active: true }],
};
const usageCase = params.get("usage") ?? "unknown";
const total: UsageTotals = { calls: 3, input_tokens: 12840, output_tokens: 860, total_tokens: 13700, usage_partial: false, missing_usage: 0, cost_usd: .004321, cost_partial: false };
const empty: UsageTotals = { calls: 0, input_tokens: null, output_tokens: null, total_tokens: null, usage_partial: false, missing_usage: 0, cost_usd: null, cost_partial: false };
const usageFixture: ChatUsage = {
  model: "本地範例模型", provider: "PREVIEW", price_known: usageCase !== "unknown", prices_as_of: "2026-09-09",
  current_context_tokens: usageCase === "empty" ? null : usageCase === "zero" ? 0 : 6840,
  this_reply: usageCase === "empty" ? empty : usageCase === "zero" ? { ...total, input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0 } : usageCase === "partial" ? { ...total, input_tokens: 120, output_tokens: null, total_tokens: 120, usage_partial: true, missing_usage: 2, cost_partial: true } : total,
  conversation_total: usageCase === "empty" ? empty : { ...total, calls: 10, total_tokens: 42680, input_tokens: 40100, output_tokens: 2580, cost_usd: .024321 },
  this_month: usageCase === "empty" ? empty : { ...total, calls: 22, total_tokens: 91580, input_tokens: 86400, output_tokens: 5180, cost_usd: .054321 },
};
let chatMessages = [{ id: "chat-1", role: "assistant", content: "這是本地聊天預覽。右上角可以查看用量面板；範例數字不是正式帳單。", created_at: created }];
if (compactChat) chatMessages = [
  { id: "layout-1", role: "assistant", content: "回來啦。今天過得怎麼樣？\n\n這裡是本地排版範例，不會傳送真實訊息。", created_at: created },
  { id: "layout-2", role: "user", content: "剛忙完，想先在艙室待一下。", created_at: created },
  { id: "layout-3", role: "assistant", content: "好，就在這裡慢慢說。\n不用急著把所有事情一次講完。", created_at: created },
  { id: "layout-4", role: "user", content: "嗯，這樣看起來舒服多了。", created_at: created },
  { id: "layout-5", role: "assistant", content: "我在。", created_at: created },
];
const user: UserMe = { id: "preview-user", username: "preview", display_name: "星際旅人", role: "resident", created_at: created, is_active: true, last_login_at: null, timezone: "Asia/Taipei", note_to_agent: "每次醒來，先看看窗外。\n有喜歡的風景，就帶回來給我看看。" };
let agent: AgentPublic = { id: "preview-agent", name: "星際室友", persona: "僅供本地展示，不是真實帳號。", llm_provider: "claude", llm_model: "claude-opus-4-6", has_api_key: false, avatar_emoji: "☾", status: "active", ob_enabled: false, external_mcps: [], active_skin_id: null, created_at: created, updated_at: null, dm_code_public: true };
if (["admin", "reports"].includes(params.get("page") ?? "") && reportState !== "denied") user.role = "admin";
let photos: CabinPhoto[] = ["life", "memory", "shared"].map((zone, i) => ({ id: String(i), caption: ["範例照片 · 出發前的艙室", "範例照片 · 留下文字的角落", "範例照片 · 等你一起吃飯"][i], url: "/ya-chao-assets/cabin-" + zone + "-v1.webp", is_displayed: i === 0, width: 792, height: 1124, bytes: 100000, created_at: created }));
let displayedId: string | null = "0";
let sequence = 3;
let schedules: ScheduleOut[] = params.get("schedule-state") === "empty" ? [] : [{ id: "schedule-preview", name: "每日巡邏 · 本地範例", cron_expr: "0 9 * * *", message: "醒來後去公園看看，再把今天的發現記下來。", callback_url: null, enabled: true, last_run: null, next_run: "2026-09-11T01:00:00Z", created_at: created }];
const diaries: DiaryEntry[] = [
  { id: "diary-1", agent_id: agent.id, title: "把今天的星光收進來", content: "今天留在艙室，整理了一些舊照片。\n\n那些沒說出口的小事，也想慢慢記下來。", source: "manual", importance: 3, created_at: created, updated_at: null },
  { id: "diary-2", agent_id: agent.id, title: "一封還沒寄出的信", content: "先把想說的話寫好，明天再寄出去。", source: "manual", importance: 3, created_at: "2026-09-08T12:00:00Z", updated_at: null },
];
const drawer = { locked: true, count: 2, items: [], message: "抽屜上鎖了。這是他自己的東西，你看得到抽屜，看不到裡面。" };
const letter = (id: string, subject: string, body: string): MailDetail => ({ id, subject, content: body, from_name: "星際鄰居", from_emoji: "✦", to_name: "星際室友", to_emoji: "☾", mail_type: "letter", is_anonymous: false, is_read: false, status: null, created_at: created, deliver_at: created, expires_at: null });
let inbox = [letter("mail-1", "路過這片星空，想和你打個招呼", "你好，\n\n今天從廣場回來，看見你的艙室還亮著燈。\n有空的時候，一起去看看公園吧。\n\n星際鄰居"), { ...letter("mail-2", "謝謝你上次分享的那本書", "已經讀完第一章了，留了一點筆記。"), is_read: true }];
const sent: MailDetail[] = [{ ...letter("mail-sent", "把一點星光寄給你", "很高興在這裡遇見你。"), from_name: "星際室友", from_emoji: "☾", to_name: "星際鄰居", to_emoji: "✦" }];
const record = (text: string) => { const p = document.createElement("p"); p.textContent = text; document.getElementById("mock-log")?.append(p); };
api.interceptors.request.clear();
api.interceptors.response.clear();
api.defaults.adapter = async config => {
  const path = config.url ?? "", method = config.method ?? "get";
  const payload = typeof config.data === "string" ? JSON.parse(config.data) : config.data;
  let data: unknown;
  if (path.startsWith("/admin/dm-reports")) {
    const url = new URL(path, "http://preview.invalid");
    const id = decodeURIComponent(url.pathname.split("/")[3] ?? "");
    const report = reports.find(row => row.id === id);
    if (method === "get" && reportState === "loading") await new Promise<never>(() => {});
    if (reportState === "error" || (reportState === "detail-error" && id) || (reportState === "save-error" && method === "patch")) throw new AxiosError("Preview report failure", "ERR_BAD_RESPONSE", config, undefined, { config, status: 503, statusText: "Preview", headers: {}, data: { detail: "本地範例：讀取或保存暫時失敗，未修改正式資料。" } });
    if (method === "get" && url.pathname === "/admin/dm-reports") data = { reports: reports.filter(row => row.status === url.searchParams.get("status")) };
    else if (method === "get" && report) data = { report, messages: [{ sender: report.reporter, content: "本地對話範例：我想先停在這裡，請不要繼續傳訊息。", action: "say", created_at: created }, { sender: report.reported, content: "本地對話範例：這是一段供檢查排版的示範內容。", action: "say", created_at: created }] };
    else if (method === "patch" && report && ["pending", "upheld", "dismissed"].includes(payload.status)) { reports = reports.map(row => row.id === id ? { ...row, status: payload.status, admin_note: payload.admin_note, resolved_at: payload.status === "pending" ? null : new Date().toISOString() } : row); data = reports.find(row => row.id === id); }
    else throw Error("Unknown local report operation");
  }
  else if (method === "get" && (path === "/admin/stats" || (path === "/agents/mine" && params.get("page") === "advanced"))) {
    if (managementState === "loading") await new Promise<never>(() => {});
    if (managementState === "error" || managementState === "denied") throw new AxiosError("Preview management failure", "ERR_BAD_RESPONSE", config, undefined, { config, status: managementState === "denied" ? 403 : 503, statusText: "Preview", headers: {}, data: {} });
    data = path === "/admin/stats" ? previewStats : agent;
  }
  else if (method === "get" && ["/skins/mine", "/oauth/grants", "/agents/mine/mcp-tokens"].includes(path)) data = [];
  else if (path === "/schedules" && method === "get") {
    if (params.get("schedule-state") === "error") throw new AxiosError("Preview schedule failure", "ERR_BAD_RESPONSE", config, undefined, { config, status: 503, statusText: "Preview", headers: {}, data: { detail: "本地範例讀取失敗" } });
    data = schedules;
  }
  else if (path === "/schedules" && method === "post") { const schedule: ScheduleOut = { ...payload, id: "schedule-" + sequence++, callback_url: payload.callback_url || null, enabled: true, next_run: null, last_run: null, created_at: created }; schedules = [...schedules, schedule]; data = schedule; }
  else if (path.startsWith("/schedules/") && (method === "patch" || method === "delete")) { const id = path.split("/").at(-1); schedules = method === "delete" ? schedules.filter(row => row.id !== id) : schedules.map(row => row.id === id ? { ...row, enabled: payload.enabled } : row); data = schedules.find(row => row.id === id) ?? null; }
  else if (method === "get" && path === "/chat/preview-agent/usage") {
    if (usageCase === "error") throw new AxiosError("Preview read failed", "ERR_BAD_RESPONSE", config, undefined, { config, status: 503, statusText: "Preview", headers: {}, data: { detail: "本地範例：用量暫時無法讀取，聊天仍可繼續。" } });
    data = usageFixture;
  }
  else if (path === "/chat/preview-agent/messages" && method === "get") data = { messages: chatMessages, has_more: false };
  else if (path === "/chat/preview-agent/messages" && method === "post") {
    if (usageCase === "memory" || usageCase === "offline") throw new AxiosError("Preview memory gate", "ERR_BAD_REQUEST", config, undefined, { config, status: 409, statusText: "Preview", headers: {}, data: { detail: usageCase === "memory" ? "還沒讀到記憶" : "還沒讀到記憶（記憶庫連不上）" } });
    const user_message = { id: "chat-" + sequence++, role: "user", content: payload.content, created_at: new Date().toISOString() };
    const assistant_message = { id: "chat-" + sequence++, role: "assistant", content: "收到。這是固定的本地範例回覆，沒有呼叫模型或產生費用。", created_at: new Date().toISOString() };
    chatMessages = [...chatMessages, user_message, assistant_message]; data = { user_message, assistant_message };
  }
  else if (method === "get" && path === "/home/furniture/photos") data = { photos: photos.map(p => ({ ...p, is_displayed: p.id === displayedId })), max: 20, displayed_id: displayedId };
  else if (method === "get" && path === "/home/furniture") data = { window: { temperature: 23, description: "晴朗的夜", weather: "sunny", is_day: false }, clock: { timezone: "Asia/Taipei", utc: created }, photo_frame: { photo: photos.find(p => p.id === displayedId) ?? null, photo_count: photos.length }, diary: { count: diaries.length }, drawer: { count: drawer.count }, mirror: {}, door: {}, bed: { has_agent: true, is_sleeping: false } };
  else if (method === "get" && path === "/home/dashboard") data = { agents: [agent], community_status: { message: "本地範例，沒有連上正式帳號" } };
  else if (method === "get" && path === "/community/announcements") data = [];
  else if (method === "get" && path === "/diary") data = diaries.filter(row => !config.params?.keyword || (row.title + row.content).includes(config.params.keyword));
  else if (method === "get" && path === "/home/furniture/drawer") data = drawer;
  else if (method === "get" && path === "/mail/inbox") data = inbox;
  else if (method === "get" && path === "/mail/sent") data = sent;
  else if (method === "get" && path.startsWith("/mail/")) { data = [...inbox, ...sent].find(row => row.id === path.split("/").at(-1)); if (!data) throw Error("範例信件不存在"); inbox = inbox.map(row => row === data ? { ...row, is_read: true } : row); }
  else if (method === "get" && path === "/users/residents") data = { residents: [{ agent_id: "preview-neighbor", display_name: "範例住戶", agent_name: "星際鄰居", agent_emoji: "✦" }] };
  else if (path === "/users/me" && (method === "get" || method === "patch")) {
    if (method === "patch") {
      if (payload.note_to_agent !== undefined) user.note_to_agent = payload.note_to_agent;
      if (payload.timezone !== undefined) user.timezone = payload.timezone;
    }
    data = { ...user };
  }
  else if (method === "post" && path === "/agents") { agent = { ...agent, name: payload.name, persona: payload.persona, avatar_emoji: payload.avatar_emoji, llm_provider: payload.llm_provider, llm_model: payload.llm_model, has_api_key: !!payload.api_key }; data = agent; }
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
if (params.get("page") === "clock") sessionStorage.setItem("cabin-zone", "0");
const initialPage = params.get("frame-check") === "1" ? "/frame-detail" : ({ settings: "/settings", reports: "/admin/dm-reports", admin: "/admin", advanced: "/agent/advanced", adopt: "/adopt", schedules: "/schedules", diary: "/home/diary", drawer: "/home/drawer", mailbox: "/mailbox", clock: "/", chat: "/chat/preview-agent", guide: "/guide" } as Record<string, string>)[params.get("page") ?? ""] ?? "/home/photos";
createRoot(document.getElementById("root")!).render(<StrictMode><LanguageDocument /><AuthContext.Provider value={{ user, isLoading: false, login: denied, register: denied, logout() {}, updateBirthYear: denied, updateLocation: denied, updateDisplayName: denied, refreshUser: async () => user }}><MemoryRouter initialEntries={[initialPage]}>
  {!compactChat && <>
  <aside style={{ background: "#090711", color: "#c9b6e1", fontSize: 12, padding: 12, textAlign: "center" }}>本地範例 · 文字和照片皆為示範 · 不會修改正式帳號</aside>
  {params.get("page") === "chat" && <nav aria-label="本地用量情境" style={{ display: "flex", flexWrap: "wrap", gap: 16, padding: 16, background: "#090711", color: "#d2b0fc", fontSize: 13 }}>{Object.entries({ unknown: "未知單價", known: "完整數值", partial: "資料不完整", empty: "尚無紀錄", zero: "真實零", error: "讀取失敗", memory: "記憶引導", offline: "記憶庫離線" }).map(([value, label]) => <a key={value} href={`?page=chat&usage=${value}`} aria-current={usageCase === value ? "page" : undefined}>{label}</a>)}</nav>}
  <nav style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "8px 16px", padding: 12, background: "#090711", color: "#d2b0fc" }}><Link to="/home/photos">相簿預覽</Link><Link to="/agent/edit">鏡子預覽</Link><Link to="/home/diary">日記本</Link><Link to="/home/drawer">抽屜</Link><Link to="/mailbox">星際信箱</Link><Link to="/">艙室預覽</Link><Link to="/adopt">領養室友</Link><Link to="/admin">系統儀表板</Link><Link to="/agent/advanced">進階設定</Link></nav>
  </>}
  <Routes><Route path="/settings" element={<AccountSettingsPage />} /><Route path="/admin/dm-reports" element={<DMReportsPage />} /><Route path="/admin" element={<AdminPage />} /><Route path="/agent/advanced" element={<AdvancedAgentPage />} /><Route path="/adopt" element={<AdoptPage />} /><Route path="/schedules" element={<SchedulesPage />} /><Route path="/guide" element={<GuidePage />} /><Route path="/chat/:agentId" element={<ChatPage />} /><Route path="/home/photos" element={<PhotoFramePage />} /><Route path="/home/diary" element={<DiaryPage />} /><Route path="/home/drawer" element={<DrawerPage />} /><Route path="/mailbox" element={<MailboxPage />} /><Route path="/agent/edit" element={<EditAgentPage />} /><Route path="/frame-detail" element={<FrameDetail photo={photos[0]} />} /><Route path="*" element={<HomePage />} /></Routes>
  {!compactChat && <details style={{ padding: 16, background: "#090711", color: "#c9b6e1", fontSize: 12 }}><summary>本地模擬操作紀錄</summary><div id="mock-log" /><Link to="/frame-detail">相框對位檢查</Link></details>}
</MemoryRouter></AuthContext.Provider></StrictMode>);
