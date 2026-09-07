import { useCallback, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { addBook, listBooks, uploadBook, type ReadingBook } from "../api/bookshelf";
import { ShelfHeader, ShelfProblem, ShelfShell } from "../components/BookshelfUI";
import { shelfError, useRoommateName, useShelfResource, type ShelfError } from "../hooks/useBookshelf";

export function ReadingShelfPage() {
  const name = useRoommateName();
  const resource = useShelfResource(useCallback((signal: AbortSignal) => listBooks(signal), []));
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState<ShelfError | null>(null);
  const [added, setAdded] = useState<ReadingBook | null>(null);
  const disabled = busy || resource.loading || !!resource.error;
  function selectFile(next?: File) {
    setError(null);
    if (!next) return;
    if (!/\.(txt|md|markdown|text)$/i.test(next.name) || next.size > 4 * 1024 * 1024 || next.size === 0) {
      setError({ message: "請選擇非空白、4MB 以內的 TXT 或 Markdown 檔案。" });
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    setFile(next);
    if (!title.trim()) setTitle(next.name.replace(/\.[^.]+$/, "").slice(0, 200));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current || disabled) return;
    setError(null); setAdded(null);
    if (!title.trim() || (!file && !text.trim())) { setError({ message: "請填寫書名，並貼上內容或選擇檔案。" }); return; }
    lock.current = true; setBusy(true);
    try {
      const book = file ? await uploadBook(file, title.trim(), author.trim()) : await addBook({ title: title.trim(), author: author.trim() || undefined, text: text.trim(), source_format: "txt" });
      setAdded(book); setTitle(""); setAuthor(""); setText(""); setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      resource.refresh();
    } catch (err) { setError(shelfError(err)); }
    finally { setBusy(false); lock.current = false; }
  }
  return <ShelfShell>
    <section className="card"><ShelfHeader title="一起讀書" />
      <div className="subheading"><span>你和{name}的私人書架</span><span>{!resource.loading && !resource.error ? `共 ${resource.data?.books.length ?? 0} 本` : "—"}</span></div>
      {resource.loading && <p className="shelf-status" role="status">正在整理書架…</p>}
      {resource.error && <ShelfProblem error={resource.error} onRetry={resource.refresh} />}
      {!resource.loading && !resource.error && <div className="book-list">
        {!resource.data?.books.length && <p className="empty">書架還空著。從下方放入第一本想一起讀的書。</p>}
        {resource.data?.books.map(book => <article className="book-item" key={book.id}>
          <div className="book-top"><span className="book-cover" aria-hidden="true">▤</span><div><h2>{book.title}</h2><small>{book.author || "未署名"}</small></div></div>
          <div><div className="progress-caption"><span>讀到第 {book.last_page} / {book.total_pages} 頁</span><span>{Math.round(Math.max(0, Math.min(1, book.progress)) * 100)}%</span></div><progress value={book.progress} max={1} aria-label={book.title + "閱讀進度"} /></div>
          <div className="book-bottom"><span>{book.highlights} 處劃線 · {book.notes} 則批注</span><Link to={"/reading/" + encodeURIComponent(book.id)}>繼續閱讀 →</Link></div>
        </article>)}
      </div>}
      {added && <p role="status" className="shelf-status">《{added.title}》已放上書架。<Link to={"/reading/" + encodeURIComponent(added.id)}>開始閱讀 →</Link></p>}
    </section>
    <section className="card"><h2>放一本書進來</h2><form onSubmit={submit}>
      <fieldset disabled={disabled}>
        <label className="field"><span>書名</span><input value={title} onChange={event => setTitle(event.target.value)} maxLength={200} required placeholder="這本書的名字" /></label>
        <label className="field"><span>作者（選填）</span><input value={author} onChange={event => setAuthor(event.target.value)} maxLength={100} placeholder="作者姓名" /></label>
        <label className="field"><span>書的內容</span><textarea rows={4} value={text} onChange={event => setText(event.target.value)} maxLength={2_000_000} required={!file} disabled={!!file} placeholder={file ? "已選擇檔案，將上傳檔案內容。" : "貼上文字，或從下方匯入 TXT / Markdown…"} /></label>
        <label className="file-label">↥ 匯入 .txt / .md<input ref={fileInput} type="file" accept=".txt,.md,.markdown,.text" onChange={event => selectFile(event.target.files?.[0])} /></label>
        {file && <><small>已選擇 {file.name}；按「放上書架」才會上傳。</small><button type="button" onClick={() => { setFile(null); if (fileInput.current) fileInput.current.value = ""; }}>移除檔案，改用貼上文字</button></>}
        <small>檔案最多 4MB，每本最多 200 萬字；書架最多 50 本。</small>
        {error && <ShelfProblem error={error} />}
        <button className="primary" type="submit">{busy ? "正在放上書架…" : "＋ 放上書架"}</button>
      </fieldset>
    </form></section>
  </ShelfShell>;
}
