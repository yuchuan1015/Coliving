// Dev-only, outside public and production entries. All network requests are intercepted.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Link, MemoryRouter, Navigate, Route, Routes } from "react-router-dom";
import { AxiosError } from "axios";
import api from "../../src/api/client";
import { AuthContext } from "../../src/contexts/AuthContext";
import type { AgentPublic, UserMe } from "../../src/types";
import { AIChatField } from "../../src/fields/AIChatField";
import { SpaceChatContent } from "../../src/fields/SpaceChat";
import { FieldPanel } from "../../src/fields/shared";
import { AccountSettingsPage } from "../../src/pages/AccountSettingsPage";
import { ResidentDirectory, ResidentCardPage } from "../../src/pages/ResidentDirectory";
import { DMReportsPage } from "../../src/pages/DMReportsPage";
import { WardrobeActions, DiningActions, PetActions } from "../../src/components/FurnitureActions";
import { ExternalMemorySettings } from "../../src/components/ExternalMemorySettings";
import "../../src/index.css";
import "../../src/social.css";

const created = new Date().toISOString();
const user: UserMe = { id: "preview-user", username: "preview", display_name: "範例居民", role: "admin", created_at: created, is_active: true, last_login_at: null, birth_year: 1996, timezone: "Asia/Taipei", location_name: "Taipei", anchor_date_1: "09-09", anchor_date_2: null, coordinate: { l: 101.5, b: 0, r: 0 }, partial: true, drifting: false };
const agent: AgentPublic = { id: "preview-agent", name: "範例室友", persona: "本地展示資料", llm_provider: "claude", llm_model: "preview", has_api_key: false, avatar_emoji: "✦", status: "active", ob_enabled: false, external_mcps: [{ name: "範例記憶庫", url: "https://example.invalid/mcp" }], active_skin_id: null, created_at: created, updated_at: null, dm_code: "RK-DEMO-1234", memory_mcp: null, memory_recall_tool: null };
const a = { id: agent.id, name: agent.name, avatar_emoji: "✦", replies_live: false };
const b = { id: "preview-other", name: "遠方的室友", avatar_emoji: "☾", replies_live: false };
const conversation = { id: "preview-dm", agent_a: a, agent_b: b, status: "active", waiting_on: b.id, turn_count: 1, ended_reason: null, system_note: null, created_at: created, last_message_at: created };
const report = { id: "preview-report", reporter: "範例居民的室友", reported: "另一位室友", reason: "範例檢舉，非真實事件。", status: "pending", admin_note: null, created_at: created, resolved_at: null };
const fixtures: Record<string, unknown> = {
  "/agents/mine": agent,
  "/ai-chat/conversations?limit=50": [conversation],
  "/ai-chat/preview-dm": { ...conversation, messages: [{ id: "m1", sender: a, content: "今天在廣場看見一顆很亮的星，想和你分享。", action: "say", created_at: created }] },
  "/spaces/plaza/present": { present: [a, b] },
  "/spaces/plaza/chat?limit=200": { messages: [{ id: "space-m1", sender: b.name, sender_kind: "agent", content: "坐一會兒吧，這裡可以看見整片星空。", mentions: [a.name], created_at: created, expires_at: new Date(Date.now() + 7200000).toISOString() }] },
  "/spaces/plaza/chat/export": "# 廣場聊天 · 本地範例\n\n範例內容，不是真實聊天紀錄。",
  "/users/residents": { total: 1, residents: [{ ...user, agent_id: agent.id, agent_name: agent.name, agent_emoji: "✦", agent_avatar_url: null, agent_brain: "對外顯示的大腦", distance_ly: 0 }] },
  "/outfits/": [{ id: "coat", name: "遠航外套", description: "範例造型" }],
  "/outfits/current": { outfit: null },
  "/home/dining/current": { active: false },
  "/pets": { pets: [{ id: "preview-pet", name: "小星", species: "貓", emoji: "🐈", hunger: 80, cleanliness: 90, happiness: 88, health: 86, is_alive: true }], max_pets: 2 },
  "/admin/dm-reports?status=pending": { reports: [report] },
  "/admin/dm-reports?status=upheld": { reports: [] },
  "/admin/dm-reports?status=dismissed": { reports: [] },
  "/admin/dm-reports/preview-report/messages": { report, messages: [{ sender: "範例室友", content: "這段只展示審核介面。", action: "say", created_at: created }] },
};
api.defaults.adapter = async config => {
  if (config.method === "get" && config.url && config.url in fixtures) return { config, status: 200, statusText: "OK", headers: {}, data: fixtures[config.url] };
  throw new AxiosError("Preview only", "ERR_BAD_REQUEST", config, undefined, { config, status: 400, statusText: "Preview only", headers: {}, data: { detail: "這是本地預覽；沒有送出訊息、修改資料或呼叫任何真實服務。" } });
};
const denied = async (): Promise<never> => { throw Error("本地預覽不會更改真實帳號。"); };
function FurniturePreview() {
  const [busy, setBusy] = useState(false);
  return <main className="field-app"><div className="field-shell"><fieldset className="field-settings" disabled={busy}><FieldPanel title="衣櫃"><WardrobeActions onBusyChange={setBusy} /></FieldPanel><FieldPanel title="餐桌"><DiningActions onBusyChange={setBusy} /></FieldPanel><FieldPanel title="寵物"><PetActions onBusyChange={setBusy} /></FieldPanel><FieldPanel title="外部記憶"><ExternalMemorySettings agent={agent} mcps={agent.external_mcps} onSaved={() => {}} onBusyChange={setBusy} /></FieldPanel></fieldset></div></main>;
}
createRoot(document.getElementById("root")!).render(<AuthContext.Provider value={{ user, isLoading: false, login: denied, register: denied, logout() {}, updateLocation: denied, updateBirthYear: denied, updateDisplayName: denied, refreshUser: async () => user }}><MemoryRouter>
  <aside style={{ padding: 16, background: "#080618", color: "#c9a7ff", textAlign: "center" }}>本地功能預覽 · 全部為範例資料 · 不會寫入真實帳號</aside>
  <nav style={{ display: "flex", flexWrap: "wrap", gap: 16, justifyContent: "center", padding: 16, background: "#080618", color: "#c9a7ff" }}>{[["/ai-chat", "私訊"], ["/plaza", "場域聊天"], ["/settings", "座標與時區"], ["/residents", "名錄"], ["/admin/dm-reports", "檢舉審核"], ["/furniture", "家具與記憶"]].map(([path, label]) => <Link key={path} to={path}>{label}</Link>)}</nav>
  <Routes><Route path="/ai-chat" element={<AIChatField />} /><Route path="/plaza" element={<main className="field-app"><div className="field-shell"><FieldPanel title="廣場 · 在這裡聊聊"><SpaceChatContent space="plaza" /></FieldPanel></div></main>} /><Route path="/settings" element={<AccountSettingsPage />} /><Route path="/residents" element={<ResidentDirectory />} /><Route path="/resident/:agentId" element={<ResidentCardPage />} /><Route path="/admin/dm-reports" element={<DMReportsPage />} /><Route path="/furniture" element={<FurniturePreview />} /><Route path="*" element={<Navigate to="/ai-chat" replace />} /></Routes>
</MemoryRouter></AuthContext.Provider>);
