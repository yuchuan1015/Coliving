import { uiText } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import { useRef, useState } from "react";
import type { McpKey } from "../types";
import "../mcp-keys.css";

type CopyField = "connect_url" | "claude_code_cmd";
const labels: Record<CopyField, string> = {
  connect_url: "進階鑰匙網址",
  claude_code_cmd: "Claude Code 指令",
};

export function McpConnectionActions({ connection, disabled = false }: {
  connection: McpKey;
  disabled?: boolean;
}) {
  useUiLanguage();
  const [feedback, setFeedback] = useState("");
  const [manual, setManual] = useState<CopyField | null>(null);
  const [copying, setCopying] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const copyLock = useRef(false);

  async function copy(field: CopyField) {
    const value = connection[field];
    if (!value || disabled || copyLock.current || connection.revoked_at || (field === "connect_url" && !advanced)) return;
    copyLock.current = true;
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
      copyLock.current = false;
      setCopying(false);
    }
  }

  // Even if a stale response contains credentials, revoked keys expose none.
  if (connection.revoked_at) return <p className="mcp-key-note">{uiText("這把鑰匙已作廢，無法再連線。")}</p>;

  return <div className="mcp-connect">
    <div className="mcp-key-actions">
      <button type="button" disabled={disabled || copying || !connection.claude_code_cmd} onClick={() => copy("claude_code_cmd")}>{uiText("複製 Claude Code 指令")}</button>
    </div>
    <details className="mcp-advanced" onToggle={e => { setAdvanced(e.currentTarget.open); setManual(null); setFeedback(""); }}>
      <summary>{uiText("進階：不支援 OAuth 的客戶端")}</summary>
      {advanced && <><p className="mcp-key-note">{uiText("這個網址內含你的鑰匙，只供無法使用 OAuth 的相容客戶端。請勿公開、截圖分享或貼進聊天。")}</p>
        <button type="button" disabled={disabled || copying || !connection.connect_url} onClick={() => copy("connect_url")}>{uiText("複製進階鑰匙網址")}</button></>}
    </details>
    {(!connection.connect_url || !connection.claude_code_cmd) && <p className="mcp-key-note">{uiText("連線資料尚未齊全，請更新鑰匙清單。不必重新產生鑰匙。")}</p>}
    {feedback && <p className="mcp-key-note" role="status">{uiText(feedback)}</p>}
    {manual && <label className="mcp-secret">{uiText("手動複製")}{labels[manual]}
      <textarea readOnly value={connection[manual]} rows={4} spellCheck={false} autoComplete="off" onFocus={e => e.currentTarget.select()} />
    </label>}
  </div>;
}
