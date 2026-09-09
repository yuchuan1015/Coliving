import { uiText } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import { useCallback, useRef, useState, type FormEvent } from "react";
import { deleteMemory, exportMemories, listMemories, remember, searchMemories, type MemoryItem } from "../api/bookshelf";
import { ShelfDialog, ShelfHeader, ShelfProblem, ShelfShell, ShelfTrash } from "../components/BookshelfUI";
import { downloadShelf, shelfDate, shelfError, useRoommateName, useShelfResource, type ShelfError } from "../hooks/useBookshelf";
import { useAuth } from "../hooks/useAuth";

export function MemoryPage() {
  useUiLanguage();
  const name = useRoommateName();
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [actionError, setActionError] = useState<ShelfError | null>(null);
  const [message, setMessage] = useState("");
  const [deleting, setDeleting] = useState<MemoryItem | null>(null);
  const resource = useShelfResource(useCallback((signal: AbortSignal) => query ? searchMemories(query, signal) : listMemories(signal), [query]));
  const available = !resource.loading && !resource.error;
  // Search results are ranked by the service; full lists use chronological order.
  const items = query ? resource.data?.items ?? [] : [...(resource.data?.items ?? [])].sort((a, b) => (Date.parse(b.created_at ?? "") || 0) - (Date.parse(a.created_at ?? "") || 0));
  async function mutate(job: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setActionError(null); setMessage("");
    try { await job(); } catch (error) { setActionError(shelfError(error)); }
    finally { lock.current = false; setBusy(false); }
  }
  function add(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() || !available) return;
    void mutate(async () => {
      const result = await remember(text.trim());
      if (!result.ok) throw new Error("寫入未完成，請稍後重試。");
      setText(""); setSearch(""); setQuery("");
      setMessage("已送入記憶庫。系統可能整理成摘要，以下重新讀取保存結果。"); resource.refresh();
    });
  }
  function remove() {
    if (!deleting?.id) return;
    const id = deleting.id;
    void mutate(async () => { await deleteMemory(id); setDeleting(null); setMessage("這則記憶已刪除。"); resource.refresh(); });
  }
  function exportAll(format: "json" | "markdown") {
    void mutate(async () => {
      const result = await exportMemories(format);
      if (result.format === "markdown") downloadShelf("我的記憶.md", result.content, "text/markdown;charset=utf-8");
      else downloadShelf("我的記憶.json", JSON.stringify(result, null, 2), "application/json;charset=utf-8");
      setMessage("已匯出完整記憶庫，不只目前的搜尋結果。");
    });
  }
  return <ShelfShell>
    <section className="card">
      <ShelfHeader title={uiText("我的記憶")} />
      <div className="subheading"><span>{name}{uiText("的記憶庫")}</span><span>mem0</span></div>
      <form className="search-form" onSubmit={event => { event.preventDefault(); setQuery(search.trim()); setActionError(null); resource.refresh(); }}>
        <label className="search"><span aria-hidden="true">⌕</span><input type="search" maxLength={500} value={search} onChange={event => { setSearch(event.target.value); if (!event.target.value) setQuery(""); }} placeholder={uiText("搜尋記憶…")} aria-label={uiText("搜尋記憶")} disabled={busy} /><button type="submit" disabled={busy}>{uiText("搜尋")}</button></label>
        {query && <small>{uiText("顯示「")}{query}{uiText("」的相關記憶，最多 50 則。")}<button className="text-button" type="button" disabled={busy} onClick={() => { setSearch(""); setQuery(""); }}>{uiText("返回全部記憶")}</button></small>}
      </form>
      <div className="section-heading"><h2>{query ? uiText("搜尋結果") : uiText("記憶列表")}</h2><span>{available ? uiText`共 ${resource.data?.count ?? 0} 則` : "—"}</span></div>
      {resource.loading && <p className="shelf-status" role="status">{uiText("正在讀取記憶…")}</p>}
      {resource.error && <ShelfProblem error={resource.error} onRetry={resource.refresh} />}
      {available && <div className="memory-list" tabIndex={0} aria-label={uiText("記憶列表")}>
        {!items.length && <p className="empty">{query ? uiText("沒有找到相關記憶，試試其他關鍵字。") : uiText("這裡還沒有記憶。從下方加入第一件想記住的事。")}</p>}
        {items.map((item, index) => <article className="memory-item" key={item.id ?? `result-${index}`}>
          <div><time dateTime={item.created_at ?? undefined}>{item.created_at ? shelfDate(item.created_at, user?.timezone) : query ? uiText("相關記憶") : uiText("時間未提供")}</time><p>{item.text}</p></div>
          {item.id && <button type="button" disabled={busy} aria-label={uiText`刪除記憶：${item.text.slice(0, 40)}`} onClick={() => { setDeleting(item); setActionError(null); }}><ShelfTrash /></button>}
        </article>)}
      </div>}
      {available && query && items.some(item => !item.id) && <p className="shelf-status">{uiText("要刪除記憶，請先返回全部記憶列表。")}</p>}
      <footer className="export-row"><span>{uiText("↓ 匯出記憶")}</span><div><button disabled={!available || busy} onClick={() => exportAll("json")}>JSON</button><button disabled={!available || busy} onClick={() => exportAll("markdown")}>Markdown</button></div></footer>
      {message && <p role="status" className="shelf-status">{uiText(message)}</p>}
      {actionError && !deleting && <ShelfProblem error={actionError} />}
    </section>
    <section className="card"><h2>{uiText("新增記憶")}</h2><form onSubmit={add}>
      <fieldset disabled={busy || !available}>
        <label className="field"><span>{uiText("想讓室友記得的事")}</span><textarea rows={3} maxLength={5000} value={text} onChange={event => setText(event.target.value)} placeholder={uiText("寫下一件值得記住的小事…")} required /></label>
        <small>{uiText("手動加入記憶庫 ")}<span>{text.length} / 5000</span></small>
        <button className="primary" type="submit" disabled={!text.trim()}>{busy ? uiText("處理中…") : uiText("＋ 加入記憶")}</button>
      </fieldset>
    </form></section>
    {deleting && <ShelfDialog title={uiText("刪除這則記憶？")} busy={busy} onClose={() => setDeleting(null)}>
      <p>{uiText("刪除後無法復原。")}</p><p>{deleting.text}</p>
      {actionError && <ShelfProblem error={actionError} />}
      <div className="dialog-actions"><button disabled={busy} onClick={() => setDeleting(null)}>{uiText("保留")}</button><button className="primary" disabled={busy} onClick={remove}>{busy ? uiText("刪除中…") : uiText("確認刪除")}</button></div>
    </ShelfDialog>}
  </ShelfShell>;
}
