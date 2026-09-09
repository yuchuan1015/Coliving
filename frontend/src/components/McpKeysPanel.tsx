import { uiText, getUiLanguage } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import { useEffect, useRef, useState } from "react";
import { generateMcpToken, listMcpTokens, revokeMcpToken } from "../api/agents";
import type { McpKey } from "../types";
import { McpConnectionActions } from "./McpConnectionActions";
import "../mcp-keys.css";

function keyTime(value?: string | null) {
  if (!value) return "尚未使用";
  const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`);
  return Number.isNaN(date.getTime()) ? "時間未提供" : date.toLocaleString(getUiLanguage());
}

function detail(error: unknown, fallback: string) {
  const message = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof message === "string" ? message : fallback;
}

export function McpKeysPanel() {
  useUiLanguage();
  const [keys, setKeys] = useState<McpKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [label, setLabel] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const writeLock = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    listMcpTokens(controller.signal).then(rows => {
      if (!controller.signal.aborted) setKeys(rows);
    }).catch(error => {
      if (!controller.signal.aborted) setError(detail(error, "無法讀取鑰匙，請再試一次。"));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [revision]);

  async function generate() {
    if (!label.trim() || label.trim().length > 32 || loading || writeLock.current) return;
    writeLock.current = true;
    setPending("generate");
    setError("");
    setNotice("");
    try {
      const key = await generateMcpToken(label.trim());
      setKeys(rows => [key, ...rows.filter(row => row.token_id !== key.token_id)]);
      setLabel("");
      setNotice("鑰匙已建立，可以直接複製連線資料；下次回來仍能複製。");
    } catch (error) {
      setError(detail(error, "未能確認鑰匙是否建立，請先更新清單確認，避免重複產生。"));
    } finally {
      writeLock.current = false;
      setPending(null);
    }
  }

  async function revoke(key: McpKey) {
    if (confirmId !== key.token_id || loading || writeLock.current) return;
    writeLock.current = true;
    setPending(key.token_id);
    setError("");
    setNotice("");
    try {
      await revokeMcpToken(key.token_id);
      // Discard credentials immediately, not just hide the copy buttons.
      setKeys(rows => rows.map(row => row.token_id === key.token_id ? {
        token_id: row.token_id, label: row.label, created_at: row.created_at,
        last_used_at: row.last_used_at, revoked_at: new Date().toISOString(),
      } : row));
      setConfirmId(null);
      setNotice(`「${key.label || "未命名鑰匙"}」已作廢。`);
    } catch (error) {
      setError(detail(error, "未能確認作廢結果，請更新清單確認。"));
    } finally {
      writeLock.current = false;
      setPending(null);
    }
  }

  return <section className="mcp-keys" aria-labelledby="mcp-keys-title">
    <div className="mcp-key-heading">
      <h2 id="mcp-keys-title">{uiText("CLI 與進階鑰匙")}</h2>
      <button type="button" disabled={loading || !!pending} onClick={() => {
        setLoading(true); setKeys([]); setError("");
        setConfirmId(null); setNotice(""); setRevision(n => n + 1);
      }}>{uiText("更新清單")}</button>
    </div>
    <p>{uiText("給 Claude Code 等客戶端使用。現有鑰匙可以重複複製，不必每次產生新的；網頁連接器請優先使用上方的登入授權。")}</p>
    <p className="mcp-key-note">{uiText("指令與進階網址內含你的鑰匙，請勿公開、截圖分享或貼進聊天。Claude Code 指令目前依客戶端的預設專案範圍設定，不保證所有專案共用。")}</p>
    {loading && <p role="status">{uiText("正在讀取鑰匙…")}</p>}
    {error && <p role="alert">{uiText(error)}</p>}
    {notice && <p role="status">{uiText(notice)}</p>}
    {!loading && !error && keys.length === 0 && <p>{uiText("還沒有鑰匙。可以在下方命名並建立第一把。")}</p>}
    {!loading && <div className="mcp-key-list">{keys.map(key => <article className="mcp-key-row" key={key.token_id}>
      <h3>{key.label || uiText("未命名鑰匙")}{key.revoked_at ? uiText(" · 已作廢") : ""}</h3>
      <dl className="mcp-key-dates">
        <div><dt>{uiText("建立時間")}</dt><dd>{key.created_at ? keyTime(key.created_at) : uiText("剛剛建立")}</dd></div>
        <div><dt>{uiText("最後使用")}</dt><dd>{keyTime(key.last_used_at)}</dd></div>
      </dl>
      <McpConnectionActions key={`${key.token_id}:${key.revoked_at ?? "active"}`} connection={key} disabled={!!pending} />
      {!key.revoked_at && (confirmId === key.token_id ? <div className="mcp-revoke">
        <p>{uiText("確定作廢「")}{key.label || uiText("未命名鑰匙")}{uiText("」？使用這把鑰匙的連接器會立即失去連線。")}</p>
        <div className="mcp-key-actions">
          <button type="button" disabled={!!pending} onClick={() => setConfirmId(null)}>{uiText("取消")}</button>
          <button type="button" disabled={!!pending} onClick={() => revoke(key)}>{pending === key.token_id ? uiText("作廢中…") : uiText("確認作廢")}</button>
        </div>
      </div> : <button className="mcp-revoke-button" type="button" disabled={!!pending} onClick={() => setConfirmId(key.token_id)}>{uiText("作廢")}</button>)}
    </article>)}</div>}
    <div className="mcp-key-create">
      <label htmlFor="mcp-key-label">{uiText("新鑰匙名稱")}</label>
      <input id="mcp-key-label" value={label} maxLength={32} disabled={!!pending} onChange={e => setLabel(e.target.value)} placeholder={uiText("例如：Claude 主窗")} autoComplete="off" />
      <button type="button" disabled={loading || !!pending || !label.trim() || label.trim().length > 32} onClick={generate}>{pending === "generate" ? uiText("產生中…") : uiText("產生 MCP Token")}</button>
    </div>
  </section>;
}
