import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { addHighlight, addReadingNote, readBook, removeHighlight, removeReadingNote, type Highlight, type ReadingNote } from "../api/bookshelf";
import { ShelfDialog, ShelfHeader, ShelfProblem, ShelfShell } from "../components/BookshelfUI";
import { shelfDate, shelfError, useRoommateName, useShelfResource, type ShelfError } from "../hooks/useBookshelf";
import { useAuth } from "../hooks/useAuth";

/** Text-only highlights have no offsets in the API. Mark every identical occurrence,
 * retaining both authors when highlights overlap; never inject uploaded HTML. */
function markedParagraph(text: string, highlights: Highlight[]): ReactNode[] {
  const ranges: { start: number; end: number; kind: string }[] = [];
  for (const highlight of highlights) {
    if (!highlight.text) continue;
    let from = 0, start: number;
    while ((start = text.indexOf(highlight.text, from)) !== -1) {
      ranges.push({ start, end: start + highlight.text.length, kind: highlight.author_kind });
      from = start + highlight.text.length;
    }
  }
  const boundaries = [...new Set([0, text.length, ...ranges.flatMap(range => [range.start, range.end])])].sort((a, b) => a - b);
  return boundaries.slice(0, -1).map((start, i) => {
    const end = boundaries[i + 1], active = ranges.filter(range => range.start <= start && range.end >= end);
    const kinds = [...new Set(active.map(range => range.kind))];
    return active.length ? <mark key={start} className={kinds.length > 1 ? "both" : kinds[0]} title={kinds.length > 1 ? "你與室友的劃線" : kinds[0] === "agent" ? "室友的劃線" : "你的劃線"}>{text.slice(start, end)}</mark> : text.slice(start, end);
  });
}

export function ReadingPage() {
  const { bookId = "" } = useParams();
  const [params] = useSearchParams();
  const value = params.get("page");
  const page = value === null ? undefined : Number(value);
  if (page !== undefined && (!Number.isInteger(page) || page < 1)) return <ShelfShell><section className="card"><ShelfHeader title="一起讀書" to="/reading" /><ShelfProblem error={{ message: "頁碼無效，請返回書架重新開啟。" }} /></section></ShelfShell>;
  // Remount per book/page so a stale response or selection cannot annotate another page.
  return <ReaderContent key={bookId + ":" + (page ?? "resume")} bookId={bookId} requestedPage={page} />;
}

function ReaderContent({ bookId, requestedPage }: { bookId: string; requestedPage?: number }) {
  const [, setParams] = useSearchParams();
  const { user } = useAuth();
  const name = useRoommateName();
  const resource = useShelfResource(useCallback((signal: AbortSignal) => readBook(bookId, requestedPage, signal), [bookId, requestedPage]));
  const data = resource.data;
  const contentRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{ idx: number; text: string; repeated: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState<ShelfError | null>(null);
  const [message, setMessage] = useState("");
  const [noteTarget, setNoteTarget] = useState<{ idx: number; quote: string; highlightId?: string } | null>(null);
  const [noteText, setNoteText] = useState("");
  const [deleting, setDeleting] = useState<{ kind: "highlight" | "note"; id: string; text: string } | null>(null);
  const available = !!data && !resource.loading && !resource.error;
  useEffect(() => { window.scrollTo(0, 0); }, []);
  useEffect(() => {
    const capture = () => {
      if (!available || busy) return;
      const current = window.getSelection();
      if (!current || current.isCollapsed || !current.rangeCount) return;
      const range = current.getRangeAt(0);
      const paragraph = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>(".paragraph-text");
      const first = paragraph(range.startContainer), last = paragraph(range.endContainer);
      if (!first || first !== last || !contentRef.current?.contains(first)) { setSelection(null); return; }
      const text = current.toString().trim(), idx = Number(first.dataset.idx);
      if ([...text].length < 2 || [...text].length > 2000 || !/[\p{L}\p{N}_]/u.test(text)) { setSelection(null); return; }
      const original = data?.paragraphs.find(item => item.idx === idx)?.text;
      if (!original?.includes(text)) { setSelection(null); return; }
      setSelection({ idx, text, repeated: original.indexOf(text) !== original.lastIndexOf(text) });
    };
    document.addEventListener("selectionchange", capture);
    return () => document.removeEventListener("selectionchange", capture);
  }, [available, busy, data]);

  async function mutate(job: () => Promise<void>) {
    if (lock.current || !available) return;
    lock.current = true; setBusy(true); setError(null); setMessage("");
    try { await job(); } catch (err) { setError(shelfError(err)); }
    finally { setBusy(false); lock.current = false; }
  }
  function highlight() {
    if (!selection || !data) return;
    const selected = selection;
    void mutate(async () => {
      const item = await addHighlight(bookId, selected.idx, selected.text);
      resource.setData({ ...data, highlights: [...data.highlights, item] });
      setSelection(null); window.getSelection()?.removeAllRanges(); setMessage("劃線已保存。");
    });
  }
  function openNote(idx: number, quote: string, highlightId?: string) {
    setNoteTarget({ idx, quote, highlightId }); setNoteText(""); setError(null);
  }
  function saveNote(event: FormEvent) {
    event.preventDefault();
    if (!noteTarget || !data || !noteText.trim()) return;
    const target = noteTarget;
    void mutate(async () => {
      const item = await addReadingNote(bookId, { paragraph_idx: target.idx, content: noteText.trim(), ...(target.highlightId ? { highlight_id: target.highlightId } : {}) });
      resource.setData({ ...data, notes: [...data.notes, item] }); setNoteTarget(null); setNoteText(""); setMessage("批注已保存。");
    });
  }
  function remove() {
    if (!deleting || !data) return;
    const target = deleting;
    void mutate(async () => {
      if (target.kind === "highlight") {
        await removeHighlight(bookId, target.id);
        resource.setData({ ...data, highlights: data.highlights.filter(item => item.id !== target.id), notes: data.notes.map(item => item.highlight_id === target.id ? { ...item, highlight_id: null } : item) });
      } else {
        await removeReadingNote(bookId, target.id);
        resource.setData({ ...data, notes: data.notes.filter(item => item.id !== target.id) });
      }
      setDeleting(null); setMessage("已刪除。");
    });
  }
  function turn(page: number) {
    if (busy || !available || !data || page < 1 || page > data.total_pages) return;
    setSelection(null); setParams({ page: String(page) }); titleRef.current?.focus();
  }
  const authorLabel = (kind: string) => kind === "agent" ? name : "你";
  const displayNote = (note: ReadingNote) => <aside key={note.id} className={"annotation " + note.author_kind}>
    <header><span>{authorLabel(note.author_kind)} · {shelfDate(note.created_at, user?.timezone)}</span>
      {note.author_kind === "human" && <button disabled={busy} aria-label="刪除你的批注" onClick={() => { setError(null); setDeleting({ kind: "note", id: note.id, text: note.content }); }}>刪除</button>}
    </header>{note.highlight_id && <small>回應劃線：{data?.highlights.find(item => item.id === note.highlight_id)?.text ?? "原劃線已移除"}</small>}<p>{note.content}</p>
  </aside>;
  return <ShelfShell>
    <section className="card reader-card">
      <div ref={titleRef} tabIndex={-1}><ShelfHeader title="一起讀書" to="/reading" /></div>
      {resource.loading && <p className="shelf-status" role="status">正在打開書頁…</p>}
      {resource.error && <ShelfProblem error={resource.error} onRetry={resource.refresh} />}
      {available && data && <>
        <div className="reader-title"><span className="eyebrow">正在共讀</span><h2>{data.title}</h2></div>
        <div className="reading-legend"><span className="human-dot">● 你</span><span className="agent-dot">● {name}</span></div>
        <p className="read-hint">選取同一段中的 2～2000 字，再按「劃線」。</p>
        {selection && <div className="selection-bar"><span title={selection.text}>「{selection.text}」{selection.repeated && <small>相同片段重複時會一併標示。</small>}</span><button disabled={busy} onClick={highlight}>劃線</button><button disabled={busy} aria-label="取消選字" onClick={() => { setSelection(null); window.getSelection()?.removeAllRanges(); }}>×</button></div>}
        {message && <p className="shelf-status" role="status">{message}</p>}
        {error && !noteTarget && !deleting && <ShelfProblem error={error} />}
        <article ref={contentRef} aria-label="書籍內容">
          {data.paragraphs.length === 0 && <p className="empty">這頁沒有可讀取的段落。</p>}
          {data.paragraphs.map(paragraph => {
            const highlights = data.highlights.filter(item => item.paragraph_idx === paragraph.idx);
            return <section className="paragraph" key={paragraph.idx}>
              <p className="paragraph-text" data-idx={paragraph.idx}>{markedParagraph(paragraph.text, highlights)}</p>
              {data.notes.filter(item => item.paragraph_idx === paragraph.idx).map(displayNote)}
              {highlights.length > 0 && <details className="annotation-tools"><summary>{highlights.length} 處劃線</summary>{highlights.map(item => <div key={item.id}>
                <span className={item.author_kind === "agent" ? "agent-dot" : "human-dot"}>{authorLabel(item.author_kind)}的劃線</span><blockquote>{item.text}</blockquote>
                <div className="annotation-actions"><button disabled={busy} onClick={() => openNote(paragraph.idx, item.text, item.id)}>批注這段劃線</button>{item.author_kind === "human" && <button disabled={busy} onClick={() => { setError(null); setDeleting({ kind: "highlight", id: item.id, text: item.text }); }}>取消我的劃線</button>}</div>
              </div>)}</details>}
              <div className="paragraph-actions"><button disabled={busy} aria-label={`為第 ${paragraph.idx} 段批注`} onClick={() => openNote(paragraph.idx, paragraph.text)}>＋ 批注</button></div>
            </section>;
          })}
        </article>
        <nav className="pagination" aria-label="翻頁"><button disabled={busy || data.page <= 1} onClick={() => turn(data.page - 1)}>← 上一頁</button><span aria-live="polite">{data.page} / {data.total_pages}</span><button disabled={busy || data.page >= data.total_pages} onClick={() => turn(data.page + 1)}>下一頁 →</button></nav>
        <small className="reader-note">翻頁時自動記錄進度，下次從這裡接著讀。</small>
      </>}
    </section>
    {noteTarget && <ShelfDialog title="留一則批注" busy={busy} onClose={() => setNoteTarget(null)}><form onSubmit={saveNote}>
      <p>「{noteTarget.quote.slice(0, 160)}{noteTarget.quote.length > 160 ? "…" : ""}」</p>
      <label className="field"><span>你的批注</span><textarea autoFocus rows={4} maxLength={4000} value={noteText} onChange={event => setNoteText(event.target.value)} required disabled={busy} placeholder="這一段讓你想到什麼？" /></label>
      {error && <ShelfProblem error={error} />}
      <div className="dialog-actions"><button type="button" disabled={busy} onClick={() => setNoteTarget(null)}>取消</button><button className="primary" disabled={busy || !noteText.trim()} type="submit">{busy ? "保存中…" : "保存批注"}</button></div>
    </form></ShelfDialog>}
    {deleting && <ShelfDialog title={deleting.kind === "highlight" ? "取消這條劃線？" : "刪除這則批注？"} busy={busy} onClose={() => setDeleting(null)}>
      <p>{deleting.text}</p><p>{deleting.kind === "highlight" ? "只移除劃線，已有的批注會保留。" : "刪除後無法復原。"}</p>
      {error && <ShelfProblem error={error} />}
      <div className="dialog-actions"><button disabled={busy} onClick={() => setDeleting(null)}>保留</button><button className="primary" disabled={busy} onClick={remove}>{busy ? "刪除中…" : "確認刪除"}</button></div>
    </ShelfDialog>}
  </ShelfShell>;
}
