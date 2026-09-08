// Dev-only fixture harness, outside public/. No real auth or network requests.
import { createRoot } from "react-dom/client";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import api from "../../src/api/client";
import { AuthorizeRequest } from "../../src/pages/AuthorizePage";
import { McpWebConnection } from "../../src/components/McpWebConnection";
import { McpKeysPanel } from "../../src/components/McpKeysPanel";
import { OAuthGrantsPanel } from "../../src/components/OAuthGrantsPanel";
import "../../src/index.css";

api.defaults.adapter = async config => {
  if (config.method === "get" && config.url === "/oauth/requests/preview-request") return {
    config, status: 200, statusText: "OK", headers: {}, data: {
      request_id: "preview-request", client_name: "Claude", client_uri: null, logo_uri: null,
      redirect_host: "claude.ai", scopes: ["mcp"], agent_id: "preview-agent", agent_name: "範例室友",
      agent_avatar_emoji: "✦", agent_avatar_url: null, expires_at: new Date(Date.now() + 600000).toISOString(),
    },
  };
  if (config.method === "get" && config.url === "/oauth/grants") return { config, status: 200, statusText: "OK", headers: {}, data: [
    { id: "preview-grant", client_name: "Claude", client_uri: null, logo_uri: null, scope: "mcp", created_at: new Date().toISOString(), last_used_at: null, revoked_at: null },
    { id: "preview-revoked", client_name: "範例舊連線", client_uri: null, logo_uri: null, scope: "mcp", created_at: new Date().toISOString(), last_used_at: null, revoked_at: new Date().toISOString() },
  ] };
  if (config.method === "get" && config.url === "/agents/mine/mcp-tokens") return { config, status: 200, statusText: "OK", headers: {}, data: [
    { token_id: "preview-key", label: "CLI 範例鑰匙", created_at: new Date().toISOString(), last_used_at: null, revoked_at: null, connect_url: "https://example.invalid/mcp?token=DEMO_NOT_A_REAL_KEY", claude_code_cmd: "範例畫面，不提供可執行的真實鑰匙指令" },
  ] };
  throw { response: { status: 400, data: { detail: "這是介面預覽，沒有送出任何授權或網路請求。" } } };
};

createRoot(document.getElementById("root")!).render(<MemoryRouter>
  <aside style={{ padding: "8px 16px", background: "#080618", color: "#c9a7ff", fontSize: 14, textAlign: "center" }}>本地介面預覽 · 範例資料 · 不會授權或連線</aside>
  <nav style={{ display: "flex", justifyContent: "center", gap: 24, padding: 16, background: "#080618", color: "#c9a7ff" }}><Link to="/">同意頁</Link><Link to="/connections">連線與授權清單</Link></nav>
  <Routes>
    <Route path="/" element={<AuthorizeRequest requestId="preview-request" />} />
    <Route path="/connections" element={<main className="ya-agent-settings"><div style={{ display: "grid", gap: 24, maxWidth: 720, margin: "0 auto" }}><McpWebConnection /><OAuthGrantsPanel /><McpKeysPanel /></div></main>} />
  </Routes>
</MemoryRouter>);
