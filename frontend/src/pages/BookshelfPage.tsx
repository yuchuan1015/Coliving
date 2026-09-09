import { uiText } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import { Link } from "react-router-dom";
import { ShelfShell } from "../components/BookshelfUI";

export function BookshelfPage() {
  useUiLanguage();
  return <ShelfShell>
    <header className="card page-header"><div><span className="eyebrow">{uiText("艙室 / 記憶區")}</span><h1>{uiText("記憶書架")}</h1></div><Link className="back" to="/">{uiText("← 返回艙室")}</Link></header>
    <Link to="/memory" className="card destination"><span className="destination-icon" aria-hidden="true">✧</span><div className="destination-title"><h2>{uiText("我的記憶")}</h2><span aria-hidden="true">↗</span></div><p>{uiText("把值得記住的事，好好留在這裡。")}</p><div className="destination-footer"><span>{uiText("搜尋 · 整理 · 匯出")}</span><span className="tag">mem0</span></div></Link>
    <Link to="/reading" className="card destination"><span className="destination-icon" aria-hidden="true">▤</span><div className="destination-title"><h2>{uiText("一起讀書")}</h2><span aria-hidden="true">↗</span></div><p>{uiText("一本書，兩個人的劃線與批注。")}</p><div className="destination-footer"><span>{uiText("私人書架 · 共讀 · 續讀")}</span><span className="tag">{uiText("共讀")}</span></div></Link>
    <p className="footnote">{uiText("這是你和室友的私人書架，不是公共圖書館。")}</p>
  </ShelfShell>;
}
