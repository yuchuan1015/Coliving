import { createContext, useContext, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { shelfError, type ShelfError } from "../hooks/useBookshelf";
import { FIELDS, type FieldId } from "./fieldData";
import "./fields.css";
import { SpaceChat } from "./SpaceChat";
import { CHAT_SPACES, type ChatSpace } from "./socialData";
import { FormValidationError } from "./formErrors";
export function FieldFrame({ id, children, chatEnabled = true }: { id: FieldId; children: ReactNode; chatEnabled?: boolean }) {
  const field = FIELDS.find(f => f[0] === id)!;
  return <main className="field-app"><div className="field-shell">
    <header className="field-topbar"><Link className="field-button" to="/outside">← 出艙導航</Link><small>THE ROOKERY / {String(FIELDS.indexOf(field) + 1).padStart(2, "0")}</small></header>
    <section className="field-hero"><img src={`/field-preview/assets/${field[6]}`} alt={`${field[2]}的太空場景`} /><div><small>{field[2]}</small><h1>{field[1]}</h1><p>l {field[3]}° · b {field[4] >= 0 ? "+" : ""}{field[4]}° · {field[5]} ly</p></div></section>
    {children}{chatEnabled && (CHAT_SPACES as readonly string[]).includes(id) && <SpaceChat key={id} space={id as ChatSpace} />}<footer><Link to="/outside">← 選擇其他目的地</Link><span>社區時間 · Asia/Taipei</span></footer>
  </div></main>;
}
export function FieldPanel({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) { return <section className="field-panel">{(title || action) && <div className="field-row field-section-top"><h2>{title}</h2>{action}</div>}{children}</section>; }
export function FieldTabs({ options, value, onChange }: { options: Record<string, string>; value: string; onChange: (value: string) => void }) { const { busy } = useContext(DialogBusy); return <nav className="field-tabs" aria-label="內容分類">{Object.entries(options).map(([key, label]) => <button key={key} disabled={busy} aria-pressed={key === value} onClick={() => onChange(key)}>{label}</button>)}</nav>; }
export function FieldError({ error, retry }: { error?: ShelfError; retry?: () => void }) { return error ? <div className="field-notice" role="alert"><p>{error.message}</p>{error.status === 403 && /出生|年齡/.test(error.message) && <Link className="field-button" to="/settings">查看出生年設定</Link>}{retry && <button onClick={retry}>重新讀取</button>}</div> : null; }
export function ResourceState({ resource, empty }: { resource: { loading: boolean; error?: ShelfError; refresh: () => void }; empty?: boolean }) { return <>{resource.loading && <p role="status">正在讀取…</p>}<FieldError error={resource.error} retry={resource.refresh} />{!resource.loading && !resource.error && empty && <p className="field-empty">這裡還沒有內容。</p>}</>; }
const DialogBusy = createContext({ busy: false, setBusy: (_busy: boolean) => {} });
export function FieldDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null); const [busy, setBusy] = useState(false); const id = useId();
  useEffect(() => { const focus = document.activeElement as HTMLElement | null; ref.current?.showModal(); return () => { if (focus?.isConnected) focus.focus(); }; }, []);
  return <dialog ref={ref} className="field-dialog field-app" aria-labelledby={id} onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}><header className="field-row"><h2 id={id}>{title}</h2><button type="button" disabled={busy} onClick={onClose} aria-label="關閉">×</button></header><DialogBusy.Provider value={{ busy, setBusy }}><fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>{children}</fieldset></DialogBusy.Provider></dialog>;
}
export function FieldForm({ submit, children, label = "保存", onDone, guarded = false, onBusyChange }: { submit: (data: FormData) => Promise<unknown>; children: ReactNode; label?: string; onDone: () => void; guarded?: boolean; onBusyChange?: (busy: boolean) => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState<ShelfError>(); const lock = useRef(false); const { setBusy: dialogBusy } = useContext(DialogBusy);
  const [uncertain, setUncertain] = useState(false);
  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (lock.current || uncertain) return;
    const payload = new FormData(e.currentTarget); lock.current = true; setBusy(true); dialogBusy(true); onBusyChange?.(true); setError(undefined);
    try { await submit(payload); onDone(); }
    catch (err) { const failure = shelfError(err); setError(failure); if (guarded && !(err instanceof FormValidationError) && (!failure.status || failure.status >= 500)) setUncertain(true); }
    finally { lock.current = false; setBusy(false); dialogBusy(false); onBusyChange?.(false); }
  }
  return <form onSubmit={send} className="field-form"><fieldset disabled={busy}>{children}<FieldError error={error} />{uncertain && <p role="alert">尚未確認是否已送達，請關閉後重新讀取狀態再決定是否重試，避免重複送出。</p>}<button type="submit" className="primary" disabled={uncertain}>{busy ? "處理中…" : label}</button></fieldset></form>;
}
export function FieldInput({ name, label, max = 200, value, type = "text", required = true }: { name: string; label: string; max?: number; value?: string; type?: string; required?: boolean }) { return <label className="field-input">{label}<input name={name} type={type} maxLength={max} defaultValue={value} required={required} /></label>; }
export function FieldText({ name = "content", label = "內容", max = 2000, value }: { name?: string; label?: string; max?: number; value?: string }) { return <label className="field-input">{label}<textarea name={name} required maxLength={max} defaultValue={value} rows={5} /></label>; }
export function FieldSelect({ name, label, options, value }: { name: string; label: string; options: Record<string, string>; value?: string }) { return <label className="field-input">{label}<select name={name} defaultValue={value} required>{Object.entries(options).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>; }
export function ConfirmAction({ title, action, onDone, label = "確認" }: { title: string; action: () => Promise<unknown>; onDone: () => void; label?: string }) {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>{title}</button>{open && <FieldDialog title={title} onClose={() => setOpen(false)}><FieldForm label={label} submit={action} onDone={() => { setOpen(false); onDone(); }}><p>確認要{title}嗎？此操作會更新實際資料。</p></FieldForm></FieldDialog>}</>;
}
