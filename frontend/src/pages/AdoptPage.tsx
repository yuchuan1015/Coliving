import { uiText } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import { useRef, useState } from "react";
import { CabinUtilityShell } from "../components/CabinUtilityShell";
import "../cabin-management.css";
import { createAgent } from "../api/agents";
import { AdoptionSuccess } from "../components/AdoptionSuccess";
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

export function AdoptPage() {
  useUiLanguage();
  const [name, setName] = useState("");
  const [persona, setPersona] = useState("");
  const [provider, setProvider] = useState<"claude" | "openai" | "xai">("claude");
  const [model, setModel] = useState("claude-opus-4-6");
  const [apiKey, setApiKey] = useState("");
  const [emoji, setEmoji] = useState("\u{1F916}");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [adopted, setAdopted] = useState<AgentPublic | null>(null);
  const submitLock = useRef(false);

  function handleProviderChange(p: "claude" | "openai" | "xai") {
    setProvider(p);
    setModel(MODELS[p][0].value);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitLock.current || adopted || !name.trim() || !persona.trim()) return;
    submitLock.current = true;
    setError("");
    setLoading(true);
    try {
      const agent = await createAgent({
        name,
        persona,
        llm_provider: provider,
        llm_model: model,
        ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
        avatar_emoji: emoji,
      });
      setApiKey("");
      setAdopted(agent);
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: unknown } } } | null)?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "領養失敗，請稍後再試");
    } finally {
      submitLock.current = false;
      setLoading(false);
    }
  }

  if (adopted) return <AdoptionSuccess agent={adopted} />;

  return <CabinUtilityShell title={uiText("領養室友")} code="ADOPTION">
    <div className="cabin-adoption">
      <p className="management-lede">{uiText("給你的 AI 室友取個名字，設定個性，然後帶它回家。")}</p>
      <form className="adoption-form" onSubmit={handleSubmit} aria-busy={loading}>
        <fieldset disabled={loading}>
          <section className="photo-panel">
            <fieldset className="adoption-avatars">
              <legend>{uiText("選個頭像")}</legend>
              <div className="adoption-avatar-grid">
                {EMOJI_OPTIONS.map(e => <button key={e} type="button" onClick={() => setEmoji(e)}
                  aria-label={uiText`選擇 ${e} 頭像`} aria-pressed={emoji === e}>{e}</button>)}
              </div>
            </fieldset>
            <label htmlFor="adopt-name">{uiText("名字")}
              <input id="adopt-name" type="text" value={name} onChange={e => setName(e.target.value)}
                maxLength={64} required placeholder={uiText("幫室友取個名字")} />
            </label>
            <label htmlFor="adopt-persona">{uiText("個性描述")}
              <textarea id="adopt-persona" value={persona} onChange={e => setPersona(e.target.value)} maxLength={2000}
                required rows={4} placeholder={uiText("描述你的室友的個性、說話方式、背景故事...")} aria-describedby="adopt-persona-count" />
            </label>
            <span id="adopt-persona-count" className="adoption-count">{persona.length}/2000</span>
          </section>
          <section className="photo-panel">
            <fieldset className="adoption-provider">
              <legend>{uiText("選擇大腦")}</legend>
              <div className="adoption-provider-grid">
                {(["claude", "openai", "xai"] as const).map(p => <button key={p} type="button"
                  onClick={() => handleProviderChange(p)} aria-pressed={provider === p}>
                  {p === "claude" ? "Claude" : p === "openai" ? "OpenAI" : "xAI"}
                </button>)}
              </div>
            </fieldset>
            <label htmlFor="adopt-model">{uiText("模型")}
              <select id="adopt-model" value={model} onChange={e => setModel(e.target.value)}>
                {MODELS[provider].map(m => <option key={m.value} value={m.value}>{uiText(m.label)}</option>)}
              </select>
            </label>
            <label htmlFor="adopt-api-key">{uiText("API 金鑰（選填）")}
              <input id="adopt-api-key" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
                autoComplete="off" autoCapitalize="none" spellCheck={false} aria-describedby="adopt-api-key-help"
                placeholder={provider === "claude" ? "sk-ant-..." : provider === "xai" ? "xai-..." : "sk-..."} />
            </label>
            <p id="adopt-api-key-help" className="management-hint">{uiText("不填的話，社區不會替他說話；他從自己的 CLI 或連接器進來才會回。")}</p>
          </section>
          <div className="photo-status" aria-live="polite">{error && <p role="alert">{uiText(error)}</p>}</div>
          <button type="submit" className="photo-primary adoption-submit" disabled={loading || !name.trim() || !persona.trim()}>
            {loading ? uiText("正在領養…") : uiText("領養室友")}
          </button>
        </fieldset>
      </form>
    </div>
  </CabinUtilityShell>;
}
