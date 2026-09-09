import { uiText } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import { useEffect, useRef, useState } from "react";
import { isAxiosError } from "axios";
import api from "../api/client";
import { shelfError, type ShelfError } from "../hooks/useBookshelf";
import { fieldTime, formText, useFieldResource } from "./fieldData";
import { FieldError, FieldForm, FieldPanel, FieldText, ResourceState } from "./shared";
import { FormValidationError } from "./formErrors";
import { remainingTime, unexpiredMessages, type ChatSpace, type SpaceMessage } from "./socialData";

function chatError(error: unknown): ShelfError {
  const failure = shelfError(error);
  // Markdown downloads use responseType:text, even when the server returns JSON errors.
  if (isAxiosError(error) && typeof error.response?.data === "string") {
    try {
      const body = JSON.parse(error.response.data);
      if (typeof body?.detail === "string") return { ...failure, message: body.detail };
    } catch { /* Non-JSON errors keep the existing safe fallback. */ }
  }
  return failure;
}

export function SpaceChat({ space }: { space: ChatSpace }) {
  useUiLanguage();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return <FieldPanel title={uiText("在這裡聊聊")} action={<button disabled={busy} aria-expanded={open} onClick={() => setOpen(v => !v)}>{open ? uiText("收起聊天") : uiText("展開聊天")}</button>}>
    {open ? <SpaceChatContent key={space} space={space} onBusyChange={setBusy} /> : <p>{uiText("與在場的室友說話。訊息保留 24 小時，離開前可以匯出帶走。")}</p>}
  </FieldPanel>;
}

export function SpaceChatContent({ space, onBusyChange }: { space: ChatSpace; onBusyChange?: (busy: boolean) => void }) {
  useUiLanguage();
  const base = `/spaces/${space}`;
  const people = useFieldResource<{ present: { id: string; name: string; avatar_emoji: string }[] }>(`${base}/present`);
  const chat = useFieldResource<{ messages: SpaceMessage[] }>(`${base}/chat?limit=200`);
  const [mentions, setMentions] = useState<string[]>([]);
  const [notice, setNotice] = useState(""); const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(() => Date.now()); const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<{ url: string; text: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [accessError, setAccessError] = useState<ShelfError>();
  const exportLock = useRef(false);
  const exportRequest = useRef<AbortController | null>(null);
  useEffect(() => () => exportRequest.current?.abort(), []);
  useEffect(() => { const tick = window.setInterval(() => setNow(Date.now()), 30000); return () => window.clearInterval(tick); }, []);
  useEffect(() => () => { if (exported) URL.revokeObjectURL(exported.url); }, [exported]);
  const validNames = people.data?.present.map(a => a.name) ?? [];
  const selected = mentions.filter(name => validNames.includes(name));
  const forbidden = accessError ?? [people.error, chat.error].find(error => error?.status === 403);
  const ready = !!people.data && !!chat.data && !people.loading && !chat.loading && !people.error && !chat.error && !forbidden;
  function refresh() { setAccessError(undefined); setExported(null); setNotice(""); people.refresh(); chat.refresh(); setNow(Date.now()); }
  function denyAccess(error: ShelfError) {
    exportRequest.current?.abort(); setExported(null); setMentions([]); setNotice(""); setAccessError(error);
  }
  const messages = unexpiredMessages(chat.data?.messages ?? [], now);
  async function exportChat() {
    if (exportLock.current || !ready || sending) return; exportLock.current = true; setExporting(true); setNotice(""); setExported(null);
    const controller = new AbortController(); exportRequest.current = controller;
    try {
      const { data } = await api.get<string>(`${base}/chat/export`, { responseType: "text", signal: controller.signal });
      if (controller.signal.aborted) return;
      setExported({ text: data, url: URL.createObjectURL(new Blob([data], { type: "text/markdown;charset=utf-8" })) });
      setNotice("匯出已準備好，點下載保存。這份快照保留匯出當時的內容。");
    } catch (err) {
      if (!controller.signal.aborted) {
        const failure = chatError(err);
        if (failure.status === 403) denyAccess(failure);
        else setNotice(failure.message);
      }
    }
    finally { exportLock.current = false; setExporting(false); }
  }
  if (forbidden) return <FieldError error={forbidden} retry={refresh} />;
  return <div className="field-stack">
    <div className="field-actions"><button disabled={sending || exporting} onClick={refresh}>{uiText("更新聊天與名單")}</button><button disabled={!ready || exporting || sending} onClick={() => void exportChat()}>{exporting ? uiText("準備中…") : uiText("匯出帶走")}</button></div>
    <p role="status">{uiText(notice)}</p>{exported && <div className="field-stack"><a className="field-button" href={exported.url} download={`${space}-chat.md`}>{uiText("下載聊天 Markdown")}</a><details><summary>{uiText("無法下載？展開後長按複製")}</summary><textarea aria-label={uiText("匯出的聊天文字")} readOnly value={exported.text} rows={8} /></details></div>}
    <ResourceState resource={chat} empty={!messages.length} />
    {chat.data && <><small>{uiText("最近最多 200 則 · 社區時間 · 到期訊息不再顯示")}</small><div className="field-chat" aria-label={uiText("場域聊天訊息")}>{messages.map(m => <article key={m.id} className={`field-bubble space-${m.sender_kind}`}><small>{m.sender} · {m.sender_kind === "human" ? uiText("居民") : uiText("AI 室友")} · {fieldTime(m.created_at)}</small><p>{m.content}</p><small>{m.mentions.map(name => `@${name}`).join("、")} · {remainingTime(m.expires_at, now)}</small></article>)}</div></>}
    <ResourceState resource={people} />
    {ready && people.data && <FieldForm guarded key={revision} label={uiText("送出訊息")} onBusyChange={busy => { setSending(busy); onBusyChange?.(busy); }} submit={async data => {
      const content = formText(data, "content");
      if (!content || content.length > 1000) throw new FormValidationError("請填寫 1～1000 字的訊息。");
      if (!selected.length && !validNames.some(name => content.includes(`@${name}`))) throw new FormValidationError("請選擇或 @ 至少一位在場的室友。");
      try { await api.post(`${base}/chat`, { content, mentions: selected }); }
      catch (err) { const failure = chatError(err); if (failure.status === 403) denyAccess(failure); throw err; }
    }} onDone={() => { setRevision(n => n + 1); setMentions([]); refresh(); setNotice("訊息已送出。"); }}>
      <fieldset><legend>{uiText("@ 在場的室友")}</legend>{people.data.present.length ? people.data.present.map(a => <label className="field-check" key={a.id}><input type="checkbox" checked={selected.includes(a.name)} onChange={e => setMentions(v => e.target.checked ? [...new Set([...v, a.name])] : v.filter(name => name !== a.name))} />{a.avatar_emoji} {a.name}</label>) : <p>{uiText("目前沒有在場的室友，稍後更新名單再聊。")}</p>}</fieldset>
      <FieldText label={uiText("想說的話")} max={1000} /><small>{uiText("至少 @ 一位在場的室友；名單可能變動，以送出時的後端驗證為準。")}</small>
    </FieldForm>}
  </div>;
}
