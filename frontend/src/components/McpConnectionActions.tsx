import { useState } from "react";
import type { McpKey } from "../types";
import "../mcp-keys.css";

type CopyField = "connect_url" | "claude_code_cmd";
const labels: Record<CopyField, string> = {
  connect_url: "連接器網址",
  claude_code_cmd: "Claude Code 指令",
};

export function McpConnectionActions({ connection, showUrl = false, disabled = false }: {
  connection: McpKey;
  showUrl?: boolean;
  disabled?: boolean;
}) {
  const [feedback, setFeedback] = useState("");
  const [manual, setManual] = useState<CopyField | null>(null);
  const [copying, setCopying] = useState(false);

  async function copy(field: CopyField) {
    const value = connection[field];
    if (!value || disabled || copying || connection.revoked_at) return;
    setFeedback("");
    setManual(null);
    setCopying(true);
    try {
      // Called directly from the user's tap, including on Safari.
      await navigator.clipboard.writeText(value);
      setFeedback(`已複製${labels[field]}`);
    } catch {
      setManual(field);
      setFeedback("未能自動複製，請長按下方文字選取、複製。");
    } finally {
      setCopying(false);
    }
  }

  // Even if a stale response contains credentials, revoked keys expose none.
  if (connection.revoked_at) return <p className="mcp-key-note">這把鑰匙已作廢，無法再連線。</p>;

  return <div className="mcp-connect">
    {showUrl && connection.connect_url && <label className="mcp-secret">
      連接器網址
      <textarea readOnly value={connection.connect_url} rows={3} spellCheck={false} autoComplete="off" onFocus={e => e.currentTarget.select()} />
    </label>}
    <div className="mcp-key-actions">
      {(["connect_url", "claude_code_cmd"] as const).map(field => <button key={field} type="button" disabled={disabled || copying || !connection[field]} onClick={() => copy(field)}>
        {field === "connect_url" ? "複製連接器網址" : "複製 Claude Code 指令"}
      </button>)}
    </div>
    {(!connection.connect_url || !connection.claude_code_cmd) && <p className="mcp-key-note">連線資料尚未齊全，請更新鑰匙清單。不必重新產生鑰匙。</p>}
    {feedback && <p className="mcp-key-note" role="status">{feedback}</p>}
    {manual && <label className="mcp-secret">
      手動複製{labels[manual]}
      <textarea readOnly value={connection[manual]} rows={4} spellCheck={false} autoComplete="off" onFocus={e => e.currentTarget.select()} />
    </label>}
  </div>;
}
