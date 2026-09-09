import { useEffect, useId, useState } from "react";
import { setUiLanguage, uiText, type UiLanguage } from "./core";
import { useUiLanguage } from "./useUiLanguage";
import "./language.css";

export function LanguageDocument() {
  const language = useUiLanguage();
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  return null;
}
export function LanguageControl({ compact = false }: { compact?: boolean }) {
  const language = useUiLanguage();
  const id = useId();
  const [temporary, setTemporary] = useState(false);
  return <div className={compact ? "language-control is-compact" : "language-control"}>
    <label htmlFor={id}>{uiText("介面語言")}</label>
    <select id={id} value={language} onChange={event => setTemporary(!setUiLanguage(event.target.value as UiLanguage))}>
      <option value="zh-TW" lang="zh-TW">繁體中文</option>
      <option value="zh-CN" lang="zh-CN">简体中文</option>
    </select>
    {!compact && <p>{uiText("只切換介面文字，不改變名字、信件、日記或聊天內容。此選擇保存在這台裝置。")}</p>}
    {temporary && <p role="status">{uiText("這次已切換，但瀏覽器無法保存偏好；關閉後可能需要重新選擇。")}</p>}
  </div>;
}
