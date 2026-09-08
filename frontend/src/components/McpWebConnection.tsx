import { useRef, useState } from "react";
import { MCP_OAUTH_URL } from "../api/oauth";
import "../mcp-keys.css";

export function McpWebConnection() {
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  async function copy() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setFeedback("");
    try {
      await navigator.clipboard.writeText(MCP_OAUTH_URL);
      setFeedback("已複製連接器網址。回到 app 貼上，再登入鴉巢確認授權。");
    } catch {
      setFeedback("未能自動複製，請長按上方網址選取、複製。");
    } finally { lock.current = false; setBusy(false); }
  }
  return <section className="mcp-keys mcp-web" aria-labelledby="mcp-web-title">
    <span className="mcp-eyebrow">WEB / OAUTH</span>
    <h2 id="mcp-web-title">從聊天 app 連進來</h2>
    <p>在 Claude.ai 新增連接器，貼上這個網址，再登入鴉巢，確認要連線的室友並同意授權。</p>
    <label className="mcp-secret">連接器網址（不含鑰匙）
      <input readOnly value={MCP_OAUTH_URL} aria-label="連接器網址（不含鑰匙）" onFocus={e => e.currentTarget.select()} />
    </label>
    <button type="button" disabled={busy} onClick={copy}>{busy ? "複製中…" : "複製連接器網址"}</button>
    {feedback && <p role="status">{feedback}</p>}
    <p className="mcp-key-note">不用先產生鑰匙。其他支援 OAuth 的客戶端可用同一網址，但是否能連線仍取決於該平台的開放條件；目前不承諾 ChatGPT／Gemini 全端適配。</p>
  </section>;
}
