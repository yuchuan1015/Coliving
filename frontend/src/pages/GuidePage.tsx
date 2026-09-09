import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CabinUtilityShell } from "../components/CabinUtilityShell";
import { BUG_REPORT_MAILTO, BUG_REPORT_TEMPLATE, GUIDE_CATEGORIES, GUIDE_UPDATED, SUPPORT_EMAIL, guideExcerpt, searchGuide, type GuideFilter } from "../data/guide";
import "../guide.css";

export function GuidePage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<GuideFilter>("all");
  const [copyStatus, setCopyStatus] = useState("");
  const [copying, setCopying] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const copyLock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const results = searchGuide(query, category);
  async function copy(value: string, label: string) {
    if (copyLock.current) return;
    copyLock.current = true; setCopying(true); setCopyStatus("");
    try { await navigator.clipboard.writeText(value); if (mounted.current) setCopyStatus(`已複製${label}，尚未寄出郵件。`); }
    catch { if (mounted.current) setCopyStatus("無法自動複製，請長按下方信箱或展開報錯格式，手動選取文字。尚未寄出郵件。"); }
    finally { copyLock.current = false; if (mounted.current) setCopying(false); }
  }
  function clear() { setQuery(""); setCategory("all"); searchRef.current?.focus(); }

  return <CabinUtilityShell title="導覽手冊" code="GUIDE">
    <div className="cabin-guide">
      <section className="photo-panel guide-controls" aria-label="搜尋導覽手冊">
        <label htmlFor="guide-search">你想找什麼？</label>
        <div className="guide-search-row"><input ref={searchRef} id="guide-search" type="search" placeholder="例如：頭像、相框、記憶、413" value={query} onChange={event => setQuery(event.target.value)} maxLength={160} autoComplete="off" aria-describedby="guide-search-help" />{query && <button type="button" onClick={() => { setQuery(""); searchRef.current?.focus(); }}>清除搜尋</button>}</div>
        <p id="guide-search-help">搜尋標題、內文與關鍵字。多個詞可用空格隔開。</p>
        <div className="guide-categories" role="group" aria-label="手冊分類">{Object.entries(GUIDE_CATEGORIES).map(([id, label]) => <button type="button" key={id} aria-pressed={category === id} onClick={() => setCategory(id as GuideFilter)}>{label}</button>)}</div>
      </section>
      <div className="guide-result-heading"><p role="status" aria-live="polite">{query.trim() ? `找到 ${results.length} 則相關說明` : `${GUIDE_CATEGORIES[category]} · ${results.length} 則說明`}</p><small>更新 {GUIDE_UPDATED}</small></div>
      <section className="guide-results" aria-label="手冊內容">
        {!results.length && <div className="photo-panel guide-empty"><h2>沒有找到相關說明</h2><p>試試更短的關鍵字，或清除分類與搜尋條件。仍無法解決時，可以到「Bug 報錯」聯絡我們。</p><div className="guide-actions"><button type="button" onClick={clear}>查看全部說明</button><button type="button" onClick={() => { setQuery(""); setCategory("contact"); }}>前往 Bug 報錯</button></div></div>}
        {results.map(article => <details className="photo-panel guide-entry" key={`${category}:${query.trim()}:${article.id}`}>
          <summary><span className="guide-entry-copy"><span className="guide-category-label">{GUIDE_CATEGORIES[article.category]}</span><span className="guide-entry-title">{article.title}</span><span className="guide-excerpt">{guideExcerpt(article, query)}</span></span><span className="guide-chevron" aria-hidden="true">＋</span></summary>
          <div className="guide-entry-body">{article.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}{article.notice && <p className="guide-notice">{article.notice}</p>}{article.link && <Link className="guide-link" to={article.link.to}>{article.link.label} <span aria-hidden="true">↗</span></Link>}</div>
        </details>)}
      </section>
      {(category === "contact" || results.some(article => article.id === "contact")) && <section className="photo-panel guide-contact" aria-labelledby="guide-contact-title">
        <h2 id="guide-contact-title">報錯信箱</h2>
        <p className="guide-email">{SUPPORT_EMAIL}</p>
        <p>郵件由你確認後寄出。沒有設定郵件程式也可複製信箱及格式，自行寄信。</p>
        <div className="guide-actions"><a className="guide-link" href={BUG_REPORT_MAILTO}>開啟報錯郵件草稿 ↗</a><button type="button" disabled={copying} onClick={() => copy(SUPPORT_EMAIL, "信箱")}>複製信箱</button><button type="button" disabled={copying} onClick={() => copy(BUG_REPORT_TEMPLATE, "報錯格式")}>複製報錯格式</button></div>
        <p role="status" aria-live="polite" className="guide-copy-status">{copyStatus}</p>
        <details className="guide-report-template"><summary>查看／手動複製報錯格式</summary><pre>{BUG_REPORT_TEMPLATE}</pre></details>
        <p className="guide-notice">請先遮蔽截圖中的個資。不要寄密碼、API 金鑰、MCP token 或帶憑證的網址；手冊不會自動附上你的帳號或對話。</p>
      </section>}
    </div>
  </CabinUtilityShell>;
}
