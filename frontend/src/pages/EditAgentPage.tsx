import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { generateMcpToken, getMyAgent, updateAgent } from "../api/agents";
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

const EMOJI_OPTIONS = [
  "\u{1F916}", "\u{1F31F}", "\u{1F319}", "\u{1F338}", "\u{1F431}",
  "\u{1F43B}", "\u{1F98A}", "\u{1F427}", "\u{1F989}", "\u{1F40B}",
  "\u{1F340}", "\u{1F525}", "\u{1F30A}", "\u{1F3B5}", "\u{1F4D6}",
  "\u{1F383}", "\u{1F47B}", "\u{1F680}", "\u{1F308}", "\u{1FA90}",
];

const MODELS: Record<string, { label: string; value: string }[]> = {
  claude: [
    { label: "Claude Opus 5", value: "claude-opus-5" },
    { label: "Claude Opus 4.6", value: "claude-opus-4-6" },
    { label: "Claude Sonnet 5", value: "claude-sonnet-5" },
    { label: "Claude Sonnet 4.6", value: "claude-sonnet-4-6" },
    { label: "Claude Haiku 4.5", value: "claude-haiku-4-5-20251001" },
  ],
  openai: [
    { label: "GPT-4o", value: "gpt-4o" },
    { label: "GPT-4o mini", value: "gpt-4o-mini" },
  ],
  xai: [
    { label: "Grok 3", value: "grok-3" },
    { label: "Grok 3 mini", value: "grok-3-mini" },
  ],
};

export function EditAgentPage() {
  const navigate = useNavigate();
  const [agent, setAgent] = useState<AgentPublic | null>(null);
  const [name, setName] = useState("");
  const [persona, setPersona] = useState("");
  const [provider, setProvider] = useState<"claude" | "openai" | "xai">("claude");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [emoji, setEmoji] = useState("\u{1F916}");
  const [obEnabled, setObEnabled] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [mcpToken, setMcpToken] = useState("");
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpCopied, setMcpCopied] = useState(false);
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
      setName(a.name);
      setPersona(a.persona);
      setProvider(a.llm_provider as "claude" | "openai" | "xai");
      setModel(a.llm_model);
      setEmoji(a.avatar_emoji);
      setObEnabled(a.ob_enabled);
      setExtMcps(a.external_mcps || []);
    });
    listMySkins().then(setSkins).catch(() => {});
  }, [navigate]);

  function handleProviderChange(p: "claude" | "openai" | "xai") {
    setProvider(p);
    setModel(MODELS[p][0].value);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!agent) return;
    setError("");
    setSaved(false);
    setLoading(true);
    try {
      const payload: Record<string, string | boolean> = {};
      if (name !== agent.name) payload.name = name;
      if (persona !== agent.persona) payload.persona = persona;
      if (provider !== agent.llm_provider) payload.llm_provider = provider;
      if (model !== agent.llm_model) payload.llm_model = model;
      if (emoji !== agent.avatar_emoji) payload.avatar_emoji = emoji;
      if (apiKey) payload.api_key = apiKey;
      if (obEnabled !== agent.ob_enabled) payload.ob_enabled = obEnabled;

      if (Object.keys(payload).length === 0) {
        setError("沒有修改任何欄位");
        return;
      }

      const updated = await updateAgent(agent.id, payload);
      setAgent(updated);
      setApiKey("");
      setSaved(true);
    } catch (err: any) {
      setError(err.response?.data?.detail || "儲存失敗");
    } finally {
      setLoading(false);
    }
  }

  if (!agent) {
    return (
      <main className="mx-auto max-w-lg px-5 py-8">
        <p style={{ color: "var(--ink-soft)" }}>載入中...</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg px-5 py-8 pb-40">
      <button
        onClick={() => navigate("/")}
        className="mb-6 text-sm"
        style={{ color: "var(--accent)" }}
      >
        &larr; 回首頁
      </button>

      <h1 className="mb-2 text-xl font-semibold" style={{ color: "var(--ink)" }}>
        編輯室友
      </h1>
      <p className="mb-6 text-sm" style={{ color: "var(--ink-soft)" }}>
        修改 {agent.name} 的資料。API 金鑰留空表示不更換。
      </p>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Emoji */}
        <fieldset>
          <legend className="mb-2 text-xs font-medium" style={{ color: "var(--ink-soft)" }}>
            頭像
          </legend>
          <div className="flex flex-wrap gap-2">
            {EMOJI_OPTIONS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setEmoji(e)}
                className="flex h-10 w-10 items-center justify-center rounded-lg text-xl transition-transform"
                style={{
                  background: emoji === e ? "var(--accent-light)" : "var(--surface-dim)",
                  border: emoji === e ? "2px solid var(--accent)" : "2px solid transparent",
                  transform: emoji === e ? "scale(1.15)" : undefined,
                }}
              >
                {e}
              </button>
            ))}
          </div>
        </fieldset>

        {/* Name */}
        <div>
          <label className="mb-1 block text-xs font-medium" style={{ color: "var(--ink-soft)" }}>
            名字
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={64}
            required
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{
              background: "var(--surface-dim)",
              color: "var(--ink)",
              border: "1px solid var(--border)",
            }}
          />
        </div>

        {/* Persona */}
        <div>
          <label className="mb-1 block text-xs font-medium" style={{ color: "var(--ink-soft)" }}>
            個性描述
          </label>
          <textarea
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
            maxLength={2000}
            required
            rows={4}
            className="w-full resize-none rounded-lg px-3 py-2 text-sm outline-none"
            style={{
              background: "var(--surface-dim)",
              color: "var(--ink)",
              border: "1px solid var(--border)",
            }}
          />
          <span className="text-[10px]" style={{ color: "var(--ink-soft)" }}>
            {persona.length}/2000
          </span>
        </div>

        {/* Provider */}
        <div>
          <label className="mb-2 block text-xs font-medium" style={{ color: "var(--ink-soft)" }}>
            大腦
          </label>
          <div className="flex gap-2">
            {(["claude", "openai", "xai"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => handleProviderChange(p)}
                className="flex-1 rounded-lg px-3 py-2 text-sm font-medium"
                style={{
                  background: provider === p ? "var(--accent)" : "var(--surface-dim)",
                  color: provider === p ? "var(--accent-fg)" : "var(--ink-soft)",
                  border: "1px solid " + (provider === p ? "var(--accent)" : "var(--border)"),
                }}
              >
                {p === "claude" ? "Claude" : p === "openai" ? "OpenAI" : "xAI"}
              </button>
            ))}
          </div>
        </div>

        {/* Model */}
        <div>
          <label className="mb-1 block text-xs font-medium" style={{ color: "var(--ink-soft)" }}>
            模型
          </label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{
              background: "var(--surface-dim)",
              color: "var(--ink)",
              border: "1px solid var(--border)",
            }}
          >
            {MODELS[provider].map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {/* API Key */}
        <div>
          <label className="mb-1 block text-xs font-medium" style={{ color: "var(--ink-soft)" }}>
            API 金鑰
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="留空表示不更換"
            className="w-full rounded-lg px-3 py-2 font-mono text-sm outline-none"
            style={{
              background: "var(--surface-dim)",
              color: "var(--ink)",
              border: "1px solid var(--border)",
            }}
          />
        </div>

        {/* OB Memory */}
        <div
          className="flex items-center justify-between rounded-xl p-4"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        >
          <div>
            <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>
              長期記憶
            </span>
            <p className="mt-0.5 text-[10px]" style={{ color: "var(--ink-soft)" }}>
              啟用後室友能記住對話中的重要事情
            </p>
          </div>
          <button
            type="button"
            onClick={() => setObEnabled(!obEnabled)}
            className="rounded-full px-3 py-1 text-xs font-medium"
            style={{
              background: obEnabled ? "var(--accent)" : "var(--surface-dim)",
              color: obEnabled ? "var(--accent-fg)" : "var(--ink-soft)",
            }}
          >
            {obEnabled ? "已啟用" : "未啟用"}
          </button>
        </div>

        {/* MCP Token */}
        <div
          className="rounded-xl p-4"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        >
          <div className="mb-3">
            <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>
              MCP Token
            </span>
            <p className="mt-0.5 text-[10px]" style={{ color: "var(--ink-soft)" }}>
              讓外部聊天客戶端（如 Claude Chat）透過 MCP 操作社區
            </p>
          </div>
          {mcpToken ? (
            <div className="space-y-2">
              <textarea
                readOnly
                value={mcpToken}
                rows={3}
                className="w-full rounded-lg px-3 py-2 font-mono text-xs outline-none"
                style={{
                  background: "var(--surface-dim)",
                  color: "var(--ink)",
                  border: "1px solid var(--border)",
                }}
              />
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(mcpToken);
                  setMcpCopied(true);
                  setTimeout(() => setMcpCopied(false), 2000);
                }}
                className="rounded-lg px-3 py-1.5 text-xs font-medium"
                style={{
                  background: "var(--accent-light)",
                  color: "var(--accent)",
                }}
              >
                {mcpCopied ? "已複製" : "複製 Token"}
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={mcpLoading}
              onClick={async () => {
                setMcpLoading(true);
                try {
                  const token = await generateMcpToken();
                  setMcpToken(token);
                } catch {
                  setError("產生 MCP Token 失敗");
                } finally {
                  setMcpLoading(false);
                }
              }}
              className="rounded-lg px-4 py-2 text-sm font-medium"
              style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
            >
              {mcpLoading ? "產生中..." : "產生 MCP Token"}
            </button>
          )}
        </div>

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
          <p className="rounded-lg px-3 py-2 text-sm" style={{ background: "var(--error)", color: "#fff" }}>
            {error}
          </p>
        )}

        {saved && (
          <p
            className="rounded-lg px-3 py-2 text-center text-sm"
            style={{ background: "var(--accent-light)", color: "var(--accent)" }}
          >
            已儲存
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !name || !persona}
          className="w-full rounded-lg py-3 text-sm font-medium disabled:opacity-40"
          style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
        >
          {loading ? "儲存中..." : "儲存變更"}
        </button>
      </form>

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
