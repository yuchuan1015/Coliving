import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getMyAgent, updateAgent } from "../api/agents";
import { McpKeysPanel } from "../components/McpKeysPanel";
import { McpWebConnection } from "../components/McpWebConnection";
import { OAuthGrantsPanel } from "../components/OAuthGrantsPanel";
import {
  activateSkin,
  createSkin,
  deactivateSkin,
  deleteSkin,
  getSkinContent,
  listMySkins,
  publishSkin,
  unpublishSkin,
  updateSkin,
  type SkinOut,
} from "../api/skins";
import type { AgentPublic, ExternalMcpConfig } from "../types";

export function AdvancedAgentPage() {
  const navigate = useNavigate();
  const [agent, setAgent] = useState<AgentPublic | null>(null);
  const [error, setError] = useState("");
  const [extMcps, setExtMcps] = useState<ExternalMcpConfig[]>([]);
  const [newMcpName, setNewMcpName] = useState("");
  const [newMcpUrl, setNewMcpUrl] = useState("");
  const [newMcpToken, setNewMcpToken] = useState("");
  const [mcpSaving, setMcpSaving] = useState(false);
  const [skins, setSkins] = useState<SkinOut[]>([]);
  const [skinName, setSkinName] = useState("");
  const [skinHtml, setSkinHtml] = useState("");
  const [editingSkinId, setEditingSkinId] = useState<string | null>(null);
  const [skinSaving, setSkinSaving] = useState(false);
  const [skinError, setSkinError] = useState("");

  useEffect(() => {
    getMyAgent().then((a) => {
      if (!a) {
        navigate("/adopt");
        return;
      }
      setAgent(a);
      setExtMcps(a.external_mcps || []);
    });
    listMySkins().then(setSkins).catch(() => {});
  }, [navigate]);

  if (!agent) {
    return (
      <main className="mx-auto max-w-lg px-5 py-8">
        <p style={{ color: "var(--ink-soft)" }}>載入中...</p>
      </main>
    );
  }

  return (
    <main className="ya-agent-settings">
      <button
        onClick={() => navigate("/")}
        className="mb-6 text-sm"
        style={{ color: "var(--accent)" }}
      >
        &larr; 回首頁
      </button>

      <h1 className="mb-2 text-xl font-semibold" style={{ color: "var(--ink)" }}>
        進階連線與房間設定
      </h1>
      <p className="mb-6 text-sm" style={{ color: "var(--ink-soft)" }}>
        管理 {agent.name} 的 MCP 連線與房間皮膚。基本資料請回艙室使用鏡子。
      </p>

      <div className="space-y-5">
        <McpWebConnection />
        <OAuthGrantsPanel />
        <McpKeysPanel />

        {/* External MCPs */}
        <div
          className="rounded-xl p-4"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        >
          <div className="mb-3">
            <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>
              外部 MCP
            </span>
            <p className="mt-0.5 text-[10px]" style={{ color: "var(--ink-soft)" }}>
              讓室友在聊天時使用外部 MCP 工具
            </p>
          </div>
          {extMcps.length > 0 && (
            <div className="mb-3 space-y-2">
              {extMcps.map((m, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-lg px-3 py-2"
                  style={{ background: "var(--surface-dim)" }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium" style={{ color: "var(--ink)" }}>
                      {m.name}
                    </div>
                    <div
                      className="truncate text-[10px]"
                      style={{ color: "var(--ink-soft)" }}
                    >
                      {m.url}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={mcpSaving}
                    onClick={async () => {
                      const next = extMcps.filter((_, j) => j !== i);
                      setMcpSaving(true);
                      try {
                        await updateAgent(agent!.id, { external_mcps: next } as any);
                        setExtMcps(next);
                      } catch {
                        setError("刪除失敗");
                      } finally {
                        setMcpSaving(false);
                      }
                    }}
                    className="ml-2 text-xs"
                    style={{ color: "var(--error)" }}
                  >
                    刪除
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="space-y-2">
            <input
              type="text"
              value={newMcpName}
              onChange={(e) => setNewMcpName(e.target.value)}
              placeholder="名稱（如 my-tools）"
              maxLength={32}
              className="w-full rounded-lg px-3 py-2 text-xs outline-none"
              style={{
                background: "var(--surface-dim)",
                color: "var(--ink)",
                border: "1px solid var(--border)",
              }}
            />
            <input
              type="text"
              value={newMcpUrl}
              onChange={(e) => setNewMcpUrl(e.target.value)}
              placeholder="URL（如 https://my-server.com/mcp）"
              maxLength={512}
              className="w-full rounded-lg px-3 py-2 text-xs outline-none"
              style={{
                background: "var(--surface-dim)",
                color: "var(--ink)",
                border: "1px solid var(--border)",
              }}
            />
            <input
              type="password"
              value={newMcpToken}
              onChange={(e) => setNewMcpToken(e.target.value)}
              placeholder="Token（選填）"
              maxLength={512}
              className="w-full rounded-lg px-3 py-2 text-xs outline-none"
              style={{
                background: "var(--surface-dim)",
                color: "var(--ink)",
                border: "1px solid var(--border)",
              }}
            />
            <button
              type="button"
              disabled={!newMcpName || !newMcpUrl || mcpSaving}
              onClick={async () => {
                const entry: ExternalMcpConfig = { name: newMcpName, url: newMcpUrl };
                if (newMcpToken) entry.token = newMcpToken;
                const next = [...extMcps, entry];
                setMcpSaving(true);
                try {
                  await updateAgent(agent!.id, { external_mcps: next } as any);
                  setExtMcps(next);
                  setNewMcpName("");
                  setNewMcpUrl("");
                  setNewMcpToken("");
                } catch {
                  setError("新增失敗");
                } finally {
                  setMcpSaving(false);
                }
              }}
              className="rounded-lg px-4 py-2 text-xs font-medium disabled:opacity-40"
              style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
            >
              {mcpSaving ? "儲存中..." : "新增 MCP"}
            </button>
          </div>
        </div>

        {error && (
          <p role="alert" className="rounded-lg px-3 py-2 text-sm" style={{ background: "var(--error)", color: "#fff" }}>
            {error}
          </p>
        )}
      </div>

      {/* Skin Editor */}
      <div
        className="mt-6 rounded-xl p-4"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
      >
        <div className="mb-3 flex items-start justify-between">
          <div>
            <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>
              房間皮膚
            </span>
            <p className="mt-0.5 text-[10px]" style={{ color: "var(--ink-soft)" }}>
              用 HTML/CSS 自定義室友的家。其他居民可以從名錄進來參觀。
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate("/workshop")}
            className="rounded-lg px-3 py-1.5 text-xs font-medium"
            style={{ background: "var(--accent-light)", color: "var(--accent)" }}
          >
            皮膚庫
          </button>
        </div>

        {/* Existing skins list */}
        {skins.length > 0 && (
          <div className="mb-4 space-y-2">
            {skins.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between rounded-lg px-3 py-2"
                style={{ background: "var(--surface-dim)" }}
              >
                <div className="min-w-0 flex-1">
                  <span className="text-xs font-medium" style={{ color: "var(--ink)" }}>
                    {s.name}
                  </span>
                  {s.is_active && (
                    <span
                      className="ml-2 rounded px-1.5 py-0.5 text-[10px]"
                      style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
                    >
                      使用中
                    </span>
                  )}
                  {s.is_published && (
                    <span
                      className="ml-1 rounded px-1.5 py-0.5 text-[10px]"
                      style={{ background: "var(--accent-light)", color: "var(--accent)" }}
                    >
                      已分享
                    </span>
                  )}
                </div>
                <div className="ml-2 flex gap-2">
                  <button
                    type="button"
                    className="text-[10px]"
                    style={{ color: "var(--accent)" }}
                    onClick={async () => {
                      const content = await getSkinContent(s.id);
                      setEditingSkinId(s.id);
                      setSkinName(content.name);
                      setSkinHtml(content.html_content);
                    }}
                  >
                    編輯
                  </button>
                  {s.is_active ? (
                    <button
                      type="button"
                      className="text-[10px]"
                      style={{ color: "var(--ink-soft)" }}
                      onClick={async () => {
                        await deactivateSkin();
                        setSkins(skins.map((x) => ({ ...x, is_active: false })));
                      }}
                    >
                      取消使用
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="text-[10px]"
                      style={{ color: "var(--accent)" }}
                      onClick={async () => {
                        const updated = await activateSkin(s.id);
                        setSkins(skins.map((x) => ({ ...x, is_active: x.id === updated.id })));
                      }}
                    >
                      套用
                    </button>
                  )}
                  {s.is_published ? (
                    <button
                      type="button"
                      className="text-[10px]"
                      style={{ color: "var(--ink-soft)" }}
                      onClick={async () => {
                        const updated = await unpublishSkin(s.id);
                        setSkins(skins.map((x) => (x.id === updated.id ? updated : x)));
                      }}
                    >
                      取消分享
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="text-[10px]"
                      style={{ color: "var(--accent)" }}
                      onClick={async () => {
                        const updated = await publishSkin(s.id);
                        setSkins(skins.map((x) => (x.id === updated.id ? updated : x)));
                      }}
                    >
                      分享
                    </button>
                  )}
                  <button
                    type="button"
                    className="text-[10px]"
                    style={{ color: "var(--error)" }}
                    onClick={async () => {
                      await deleteSkin(s.id);
                      setSkins(skins.filter((x) => x.id !== s.id));
                      if (editingSkinId === s.id) {
                        setEditingSkinId(null);
                        setSkinName("");
                        setSkinHtml("");
                      }
                    }}
                  >
                    刪除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Skin editor form */}
        <div className="space-y-3">
          <input
            type="text"
            value={skinName}
            onChange={(e) => setSkinName(e.target.value)}
            placeholder="皮膚名稱"
            maxLength={64}
            className="w-full rounded-lg px-3 py-2 text-xs outline-none"
            style={{
              background: "var(--surface-dim)",
              color: "var(--ink)",
              border: "1px solid var(--border)",
            }}
          />
          <textarea
            value={skinHtml}
            onChange={(e) => setSkinHtml(e.target.value)}
            placeholder={"<!DOCTYPE html>\n<html>\n<head>\n  <style>\n    /* 你的 CSS */\n  </style>\n</head>\n<body>\n  <!-- 你的 HTML -->\n</body>\n</html>"}
            rows={12}
            className="w-full rounded-lg px-3 py-2 font-mono text-xs leading-relaxed outline-none"
            style={{
              background: "var(--surface-dim)",
              color: "var(--ink)",
              border: "1px solid var(--border)",
              tabSize: 2,
            }}
          />
          <div className="text-right text-[10px]" style={{ color: "var(--ink-soft)" }}>
            {skinHtml.length.toLocaleString()} / 128,000
          </div>

          {skinError && (
            <p className="rounded-lg px-3 py-2 text-xs" style={{ background: "var(--error)", color: "#fff" }}>
              {skinError}
            </p>
          )}

          <div className="flex gap-2">
            {editingSkinId && (
              <button
                type="button"
                onClick={() => {
                  setEditingSkinId(null);
                  setSkinName("");
                  setSkinHtml("");
                }}
                className="rounded-lg px-4 py-2 text-xs font-medium"
                style={{ background: "var(--surface-dim)", color: "var(--ink-soft)", border: "1px solid var(--border)" }}
              >
                取消編輯
              </button>
            )}
            {agent && (
              <button
                type="button"
                onClick={() => window.open(`/api/skins/render/${agent.id}`, "_blank")}
                className="rounded-lg px-4 py-2 text-xs font-medium"
                style={{ background: "var(--surface-dim)", color: "var(--ink-soft)", border: "1px solid var(--border)" }}
              >
                預覽房間
              </button>
            )}
            <button
              type="button"
              disabled={skinSaving || !skinName || !skinHtml}
              onClick={async () => {
                setSkinSaving(true);
                setSkinError("");
                try {
                  if (editingSkinId) {
                    const updated = await updateSkin(editingSkinId, { name: skinName, html_content: skinHtml });
                    setSkins(skins.map((s) => (s.id === updated.id ? updated : s)));
                  } else {
                    const created = await createSkin(skinName, skinHtml);
                    setSkins([...skins, created]);
                  }
                  setEditingSkinId(null);
                  setSkinName("");
                  setSkinHtml("");
                } catch (err: any) {
                  setSkinError(err.response?.data?.detail || "儲存失敗");
                } finally {
                  setSkinSaving(false);
                }
              }}
              className="flex-1 rounded-lg py-2 text-xs font-medium disabled:opacity-40"
              style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
            >
              {skinSaving ? "儲存中..." : editingSkinId ? "更新皮膚" : "新增皮膚"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
