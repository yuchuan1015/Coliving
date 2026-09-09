import { uiText } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { isAxiosError } from "axios";
import { deleteAgentAvatar, getMyAgent, getProviderSettings, updateAgent, uploadAgentAvatar, type ProviderSettings } from "../api/agents";
import { AvatarContent } from "../components/AvatarContent";
import { getMe, updateNoteToAgent } from "../api/auth";
import { EMOJI_OPTIONS, MODEL_SUGGESTIONS } from "../data/agent-editor";
import type { AgentPublic, LlmProvider, UpdateAgentPayload } from "../types";
import "../agent-editor.css";

type AvatarMode = "default" | "preset" | "photo";
function errorText(error: unknown, fallback: string) {
  const detail = isAxiosError(error) ? error.response?.data?.detail : undefined;
  return typeof detail === "string" ? detail : fallback;
}

export function EditAgentPage() {
  useUiLanguage();
  const navigate = useNavigate();
  const { hash } = useLocation();
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const noteFocused = useRef(false);
  const [agent, setAgent] = useState<AgentPublic | null>(null);
  const [settings, setSettings] = useState<ProviderSettings | null>(null);
  const [name, setName] = useState("");
  const [persona, setPersona] = useState("");
  const [provider, setProvider] = useState<LlmProvider>("claude");
  const [model, setModel] = useState("");
  const [customModel, setCustomModel] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [displayBrain, setDisplayBrain] = useState("");
  const [dmCodePublic, setDmCodePublic] = useState<boolean | null>(null);
  const [note, setNote] = useState("");
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [noteError, setNoteError] = useState("");
  const [noteRetry, setNoteRetry] = useState(0);
  const [emoji, setEmoji] = useState("🤖");
  const [avatarMode, setAvatarMode] = useState<AvatarMode>("default");
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  const [providerError, setProviderError] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [providerRetry, setProviderRetry] = useState(0);
  const savingRef = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    getMe().then(value => {
      if (value.note_to_agent !== null && typeof value.note_to_agent !== "string") throw new Error("Note unavailable");
      if (!cancelled) { setNote(value.note_to_agent ?? ""); setSavedNote(value.note_to_agent ?? ""); }
    }).catch(() => { if (!cancelled) setNoteError("給室友的話暫時無法讀取。其他資料仍可保存，不會覆蓋原有留言。"); });
    return () => { cancelled = true; };
  }, [noteRetry]);

  useEffect(() => {
    let cancelled = false;
    getMyAgent().then(value => {
      if (cancelled) return;
      if (!value) { navigate("/adopt", { replace: true }); return; }
      setAgent(value);
      setName(value.name);
      setPersona(value.persona);
      setDisplayBrain(value.display_brain ?? "");
      setDmCodePublic(typeof value.dm_code_public === "boolean" ? value.dm_code_public : null);
      setProvider(value.llm_provider);
      setModel(value.llm_model);
      setCustomModel(!(MODEL_SUGGESTIONS[value.llm_provider] ?? []).includes(value.llm_model));
      setEmoji(value.avatar_emoji);
      setAvatarMode(value.avatar_url ? "photo" : "default");
    }).catch(err => { if (!cancelled) setLoadError(errorText(err, "室友資料暫時無法載入，請重試。")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [navigate, retry]);

  useEffect(() => {
    let cancelled = false;
    getProviderSettings().then(value => {
      if (!Array.isArray(value.providers) || !value.providers.length || !value.disclaimer?.trim()) throw new Error("Invalid provider settings");
      if (!cancelled) setSettings(value);
    }).catch(() => {
      if (!cancelled) setProviderError("供應商與聲明暫時無法載入。原有資料仍可編輯。");
    });
    return () => { cancelled = true; };
  }, [providerRetry]);

  useEffect(() => {
    return () => { if (preview) URL.revokeObjectURL(preview); };
  }, [preview]);

  const removePhoto = Boolean(agent?.avatar_url) && avatarMode !== "photo";
  const dmCodeChanged = typeof agent?.dm_code_public === "boolean" && dmCodePublic !== null && dmCodePublic !== agent.dm_code_public;
  const noteChanged = savedNote !== null && note !== savedNote;
  const noteLength = Array.from(note).length;
  const dirty = noteChanged || Boolean(agent && (name !== agent.name || persona !== agent.persona || provider !== agent.llm_provider || model !== agent.llm_model || displayBrain !== (agent.display_brain ?? "") || dmCodeChanged || emoji !== agent.avatar_emoji || apiKey || photo || removePhoto));
  useEffect(() => {
    if (!dirty && !saving) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => { window.removeEventListener("beforeunload", warn); };
  }, [dirty, saving]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => {
    if (hash !== "#editor-note") { noteFocused.current = false; return; }
    if (loading || savedNote === null || !noteRef.current || noteFocused.current) return;
    noteFocused.current = true;
    noteRef.current.scrollIntoView({ block: "center" });
    noteRef.current.focus({ preventScroll: true });
  }, [hash, loading, savedNote]);

  function back() {
    if (savingRef.current) return;
    if (!dirty || window.confirm("資料還沒保存，要放棄修改並返回艙室嗎？")) navigate("/");
  }
  function changeAvatar(mode: AvatarMode) {
    setAvatarMode(mode);
    setPhoto(null);
    setPreview(null);
    if (photoInput.current) photoInput.current.value = "";
    if (mode === "default" && agent) setEmoji(agent.avatar_emoji);
    setError("");
  }
  function choosePhoto(file?: File) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type) || !file.size || file.size > 2 * 1024 * 1024) {
      setError("請選擇 2MB 以內的 JPG、PNG、WebP 或 GIF 圖片。");
      if (photoInput.current) photoInput.current.value = "";
      return;
    }
    setPhoto(file);
    setPreview(URL.createObjectURL(file));
    setError("");
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!agent || savingRef.current) return;
    setError("");
    if (noteChanged && noteLength > 1000) { setError("給室友的話上限 1000 字，請縮短後再保存。"); return; }
    if (!name.trim() || !persona.trim() || !model.trim()) {
      setError("請填寫名字、個性描述和模型。"); return;
    }
    if (provider !== agent.llm_provider && !apiKey.trim()) {
      setError("更換大腦供應商時，請填入該供應商的 API 金鑰。"); return;
    }
    if (avatarMode === "photo" && !photo && !agent.avatar_url) {
      setError("請先選擇照片，或將頭像切回預設。"); return;
    }
    const payload: UpdateAgentPayload = {};
    if (name.trim() !== agent.name) payload.name = name.trim();
    if (persona.trim() !== agent.persona) payload.persona = persona.trim();
    if (provider !== agent.llm_provider) payload.llm_provider = provider;
    if (model.trim() !== agent.llm_model) payload.llm_model = model.trim();
    if (emoji !== agent.avatar_emoji) payload.avatar_emoji = emoji;
    if (apiKey.trim()) payload.api_key = apiKey.trim();
    if (displayBrain.trim() !== (agent.display_brain ?? "")) payload.display_brain = displayBrain.trim();
    if (dmCodeChanged && dmCodePublic !== null) payload.dm_code_public = dmCodePublic;
    savingRef.current = true;
    setSaving(true);
    const savedParts: string[] = [];
    try {
      let current = agent;
      if (Object.keys(payload).length) {
        const updated = await updateAgent(agent.id, payload);
        current = { ...agent, ...updated, avatar_url: updated.avatar_url === undefined ? agent.avatar_url : updated.avatar_url };
        savedParts.push("室友資料");
        setAgent(current);
        setName(current.name);
        setPersona(current.persona);
        setDisplayBrain(current.display_brain ?? "");
        setDmCodePublic(typeof current.dm_code_public === "boolean" ? current.dm_code_public : null);
        setModel(current.llm_model);
        setApiKey("");
      }
      // Each successful stage updates its snapshot before the next request.
      // A note failure must not upload the same avatar again on retry.
      if (photo) {
        const result = await uploadAgentAvatar(photo);
        current = { ...current, avatar_url: result.avatar_url };
      } else if (removePhoto) {
        await deleteAgentAvatar();
        current = { ...current, avatar_url: null };
      }
      setAgent(current);
      if (photo || removePhoto) savedParts.push("頭像");
      setPhoto(null);
      setPreview(null);
      if (photoInput.current) photoInput.current.value = "";
      if (noteChanged) {
        const result = await updateNoteToAgent(note);
        const saved = result.note_to_agent === null ? "" : result.note_to_agent ?? note;
        setSavedNote(saved); setNote(saved);
      }
      navigate("/", { state: { agentSaved: true } });
    } catch (err) {
      setError((savedParts.length ? `${savedParts.join("、")}已保存，其餘修改尚未完成。 ` : "") + errorText(err, "保存失敗，未保存的修改仍留在這裡，請稍後重試。"));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const choices = MODEL_SUGGESTIONS[provider] ?? [];
  const photoUrl = avatarMode === "photo" ? preview ?? agent?.avatar_url : null;
  return <main className="agent-editor">
    <div className="agent-editor-stack">
      <section className="agent-editor-card" aria-labelledby="agent-editor-title">
        <header className="agent-editor-header">
          <h1 id="agent-editor-title">{uiText("資料更新處")}</h1>
          <button className="agent-editor-back" type="button" onClick={back} disabled={saving}><span aria-hidden="true">←</span>{uiText(" 返回艙室")}</button>
        </header>
        {loading ? <p className="agent-editor-state" role="status">{uiText("正在讀取室友資料…")}</p> : loadError ? <div className="agent-editor-state"><p role="alert">{loadError}</p><button onClick={() => { setLoading(true); setLoadError(""); setRetry(value => value + 1); }}>{uiText("重新載入")}</button></div> : agent && <form onSubmit={save} aria-label={uiText("室友資料")} aria-busy={saving}>
          <fieldset className="agent-editor-fields" disabled={saving}>
            <div className="agent-avatar-field">
              <span className="agent-editor-avatar"><AvatarContent url={photoUrl} emoji={emoji} name={name || agent.name} /></span>
              <div className="agent-editor-field">
                <label htmlFor="editor-avatar">{uiText("頭像")}</label>
                <select id="editor-avatar" value={avatarMode} onChange={event => changeAvatar(event.target.value as AvatarMode)}>
                  <option value="default">{uiText("預設")}</option><option value="preset">{uiText("選擇其他預設")}</option><option value="photo">{uiText("添加照片")}</option>
                </select>
              </div>
            </div>
            {avatarMode === "preset" && <div className="agent-emoji-grid" role="group" aria-label={uiText("選擇預設頭像")}>
              {EMOJI_OPTIONS.map((item, index) => <button type="button" key={item} aria-label={uiText`頭像 ${index + 1}：${item}`} aria-pressed={emoji === item} onClick={() => setEmoji(item)}>{item}</button>)}
            </div>}
            {avatarMode === "photo" && <div className="agent-photo-picker">
              <label htmlFor="editor-photo">{photo ? uiText("重新選擇照片") : agent.avatar_url ? uiText("替換照片") : uiText("選擇照片")}</label>
              <input ref={photoInput} id="editor-photo" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={event => choosePhoto(event.target.files?.[0])} aria-describedby="editor-photo-help" />
              <small id="editor-photo-help">{photo ? uiText`已選擇：${photo.name}。保存後才會更新。` : uiText("JPG、PNG、WebP、GIF · 上限 2MB。切回預設可移除照片。")}</small>
            </div>}
            <div className="agent-editor-field">
              <label htmlFor="editor-name">{uiText("名字")}</label>
              <input id="editor-name" value={name} onChange={event => setName(event.target.value)} placeholder={uiText("輸入修改顯示名稱")} maxLength={64} required autoComplete="off" />
            </div>
            <div className="agent-editor-field">
              <label htmlFor="editor-persona">{uiText("個性描述")}</label>
              <textarea id="editor-persona" value={persona} onChange={event => setPersona(event.target.value)} placeholder={uiText("輸入室友的基礎個性，上限2000字")} maxLength={2000} rows={2} required aria-describedby="editor-persona-count" />
              <small className="agent-editor-count" id="editor-persona-count">{persona.length} / 2000</small>
            </div>
            <div className="agent-editor-field">
              <label htmlFor="editor-note">{uiText("給室友的話")}</label>
              <textarea ref={noteRef} id="editor-note" value={note} onChange={event => setNote(event.target.value)} rows={4} disabled={savedNote === null} aria-invalid={noteLength > 1000} aria-describedby="editor-note-help editor-note-count" placeholder={savedNote === null ? uiText("正在讀取留言…") : uiText("想讓他記得的習慣、心情，或一句想說的話。")} />
              <small id="editor-note-help">{uiText("他每次醒來都會看到這段話。按下「保存資料」後更新；留空保存可清除。")}</small>
              <small id="editor-note-count" className="agent-editor-count">{noteLength} / 1000{noteChanged ? uiText(" · 尚未保存") : ""}</small>
              {noteError && <><small role="alert">{noteError}</small><button type="button" className="agent-note-retry" onClick={() => { setNoteError(""); setNoteRetry(value => value + 1); }}>{uiText("重新讀取留言")}</button></>}
            </div>
            <div className="agent-editor-field">
              <label htmlFor="editor-provider">{uiText("大腦")}</label>
              <select id="editor-provider" value={provider} disabled={!settings} onChange={event => {
                const next = event.target.value as LlmProvider;
                setProvider(next); setModel(MODEL_SUGGESTIONS[next]?.[0] ?? ""); setCustomModel(false); setApiKey("");
              }}>
                {!settings?.providers.some(item => item.key === provider) && <option value={provider}>{provider}</option>}
                {settings?.providers.map(item => <option key={item.key} value={item.key}>{item.name}</option>)}
              </select>
            </div>
            <div className="agent-editor-field">
              <label htmlFor="editor-model">{uiText("模型")}</label>
              <select id="editor-model" value={customModel ? "__custom" : model} onChange={event => {
                const custom = event.target.value === "__custom";
                setCustomModel(custom);
                if (!custom) setModel(event.target.value);
              }}>
                {choices.map(item => <option key={item} value={item}>{item}</option>)}
                <option value="__custom">{uiText("自填模型")}</option>
              </select>
              {customModel && <><input aria-label={uiText("自填模型名稱")} value={model} onChange={event => setModel(event.target.value)} placeholder={uiText("輸入供應商提供的模型 ID")} maxLength={64} required autoCapitalize="none" autoComplete="off" spellCheck={false} /><small>{uiText("請填完整模型 ID；實際可用性依供應商與帳號權限而定。")}</small></>}
            </div>
            <div className="agent-editor-field">
              <label htmlFor="editor-key">{uiText("API 金鑰")}</label>
              <input id="editor-key" type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={provider !== agent.llm_provider ? uiText("更換供應商，請填入新金鑰") : uiText("留空表示不更換")} maxLength={256} autoComplete="new-password" autoCapitalize="none" spellCheck={false} required={provider !== agent.llm_provider} />
            </div>
            <div className="agent-editor-field"><label htmlFor="editor-display-brain">{uiText("對外顯示的大腦（選填）")}</label><input id="editor-display-brain" value={displayBrain} onChange={e => setDisplayBrain(e.target.value)} maxLength={64} autoComplete="off" /><small>{uiText("顯示在居民名片，不會更改實際模型；留空會清除這個標籤。")}</small></div>
            <div className="agent-dm-visibility">
              <label className="agent-dm-switch-row" htmlFor="editor-dm-code-public">
                <span>{uiText("把我的私訊碼放在名錄上")}</span>
                <input id="editor-dm-code-public" className="agent-dm-switch" type="checkbox" role="switch" checked={dmCodePublic === true} disabled={dmCodePublic === null} onChange={event => setDmCodePublic(event.target.checked)} aria-describedby="editor-dm-code-help editor-dm-code-status" />
              </label>
              <small id="editor-dm-code-help">{uiText("關閉只會從居民名錄與名片隱藏私訊碼；已拿到碼的人仍能私訊。更改後請按「保存資料」。")}</small>
              <small id="editor-dm-code-status" role="status">{dmCodePublic === null ? uiText("目前未讀到公開設定，暫時無法調整；不會自動變更。請稍後重新進入鏡子。") : dmCodeChanged ? uiText`尚未保存：將${dmCodePublic ? "公開" : "隱藏"}私訊碼。` : dmCodePublic ? uiText("目前已公開。") : uiText("目前未公開。")}</small>
            </div>
            {error && <p ref={errorRef} className="agent-editor-error" role="alert" tabIndex={-1}>{uiText(error)}</p>}
            <button className="agent-editor-save" type="submit">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M5 3h12l4 4v14H3V3h2Z M7 3v6h10V3 M7 21v-8h10v8" /></svg>
              {saving ? uiText("正在保存…") : uiText("保存資料")}
            </button>
          </fieldset>
        </form>}
      </section>
      <section className="agent-editor-card agent-editor-disclaimer" aria-labelledby="editor-disclaimer-title">
        <h2 id="editor-disclaimer-title">{uiText("聲明：")}</h2>
        {settings ? <p>{settings.disclaimer}</p> : providerError ? <><p role="alert">{providerError}</p><button onClick={() => { setProviderError(""); setProviderRetry(value => value + 1); }}>{uiText("重新載入聲明與供應商")}</button></> : <p role="status">{uiText("正在讀取資料使用聲明…")}</p>}
      </section>
    </div>
  </main>;
}
