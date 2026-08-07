import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getMyAgent, updateAgent } from "../api/agents";
import type { AgentPublic } from "../types";

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
    });
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
    <main className="mx-auto max-w-lg px-5 py-8 pb-24">
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
                  color: provider === p ? "#fff" : "var(--ink-soft)",
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
              color: obEnabled ? "#fff" : "var(--ink-soft)",
            }}
          >
            {obEnabled ? "已啟用" : "未啟用"}
          </button>
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
          style={{ background: "var(--accent)", color: "#fff" }}
        >
          {loading ? "儲存中..." : "儲存變更"}
        </button>
      </form>
    </main>
  );
}
