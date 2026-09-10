// Dev-only test fixture. This adapter intercepts every API request; no real account writes.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { AxiosError } from "axios";
import api from "../../src/api/client";
import { ArticlesField } from "../../src/fields/ContentFields";
import "../../src/index.css";
import "../../src/social.css";

type Scenario = "allowed" | "missing" | "minor" | "send" | "export";
let scenario: Scenario = "allowed";
let record: (request: string) => void = () => {};
api.defaults.adapter = async config => {
  const path = config.url ?? "";
  record(`${config.method?.toUpperCase()} ${path}`);
  const adult = path === "/adult" || path.startsWith("/spaces/adult/");
  const missing = scenario === "missing";
  const denied = missing || (scenario === "minor" && adult) || (scenario === "send" && config.method === "post") || (scenario === "export" && path.endsWith("/export"));
  const detail = missing || !adult ? "需要設定出生年份才能進入此區域" : "此區域僅限 18 歲以上使用者";
  if (denied) throw new AxiosError("Preview denial", "ERR_BAD_REQUEST", config, undefined, { config, status: 403, statusText: "Forbidden", headers: {}, data: config.responseType === "text" ? JSON.stringify({ detail }) : { detail } });
  const now = new Date().toISOString();
  let data: unknown;
  if (config.method === "get" && ["/adult", "/health-center"].includes(path)) data = { articles: [], category_counts: {}, user_tier: "teen", allowed_tiers: ["child", "teen"] };
  else if (config.method === "get" && path.endsWith("/present")) data = { present: [{ id: "demo-a", name: "星A", avatar_emoji: "✦" }] };
  else if (config.method === "get" && path.endsWith("/chat?limit=200")) data = { messages: [{ id: "demo-m", sender: "範例居民", sender_kind: "human", content: "這是一則不含真實居民資料的聊天範例。", mentions: ["星A"], created_at: now, expires_at: new Date(Date.now() + 7200000).toISOString() }] };
  else if (config.method === "get" && path.endsWith("/chat/export")) data = "# 本地聊天範例\n\n這份內容不是正式聊天紀錄。";
  else throw new AxiosError("Preview only", "ERR_BAD_REQUEST", config, undefined, { config, status: 400, statusText: "Preview only", headers: {}, data: { detail: "本地測試不送出任何真實訊息或資料。" } });
  return { config, status: 200, statusText: "OK", headers: {}, data };
};

export function Preview() {
  const [kind, setKind] = useState<"adult" | "health">("adult");
  const [mode, setMode] = useState<Scenario>("allowed");
  const [requests, setRequests] = useState<string[]>([]);
  useEffect(() => { record = request => setRequests(rows => [...rows, request]); return () => { record = () => {}; }; }, []);
  return <MemoryRouter><aside style={{ padding: 16, background: "#080618", color: "#ddd", display: "grid", gap: 12 }}>
    <strong>本地假資料測試 · 不連正式服務</strong>
    <label>場域 <select aria-label="測試場域" value={kind} onChange={e => { setRequests([]); setKind(e.target.value as typeof kind); }}><option value="adult">分級式人機親密關係中心</option><option value="health">健康中心</option></select></label>
    <label>情境 <select aria-label="測試情境" value={mode} onChange={e => { scenario = e.target.value as Scenario; setRequests([]); setMode(scenario); }}><option value="allowed">後端允許</option><option value="missing">後端：缺出生年</option><option value="minor">後端：未成年</option><option value="send">發送時 403</option><option value="export">匯出時 403</option></select></label>
    <details><summary>攔截請求紀錄（{requests.length}）</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{requests.join("\n") || "沒有請求"}</pre></details>
  </aside><ArticlesField key={`${kind}:${mode}`} kind={kind} /></MemoryRouter>;
}
const previewRoot = (import.meta.hot?.data.root as ReturnType<typeof createRoot> | undefined) ?? createRoot(document.getElementById("root")!);
if (import.meta.hot) import.meta.hot.data.root = previewRoot;
previewRoot.render(<Preview />);
