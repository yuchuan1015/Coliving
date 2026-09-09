import { uiText } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { isAxiosError } from "axios";
import { deletePhoto, getPhotos, PHOTO_ACCEPT, updatePhoto, uploadPhoto, validatePhotoFile, type CabinPhoto, type PhotoAlbum } from "../api/furniture";
import { PhotoImage } from "../components/PhotoImage";
import "../photo-album.css";

function message(error: unknown, fallback: string) {
  const detail = isAxiosError(error) ? error.response?.data?.detail : undefined;
  return typeof detail === "string" ? detail : fallback;
}

export function PhotoFramePage() {
  useUiLanguage();
  const navigate = useNavigate();
  const [album, setAlbum] = useState<PhotoAlbum | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState("refresh");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [edit, setEdit] = useState<{ id: string; original: string; draft: string } | null>(null);
  const lock = useRef(false);
  const alive = useRef(true);
  const picker = useRef<HTMLInputElement>(null);
  const captionEditor = useRef<HTMLTextAreaElement>(null);
  const dirty = Boolean(file || caption || (edit && edit.draft !== edit.original));
  const full = Boolean(album && album.photos.length >= Math.min(20, album.max));
  const displayed = album?.photos.find(photo => photo.id === album.displayed_id);

  const read = useCallback(async () => {
    const data = await getPhotos();
    if (alive.current) { setAlbum(data); setReady(true); }
  }, []);
  const refresh = useCallback(async () => {
    if (lock.current) return;
    lock.current = true; setBusy("refresh"); setError("");
    try { await read(); }
    catch (err) { if (alive.current) { setReady(false); setError(message(err, "相簿暫時無法讀取，請重新載入。")); } }
    finally { lock.current = false; if (alive.current) setBusy(""); }
  }, [read]);
  useEffect(() => {
    alive.current = true;
    // Initial read is independent of the mutation lock, including StrictMode replay.
    let cancelled = false;
    getPhotos().then(data => { if (!cancelled) { setAlbum(data); setReady(true); } })
      .catch(err => { if (!cancelled) setError(message(err, "相簿暫時無法讀取，請重新載入。")); })
      .finally(() => { if (!cancelled) setBusy(""); });
    return () => { alive.current = false; cancelled = true; };
  }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);
  useEffect(() => { captionEditor.current?.focus(); }, [edit?.id]);

  function back() {
    if (lock.current) return;
    if (!dirty || window.confirm("還有未保存的照片或說明，要放棄修改並返回艙室嗎？")) navigate("/");
  }
  function clearUpload() {
    setFile(null); setPreview(null); setCaption("");
    if (picker.current) picker.current.value = "";
  }
  function choose(next?: File) {
    if (!next || lock.current) return;
    const problem = validatePhotoFile(next);
    if (problem) { setError(problem); if (picker.current) picker.current.value = ""; return; }
    setFile(next); setPreview(URL.createObjectURL(next)); setError(""); setNotice("");
  }
  async function mutate(key: string, action: () => Promise<unknown>, success: string, onSaved?: () => void) {
    if (lock.current || !ready) return;
    lock.current = true; setBusy(key); setError(""); setNotice("");
    let saved = false;
    try {
      await action(); saved = true;
      if (!alive.current) return;
      onSaved?.(); setNotice(success);
      // Re-read: deleting a displayed photo can select another server-side.
      await read();
    } catch (err) {
      if (!alive.current) return;
      const uncertain = isAxiosError(err) && !err.response;
      if (saved || uncertain) setReady(false);
      setError(saved ? "變更已保存，但清單未能更新。請按「更新相簿」，不要重複提交。" : uncertain ? "連線中斷，結果尚未確認。請先更新相簿檢查是否已完成，再操作；草稿仍保留。" : message(err, "操作未完成，草稿仍保留，請稍後重試。"));
    } finally { lock.current = false; if (alive.current) setBusy(""); }
  }
  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!file || full || Array.from(caption.trim()).length > 200) return;
    await mutate("upload", () => uploadPhoto(file, caption), "照片已收藏。", clearUpload);
  }
  function startEdit(photo: CabinPhoto) {
    if (lock.current || (edit && edit.draft !== edit.original && !window.confirm("放棄這張照片尚未保存的說明嗎？"))) return;
    setEdit({ id: photo.id, original: photo.caption, draft: photo.caption }); setError("");
  }
  function cancelEdit() {
    if (lock.current || (edit && edit.draft !== edit.original && !window.confirm("放棄尚未保存的照片說明嗎？"))) return;
    setEdit(null);
  }
  async function saveCaption(event: FormEvent) {
    event.preventDefault();
    if (!edit || Array.from(edit.draft.trim()).length > 200) return;
    await mutate(`caption:${edit.id}`, () => updatePhoto(edit.id, { caption: edit.draft.trim() }), "照片說明已保存。", () => setEdit(null));
  }
  async function remove(photo: CabinPhoto) {
    if (lock.current || !ready) return;
    const replacement = photo.id === album?.displayed_id ? "若還有其他照片，相框會自動擺上最新的一張。" : "";
    if (!window.confirm(`確定刪除${photo.caption ? `「${photo.caption}」` : "這張照片"}？刪除後無法復原。${replacement}`)) return;
    await mutate(`delete:${photo.id}`, () => deletePhoto(photo.id), "照片已刪除。", () => { if (edit?.id === photo.id) setEdit(null); });
  }
  const unavailable = Boolean(busy) || !ready;
  return <main className="photo-album">
    <div className="photo-album-stack">
      <header className="photo-album-header">
        <div><p className="photo-eyebrow">CABIN / PHOTO FRAME</p><h1>{uiText("相框")}</h1></div>
        <button type="button" onClick={back} disabled={Boolean(busy)}>{uiText("← 返回艙室")}</button>
      </header>
      <div className="photo-status" aria-live="polite">{notice && <p role="status">{uiText(notice)}</p>}{error && <p role="alert">{uiText(error)}</p>}</div>
      <section className="photo-panel photo-display" aria-labelledby="photo-display-title" aria-busy={busy === "refresh"}>
        <div className="photo-section-heading"><div><p className="photo-eyebrow">ON DISPLAY</p><h2 id="photo-display-title">{uiText("此刻，擺在相框裡")}</h2></div><span className="photo-badge">{displayed ? uiText("展示中") : ready ? uiText("尚未擺放") : uiText("待同步")}</span></div>
        {displayed ? <figure className="photo-main-frame"><PhotoImage src={displayed.url} alt={displayed.caption || uiText("目前展示的照片")} /><figcaption>{displayed.caption || uiText("沒有留下說明的瞬間")}</figcaption></figure> : <div className="photo-empty-frame"><span aria-hidden="true">▧</span><p>{!ready ? busy ? uiText("正在讀取相框…") : uiText("相框尚未同步") : album?.photos.length ? uiText("相框先空著。") : uiText("留一個位置，給想記住的瞬間。")}</p><small>{ready ? album?.photos.length ? uiText("收藏的照片還在，下方選一張就能擺上。") : uiText("上傳第一張照片，它會自動擺上相框。") : uiText("請稍候，或按下方按鈕重新載入。")}</small></div>}
        <div className="photo-actions"><button type="button" onClick={refresh} disabled={Boolean(busy)}>{busy === "refresh" ? uiText("正在更新…") : uiText("更新相簿")}</button>{displayed && <button type="button" disabled={unavailable} onClick={() => mutate(`clear:${displayed.id}`, () => updatePhoto(displayed.id, { display: false }), "相框已留空，收藏的照片仍在。")}>{uiText("讓相框空著")}</button>}</div>
      </section>
      <section className="photo-panel" aria-labelledby="photo-upload-title">
        <div className="photo-section-heading"><h2 id="photo-upload-title">{uiText("收藏一張照片")}</h2><span className="photo-count">{album ? `${album.photos.length} / ${Math.min(20, album.max)}` : "— / 20"}</span></div>
        <p className="photo-muted">{uiText("最多收藏 20 張，同時只擺一張。不公開在居民名錄；照片網址有時效，請勿轉傳。")}</p>
        <form onSubmit={upload} aria-label={uiText("上傳照片")}>
          <fieldset disabled={unavailable || full}>
            <label className="photo-picker" htmlFor="album-file"><span aria-hidden="true">＋</span><span>{file ? uiText("重新選擇照片") : uiText("選擇照片")}<small>{uiText("JPG / PNG / WebP / GIF / HEIC · 每張 12MB 以內")}</small></span><input ref={picker} id="album-file" type="file" accept={PHOTO_ACCEPT} onChange={event => choose(event.target.files?.[0])} aria-describedby="album-file-help" /></label>
            <small id="album-file-help" className="photo-muted">{full ? uiText("相簿已滿，刪除一張後才能繼續收藏。") : file ? uiText`待上傳：${file.name}` : uiText("上傳後會移除 EXIF 資訊並轉成 WebP，長邊最多 1600px。")}</small>
            {preview && <div className="photo-upload-preview"><PhotoImage src={preview} alt={uiText("待上傳的照片預覽")} preview /></div>}
            <label htmlFor="album-caption">{uiText("照片說明（選填）")}</label>
            <textarea id="album-caption" value={caption} onChange={event => setCaption(event.target.value)} rows={2} placeholder={uiText("為這一刻留一句話。")} aria-describedby="album-caption-count" aria-invalid={Array.from(caption.trim()).length > 200} />
            <small id="album-caption-count" className="photo-count">{Array.from(caption.trim()).length} / 200</small>
            <div className="photo-actions"><button className="photo-primary" type="submit" disabled={!file || Array.from(caption.trim()).length > 200}>{busy === "upload" ? uiText("正在上傳…") : uiText("收藏照片")}</button></div>
          </fieldset>
          {(file || caption) && <button className="photo-discard" type="button" disabled={Boolean(busy)} onClick={() => { if (window.confirm("放棄這張尚未上傳的照片與說明嗎？")) clearUpload(); }}>{uiText("放棄這次上傳")}</button>}
        </form>
      </section>
      <section className="photo-library" aria-labelledby="photo-library-title">
        <div className="photo-section-heading"><h2 id="photo-library-title">{uiText("我的相簿")}</h2><small className="photo-muted">{uiText("選一張，留在艙室。")}</small></div>
        {edit && <form className="photo-panel photo-caption-editor" onSubmit={saveCaption} aria-label={uiText("編輯照片說明")}>
          <label htmlFor="photo-edit-caption">{uiText("編輯照片說明")}</label>
          <textarea ref={captionEditor} id="photo-edit-caption" value={edit.draft} disabled={Boolean(busy)} onChange={event => setEdit({ ...edit, draft: event.target.value })} rows={3} aria-describedby="photo-edit-count" aria-invalid={Array.from(edit.draft.trim()).length > 200} />
          <small id="photo-edit-count" className="photo-count">{Array.from(edit.draft.trim()).length}{uiText(" / 200 · 留空保存可清除")}</small>
          <div className="photo-actions"><button className="photo-primary" type="submit" disabled={unavailable || edit.draft === edit.original || Array.from(edit.draft.trim()).length > 200}>{uiText("保存說明")}</button><button type="button" onClick={cancelEdit} disabled={Boolean(busy)}>{uiText("取消編輯")}</button></div>
        </form>}
        <div className="photo-grid">
          {album?.photos.map((photo, index) => <article key={photo.id} className={`photo-tile${photo.id === album.displayed_id ? " is-displayed" : ""}`} aria-label={uiText`照片 ${index + 1}`}>
            <div className="photo-thumbnail"><PhotoImage src={photo.url} alt={photo.caption || uiText`收藏照片 ${index + 1}`} />{photo.id === album.displayed_id && <span className="photo-badge">{uiText("展示中")}</span>}</div>
            <div className="photo-tile-body"><p>{photo.caption || uiText("尚未添加說明")}</p><div className="photo-tile-actions">
              <button type="button" className="photo-primary" disabled={unavailable || photo.id === album.displayed_id} onClick={() => mutate(`display:${photo.id}`, () => updatePhoto(photo.id, { display: true }), "相框已更新。")}>{photo.id === album.displayed_id ? uiText("已擺上相框") : uiText("擺上相框")}</button>
              <button type="button" disabled={unavailable} onClick={() => startEdit(photo)}>{uiText("編輯說明")}</button><button type="button" className="photo-delete" disabled={unavailable} onClick={() => remove(photo)}>{uiText("刪除照片")}</button>
            </div></div>
          </article>)}
        </div>
        {ready && !album?.photos.length && <p className="photo-panel photo-empty-library">{uiText("相簿還是空的，從收藏第一張開始。")}</p>}
      </section>
      <p className="photo-footnote">{uiText("想告訴室友的日常與習慣，請到鏡子裡的「給室友的話」。")}</p>
    </div>
  </main>;
}
