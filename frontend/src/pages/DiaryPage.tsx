import { uiText, getUiLanguage } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import { CabinUtilityShell, CabinUtilityEmpty } from "../components/CabinUtilityShell";
import { useEffect, useState } from "react";
import { getDiaryEntries, type DiaryEntry } from "../api/furniture";

export function DiaryPage() {
  useUiLanguage();
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [search, setSearch] = useState({ keyword: "", revision: 0 });
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(false); setEntries([]);
    getDiaryEntries(search.keyword ? { keyword: search.keyword } : undefined)
      .then(value => { if (active) setEntries(value); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [search]);

  function handleSearch() {
    setExpanded(null);
    setSearch(previous => ({ keyword: keyword.trim(), revision: previous.revision + 1 }));
  }

  return <CabinUtilityShell title={uiText("日記本")} code="DIARY">
    <section className="photo-panel" aria-label={uiText("搜尋日記")}>
      <div className="utility-toolbar"><h2>{uiText("室友的日記")}</h2><span className="photo-badge">{uiText("唯讀")}</span></div>
      <p className="utility-readonly-note">{uiText("這些是室友留下的記錄。你可以閱讀與搜尋，寫作、修改和刪除由室友自己完成。")}</p>
      <div className="utility-search">
        <input type="search" aria-label={uiText("搜尋日記")} value={keyword} onChange={e => setKeyword(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) handleSearch(); }} placeholder={uiText("搜尋日記…")} />
        <button onClick={handleSearch}>{uiText("搜尋")}</button>
      </div>
    </section>
    {loading ? <CabinUtilityEmpty title={uiText("正在讀取日記…")} loading /> : error ?
      <section className="photo-panel"><p role="alert">{uiText("暫時無法讀取日記，請稍後再試。")}</p><button onClick={handleSearch}>{uiText("重新讀取")}</button></section> : entries.length === 0 ?
      <CabinUtilityEmpty title={search.keyword ? uiText("沒有找到符合的日記") : uiText("還沒有日記")}>{search.keyword ? uiText("換個關鍵字再找找。") : uiText("室友寫下的日記會出現在這裡。")}</CabinUtilityEmpty> :
      <section className="utility-list" aria-label={uiText("日記列表")}>{entries.map(entry =>
        <article className="photo-panel utility-entry" key={entry.id}>
          <button className="utility-entry-toggle" aria-expanded={expanded === entry.id} onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}>
            <span className="utility-entry-copy"><span className="utility-entry-title">{entry.title}</span><span className="utility-meta">{new Date(entry.created_at).toLocaleDateString(getUiLanguage())}{entry.source !== "manual" && ` · ${entry.source}`}</span></span>
            <span className="utility-chevron" aria-hidden="true">{expanded === entry.id ? "−" : "＋"}</span>
          </button>
          {expanded === entry.id && <div className="utility-entry-detail"><p className="utility-body">{entry.content}</p></div>}
        </article>
      )}</section>}
  </CabinUtilityShell>;
}
