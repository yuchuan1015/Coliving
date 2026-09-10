// Development fixture only. Intercepts every request; never uses a real account.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { AxiosError } from "axios";
import api from "../../src/api/client";
import { ArticlesField } from "../../src/fields/ContentFields";
import { ContentReviewQueue } from "../../src/pages/ContentReviewsPage";
import { ResidentIdentity } from "../../src/pages/ResidentDirectory";
import { CabinUtilityShell } from "../../src/components/CabinUtilityShell";
import "../../src/index.css";
import "../../src/social.css";

type Scenario = "allowed" | "missing" | "minor" | "guidance12" | "guidance15" | "send" | "export";
let scenario: Scenario = "allowed", reviewed = false;
let record: (request: string) => void = () => {};
const options = [
  { value: "guidance12", name: "輔12", hint: "關係、界線、怎麼跟室友相處", min_age: 12 },
  { value: "guidance15", name: "輔15", hint: "比較深的情感依附、身體議題", min_age: 15 },
  { value: "restricted", name: "限制級", hint: "明確的性內容", min_age: 18 },
];
const note = "投稿要人工審核，大約三個工作天。審核的人會決定分級。";
const sample = { id: "demo", title: "關於彼此的界線（預覽）", category: "communication", category_name: "親密溝通", content: "這是非露骨的本地測試文章，不含真實居民資料。", author_name: "範例室友", age_tier: "guidance12", age_tier_name: "輔12", status: "published", created_at: "2026-09-10T00:00:00Z" };
api.defaults.adapter = async config => {
  const path = config.url ?? "", url = path.split("?")[0];
  record((config.method?.toUpperCase() || "GET") + " " + path);
  const adult = url.startsWith("/adult"), missing = scenario === "missing";
  const fail = (status: number, detail: string): never => { throw new AxiosError("Preview denial", "ERR_BAD_REQUEST", config, undefined, { config, status, statusText: "Preview", headers: {}, data: config.responseType === "text" ? JSON.stringify({ detail }) : { detail } }); };
  if (path.startsWith("/spaces/adult/")) fail(404, "分級式人機親密關係中心沒有公開聊天，這裡只能私訊");
  if ((adult || url.startsWith("/health-center") || path.startsWith("/spaces/health/")) && (missing || (scenario === "minor" && adult)))
    fail(403, missing ? "需要設定出生年份才能進入此區域" : "分級式人機親密關係中心最低是輔12，滿 12 歲才進得來");
  if ((scenario === "send" && config.method === "post") || (scenario === "export" && url.endsWith("/export"))) fail(403, "需要設定出生年份才能進入此區域");
  const allowed = options.slice(0, scenario === "guidance12" ? 1 : scenario === "guidance15" ? 2 : 3).map(t => t.value);
  let data: unknown;
  if (config.method === "get" && url === "/adult") data = { field_name: "分級式人機親密關係中心", articles: [sample], category_counts: { communication: 1 }, allowed_tiers: allowed, tiers: options.map(t => ({ ...t, allowed: allowed.includes(t.value) })), review_note: note };
  else if (config.method === "get" && url === "/adult/demo") data = sample;
  else if (config.method === "post" && url === "/adult/submit") data = { ...sample, status: "pending", message: "收到了，等人工審核，大約三個工作天。審核的人會決定分級。" };
  else if (config.method === "get" && url === "/health-center") data = { articles: [], category_counts: {}, user_tier: "teen", allowed_tiers: ["child", "teen"] };
  else if (config.method === "get" && url === "/review/pending") data = reviewed ? [] : [{ id: "review-demo", title: sample.title, content_type: "adult", status: "pending", submitter_name: sample.author_name, created_at: sample.created_at, reviewer_note: null }];
  else if (config.method === "get" && url === "/review/review-demo") data = { id: "review-demo", content_type: "adult", status: "pending", submitter_name: sample.author_name, content: { ...sample, type: "adult", tier_options: options } };
  else if (config.method === "post" && url === "/review/review-demo/decide") { reviewed = true; data = { status: "approved" }; }
  else if (config.method === "get" && path.endsWith("/present")) data = { present: [{ id: "demo-a", name: "星A", avatar_emoji: "✦" }] };
  else if (config.method === "get" && path.endsWith("/chat?limit=200")) data = { messages: [] };
  else if (config.method === "get" && path.endsWith("/chat/export")) data = "# 本地健康中心聊天範例";
  else fail(400, "本地預覽，不送出任何真實訊息或資料。");
  return { config, status: 200, statusText: "OK", headers: {}, data };
};

export function Preview() {
  const [kind, setKind] = useState<"adult" | "health" | "review" | "resident">("adult");
  const [mode, setMode] = useState<Scenario>("allowed");
  const [requests, setRequests] = useState<string[]>([]);
  useEffect(() => { record = request => setRequests(rows => [...rows, request]); return () => { record = () => {}; }; }, []);
  return <MemoryRouter><aside style={{ padding: 16, background: "#080618", color: "#ddd", display: "grid", gap: 12 }}>
    <strong>本地假資料預覽 · 不連正式服務</strong>
    <label>頁面 <select value={kind} onChange={e => { setRequests([]); reviewed = false; setKind(e.target.value as typeof kind); }}>
      <option value="adult">分級式人機親密關係中心</option><option value="health">健康中心</option><option value="review">管理員投稿審核</option><option value="resident">居民狀態牌</option>
    </select></label>
    <label>後端情境 <select value={mode} onChange={e => { scenario = e.target.value as Scenario; reviewed = false; setRequests([]); setMode(scenario); }}>
      <option value="allowed">全部分級允許</option><option value="guidance12">只允許輔12</option><option value="guidance15">允許輔12、輔15</option>
      <option value="missing">缺出生年</option><option value="minor">未滿12歲</option><option value="send">送出時403</option><option value="export">健康中心匯出403</option>
    </select></label>
    <details><summary>攔截請求紀錄（{requests.length}）</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{requests.join("\n") || "沒有請求"}</pre></details>
  </aside>
    {kind === "review" ? <CabinUtilityShell title="親密中心投稿審核" code="PREVIEW"><div className="dm-reports"><ContentReviewQueue key={mode} /></div></CabinUtilityShell>
      : kind === "resident" ? <main className="field-app"><section className="field-panel"><ResidentIdentity resident={{ id: "preview", username: "preview", display_name: "範例居民", role: "user", created_at: "", agent_id: "demo", agent_name: "範例室友", agent_emoji: "✦", agent_status_note: "在圖書館看書，晚點回來。" }} /></section></main>
      : <ArticlesField key={kind + ":" + mode} kind={kind} />}
  </MemoryRouter>;
}
const previewRoot = (import.meta.hot?.data.root as ReturnType<typeof createRoot> | undefined) ?? createRoot(document.getElementById("root")!);
if (import.meta.hot) import.meta.hot.data.root = previewRoot;
previewRoot.render(<Preview />);
