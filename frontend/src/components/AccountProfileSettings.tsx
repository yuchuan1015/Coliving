import { useId, useRef, useState } from "react";
import api, { clearTokens } from "../api/client";
import { useAuth } from "../hooks/useAuth";
import { shelfError } from "../hooks/useBookshelf";
import { uiText } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";

export function DisplayNameSettings({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) {
  useUiLanguage();
  const { user, updateDisplayName } = useAuth();
  const [draft, setDraft] = useState<string | null>(null);
  const name = draft ?? user?.display_name ?? "";
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const lock = useRef(false); const id = useId();
  return <form className="cabin-city-form" aria-labelledby={id + "-title"} onSubmit={async e => {
    e.preventDefault(); if (lock.current) return;
    if (!name.trim()) { setMessage("顯示名稱不能空白。"); return; }
    lock.current = true; setBusy(true); onBusyChange?.(true); setMessage("");
    try { const saved = await updateDisplayName(name.trim()); setDraft(saved.display_name); setMessage("顯示名稱已更新。"); }
    catch (error) { setMessage(shelfError(error).message); }
    finally { lock.current = false; setBusy(false); onBusyChange?.(false); }
  }}>
    <h3 id={id + "-title"}>{uiText("顯示名稱")}</h3>
    <label htmlFor={id}>{uiText("你的顯示名稱")}</label>
    <input id={id} value={name} maxLength={64} required disabled={busy} autoComplete="nickname"
      onChange={e => { if (!lock.current) { setDraft(e.target.value); setMessage(""); } }} />
    <small>{uiText("名錄和給室友的話會使用這個名字，登入帳號維持原樣。")}</small>
    <button disabled={busy || !user}>{uiText(busy ? "正在保存…" : "保存顯示名稱")}</button>
    <p role="status">{uiText(message)}</p>
  </form>;
}

export function PasswordSettings({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) {
  useUiLanguage();
  const [oldPassword, setOldPassword] = useState(""); const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState(""); const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(""); const [uncertain, setUncertain] = useState(false);
  const lock = useRef(false); const id = useId();
  function clearPasswords() { setOldPassword(""); setNewPassword(""); setConfirmation(""); }
  return <form className="cabin-city-form" aria-labelledby={id + "-title"} onSubmit={async e => {
    e.preventDefault(); if (lock.current || uncertain) return;
    if (newPassword !== confirmation) { setMessage("兩次輸入的新密碼不一致。"); return; }
    if (new TextEncoder().encode(newPassword).length > 72) { setMessage("密碼太長，請縮短；中文字會佔較多長度。"); return; }
    lock.current = true; setBusy(true); onBusyChange?.(true); setMessage("");
    try {
      await api.post("/users/me/password", { old_password: oldPassword, new_password: newPassword });
      // Reload after clearing credentials so no protected-route redirect races
      // the confirmation URL, and the previous account's in-memory state is gone.
      clearPasswords(); clearTokens(); window.location.replace("/login?password=changed");
    } catch (error) {
      const failure = shelfError(error);
      if (!failure.status || failure.status >= 500) {
        clearPasswords(); setUncertain(true);
        setMessage("未收到確認，密碼可能已更新。請重新登入確認，不會自動重送。");
      } else { setMessage(failure.message); }
    } finally { lock.current = false; setBusy(false); onBusyChange?.(false); }
  }}>
    <h3 id={id + "-title"}>{uiText("修改密碼")}</h3>
    <label htmlFor={id + "-old"}>{uiText("目前的密碼")}</label>
    <input id={id + "-old"} type="password" autoComplete="current-password" value={oldPassword} required maxLength={128}
      disabled={busy || uncertain} onChange={e => { if (!lock.current) setOldPassword(e.target.value); }} />
    <label htmlFor={id + "-new"}>{uiText("新密碼")}</label>
    <input id={id + "-new"} type="password" autoComplete="new-password" value={newPassword} required minLength={6} maxLength={72}
      disabled={busy || uncertain} onChange={e => { if (!lock.current) setNewPassword(e.target.value); }} />
    <label htmlFor={id + "-confirm"}>{uiText("再輸入一次新密碼")}</label>
    <input id={id + "-confirm"} type="password" autoComplete="new-password" value={confirmation} required minLength={6} maxLength={72}
      disabled={busy || uncertain} onChange={e => { if (!lock.current) setConfirmation(e.target.value); }} />
    <small>{uiText("至少六個字元。更新後，所有裝置上的網頁登入都會失效，需要用新密碼登入。室友的 MCP 連線不受影響。")}</small>
    <button disabled={busy || uncertain}>{uiText(busy ? "正在更新…" : "更新密碼")}</button>
    <p role="status">{uiText(message)}</p>
    {uncertain && <button type="button" onClick={() => { clearTokens(); window.location.replace("/login"); }}>{uiText("重新登入確認")}</button>}
  </form>;
}
