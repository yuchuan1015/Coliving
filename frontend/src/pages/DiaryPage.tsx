import { uiText, getUiLanguage } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import { CabinUtilityShell, CabinUtilityEmpty } from "../components/CabinUtilityShell";
import { useEffect, useState } from "react";
import {
  createDiaryEntry,
  deleteDiaryEntry,
  getDiaryEntries,
  type DiaryEntry,
} from "../api/furniture";

export function DiaryPage() {
  useUiLanguage();
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  function load(kw?: string) {
    setLoading(true);
    getDiaryEntries(kw ? { keyword: kw } : undefined)
      .then(setEntries)
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSave() {
    if (!title.trim() || !content.trim()) return;
    setSaving(true);
    try {
      const entry = await createDiaryEntry({ title: title.trim(), content: content.trim() });
      setEntries((prev) => [entry, ...prev]);
      setTitle("");
      setContent("");
      setComposing(false);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteDiaryEntry(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
      if (expanded === id) setExpanded(null);
    } catch (err) {
      console.error(err);
    }
  }

  function handleSearch() {
    load(keyword.trim() || undefined);
  }


  return <CabinUtilityShell title={uiText("日記本")} code="DIARY">
    <section className="photo-panel" aria-label={uiText("搜尋日記")}>
      <div className="utility-toolbar"><h2>{uiText("我的日記")}</h2>{!composing && <button className="photo-primary" onClick={() => setComposing(true)}>{uiText("＋ 寫日記")}</button>}</div>
      <div className="utility-search">
        <input type="search" aria-label={uiText("搜尋日記")} value={keyword} onChange={e => setKeyword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSearch()} placeholder={uiText("搜尋日記…")} />
        <button onClick={handleSearch}>{uiText("搜尋")}</button>
      </div>
    </section>
    {composing && <section className="photo-panel" aria-label={uiText("撰寫日記")}>
      <h2>{uiText("寫一則日記")}</h2>
      <div className="utility-form">
        <label>{uiText("標題")}<input value={title} onChange={e => setTitle(e.target.value)} placeholder={uiText("替這一刻取個名字")} autoFocus /></label>
        <label>{uiText("內容")}<textarea value={content} onChange={e => setContent(e.target.value)} placeholder={uiText("寫點什麼…")} rows={6} /></label>
        <div className="utility-actions">
          <button className="photo-primary" onClick={handleSave} disabled={saving || !title.trim() || !content.trim()}>{saving ? uiText("儲存中…") : uiText("儲存")}</button>
          <button onClick={() => { setComposing(false); setTitle(""); setContent(""); }}>{uiText("取消")}</button>
        </div>
      </div>
    </section>}
    {loading ? <CabinUtilityEmpty title={uiText("正在讀取日記…")} loading /> : entries.length === 0 ?
      <CabinUtilityEmpty title={keyword ? uiText("沒有找到符合的日記") : uiText("還沒有日記")}>{keyword ? uiText("換個關鍵字再找找。") : uiText("從上方寫下一則日記，留住這一刻。")}</CabinUtilityEmpty> :
      <section className="utility-list" aria-label={uiText("日記列表")}>{entries.map(entry =>
        <article className="photo-panel utility-entry" key={entry.id}>
          <button className="utility-entry-toggle" aria-expanded={expanded === entry.id} onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}>
            <span className="utility-entry-copy"><span className="utility-entry-title">{entry.title}</span><span className="utility-meta">{new Date(entry.created_at).toLocaleDateString(getUiLanguage())}{entry.source !== "manual" && ` · ${entry.source}`}</span></span>
            <span className="utility-chevron" aria-hidden="true">{expanded === entry.id ? "−" : "＋"}</span>
          </button>
          {expanded === entry.id && <div className="utility-entry-detail">
            <p className="utility-body">{entry.content}</p>
            <div className="utility-actions"><button className="utility-danger" onClick={() => handleDelete(entry.id)}>{uiText("刪除")}</button></div>
          </div>}
        </article>
      )}</section>}
  </CabinUtilityShell>;
}
