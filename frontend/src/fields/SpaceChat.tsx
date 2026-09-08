import { useEffect, useRef, useState } from "react";
import api from "../api/client";
import { shelfError } from "../hooks/useBookshelf";
import { fieldTime, formText, useFieldResource } from "./fieldData";
import { FieldForm, FieldPanel, FieldText, ResourceState } from "./shared";
import { FormValidationError } from "./formErrors";
import { remainingTime, unexpiredMessages, type ChatSpace, type SpaceMessage } from "./socialData";

export function SpaceChat({ space }: { space: ChatSpace }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return <FieldPanel title="在這裡聊聊" action={<button disabled={busy} aria-expanded={open} onClick={() => setOpen(v => !v)}>{open ? "收起聊天" : "展開聊天"}</button>}>
    {open ? <SpaceChatContent key={space} space={space} onBusyChange={setBusy} /> : <p>與在場的室友說話。訊息保留 24 小時，離開前可以匯出帶走。</p>}
  </FieldPanel>;
}

export function SpaceChatContent({ space, onBusyChange }: { space: ChatSpace; onBusyChange?: (busy: boolean) => void }) {
  const base = `/spaces/${space}`;
  const people = useFieldResource<{ present: { id: string; name: string; avatar_emoji: string }[] }>(`${base}/present`);
  const chat = useFieldResource<{ messages: SpaceMessage[] }>(`${base}/chat?limit=200`);
  const [mentions, setMentions] = useState<string[]>([]);
  const [notice, setNotice] = useState(""); const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(() => Date.now()); const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<{ url: string; text: string } | null>(null);
  const [sending, setSending] = useState(false);
  const exportLock = useRef(false);
  const exportRequest = useRef<AbortController | null>(null);
  useEffect(() => () => exportRequest.current?.abort(), []);
  useEffect(() => { const tick = window.setInterval(() => setNow(Date.now()), 30000); return () => window.clearInterval(tick); }, []);
  useEffect(() => () => { if (exported) URL.revokeObjectURL(exported.url); }, [exported]);
  const validNames = people.data?.present.map(a => a.name) ?? [];
  const selected = mentions.filter(name => validNames.includes(name));
  function refresh() { people.refresh(); chat.refresh(); setNow(Date.now()); }
  const messages = unexpiredMessages(chat.data?.messages ?? [], now);
  async function exportChat() {
    if (exportLock.current) return; exportLock.current = true; setExporting(true); setNotice(""); setExported(null);
    const controller = new AbortController(); exportRequest.current = controller;
    try {
      const { data } = await api.get<string>(`${base}/chat/export`, { responseType: "text", signal: controller.signal });
      if (controller.signal.aborted) return;
      setExported({ text: data, url: URL.createObjectURL(new Blob([data], { type: "text/markdown;charset=utf-8" })) });
      setNotice("匯出已準備好，點下載保存。這份快照保留匯出當時的內容。");
    } catch (err) { if (!controller.signal.aborted) setNotice(shelfError(err).message); }
    finally { exportLock.current = false; setExporting(false); }
  }
  return <div className="field-stack">
    <div className="field-actions"><button disabled={sending} onClick={refresh}>更新聊天與名單</button><button disabled={exporting || sending} onClick={() => void exportChat()}>{exporting ? "準備中…" : "匯出帶走"}</button></div>
    <p role="status">{notice}</p>{exported && <div className="field-stack"><a className="field-button" href={exported.url} download={`${space}-chat.md`}>下載聊天 Markdown</a><details><summary>無法下載？展開後長按複製</summary><textarea aria-label="匯出的聊天文字" readOnly value={exported.text} rows={8} /></details></div>}
    <ResourceState resource={chat} empty={!messages.length} />
    {chat.data && <><small>最近最多 200 則 · 社區時間 · 到期訊息不再顯示</small><div className="field-chat" aria-label="場域聊天訊息">{messages.map(m => <article key={m.id} className={`field-bubble space-${m.sender_kind}`}><small>{m.sender} · {m.sender_kind === "human" ? "居民" : "AI 室友"} · {fieldTime(m.created_at)}</small><p>{m.content}</p><small>{m.mentions.map(name => `@${name}`).join("、")} · {remainingTime(m.expires_at, now)}</small></article>)}</div></>}
    <ResourceState resource={people} />
    {people.data && <FieldForm guarded key={revision} label="送出訊息" onBusyChange={busy => { setSending(busy); onBusyChange?.(busy); }} submit={async data => {
      const content = formText(data, "content");
      if (!content || content.length > 1000) throw new FormValidationError("請填寫 1～1000 字的訊息。");
      if (!selected.length && !validNames.some(name => content.includes(`@${name}`))) throw new FormValidationError("請選擇或 @ 至少一位在場的室友。");
      await api.post(`${base}/chat`, { content, mentions: selected });
    }} onDone={() => { setRevision(n => n + 1); setMentions([]); setNotice("訊息已送出。"); refresh(); }}>
      <fieldset><legend>@ 在場的室友</legend>{people.data.present.length ? people.data.present.map(a => <label className="field-check" key={a.id}><input type="checkbox" checked={selected.includes(a.name)} onChange={e => setMentions(v => e.target.checked ? [...new Set([...v, a.name])] : v.filter(name => name !== a.name))} />{a.avatar_emoji} {a.name}</label>) : <p>目前沒有在場的室友，稍後更新名單再聊。</p>}</fieldset>
      <FieldText label="想說的話" max={1000} /><small>至少 @ 一位在場的室友；名單可能變動，以送出時的後端驗證為準。</small>
    </FieldForm>}
  </div>;
}
