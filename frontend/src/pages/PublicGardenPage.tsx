import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { canGardenAct, type GardenGateway, type PublicGarden, type PublicPlot } from "../api/garden";
import { FRONTIER_GARDEN_IMAGE } from "../data/frontier";
import { usePublicGarden } from "../hooks/usePublicGarden";
import { uiText } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import "../public-garden.css";

const cropIcons: Record<string, string> = { broccoli: "🥦", carrot: "🥕", cauliflower: "🥦", cucumber: "🥒", daikon: "🌱", kohlrabi: "🌱", pak_choi: "🥬", petite_oyster_mushroom: "🍄", potato: "🥔", tomato: "🍅", vegetable_fern: "🌿", water_spinach: "🌿" };
const phaseLabel = (status?: string) => ({ growing: uiText("正在生長"), regrowing: uiText("再次生長中"), harvest_ready: uiText("等待系統採收"), production_complete: uiText("本輪生產完成"), dead: uiText("本輪已結束") })[status ?? ""] ?? uiText("等待下一輪播種");
const needLabel = (need: string) => ({ water: uiText("需要澆水"), nutrients: uiText("需要補充養分"), waterlogging: uiText("需要排水"), random_problem: uiText("需要照顧") })[need] ?? uiText("需要照顧");
const logLabel = (kind: string) => ({ water: uiText("澆水"), care: uiText("照顧作物"), public_vote: uiText("開啟下一輪投票"), vote: uiText("參與投票"), plant: uiText("播種"), harvest: uiText("採收"), public_harvest: uiText("公共收成分配"), public_plant: uiText("公共農田播種") })[kind] ?? uiText("農田狀態更新");

function LeafMark({ drop = false }: { drop?: boolean }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{drop ? <path d="M12 3C10 7 5 11 5 15a7 7 0 0 0 14 0c0-4-5-8-7-12Zm-3 12c0 2 1 3 3 3" /> : <><path d="M12 21v-9M12 15C5 15 4 10 4 6c6 0 8 3 8 9ZM12 11c0-6 4-8 8-8 0 5-2 8-8 8Z" /></>}</svg>;
}

function PublicVotePanel({ data, plot, now, disabled, submit }: { data: PublicGarden; plot: PublicPlot; now: number; disabled: boolean; submit: (crop: string) => void }) {
  const [selection, setSelection] = useState("");
  const vote = plot.vote!;
  const remaining = Math.max(0, Math.ceil((Date.parse(vote.closes_at) - now) / 60000));
  const allowed = !disabled && canGardenAct(plot, "vote", now);
  const selectedName = data.crops.find(crop => crop.id === (vote.my_vote?.crop_id ?? selection))?.name;
  return <section className="garden-panel garden-vote" aria-labelledby={`vote-title-${plot.id}`}>
    <div className="garden-section-heading"><div><span className="garden-eyebrow">NEXT SEASON</span><h2 id={`vote-title-${plot.id}`}>{uiText("下一輪，種什麼？")}</h2></div><span className="garden-badge">{uiText("居民投票")}</span></div>
    <p className="garden-muted">{uiText("每個身份一票。投票結束後，由系統播種。")}</p>
    <p className="garden-countdown">{remaining && vote.status === "open" ? uiText`距離截止 ${Math.floor(remaining / 60)} 小時 ${remaining % 60} 分鐘` : uiText("投票已截止，等待系統更新。")}</p>
    <fieldset disabled={!allowed} className="garden-candidates"><legend className="garden-sr-only">{uiText("選擇下一輪作物")}</legend>
      {vote.candidates.map(id => { const crop = data.crops.find(item => item.id === id); if (!crop) return null; return <label className={`garden-candidate${(vote.my_vote?.crop_id ?? selection) === id ? " is-selected" : ""}`} key={id}>
        <input type="radio" name={`garden-vote-${vote.id}`} value={id} checked={(vote.my_vote?.crop_id ?? selection) === id} onChange={() => setSelection(id)} />
        <span aria-hidden="true">{cropIcons[id] ?? "🌱"}</span><strong>{uiText(crop.name)}</strong><small>{uiText`${vote.counts[id] ?? 0} 票`}</small>
      </label>; })}
    </fieldset>
    {vote.my_vote ? <p className="garden-voted">{uiText`你已投給 ${uiText(selectedName ?? "作物")}，謝謝你的參與。`}</p>
      : <button type="button" className="garden-button garden-primary garden-vote-submit" disabled={!allowed || !vote.candidates.includes(selection)} onClick={() => submit(selection)}>{selectedName ? uiText`確認投給 ${uiText(selectedName)}` : uiText("選好作物，再送出一票")}</button>}
  </section>;
}

export function PublicGardenPage({ gateway }: { gateway?: GardenGateway } = {}) {
  const language = useUiLanguage();
  const garden = usePublicGarden(gateway);
  const [clock, setClock] = useState(Date.now());
  const expiredVote = useRef("");
  const data = garden.data;
  const { busy, loading, uncertain, refresh } = garden;
  const now = data ? Date.parse(data.server_now) + Math.max(0, clock - garden.receivedAt) : clock;
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: "instant" }); }, []);
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 15000); return () => window.clearInterval(timer); }, []);
  const expiring = data?.plots.find(plot => plot.vote?.status === "open" && Date.parse(plot.vote.closes_at) <= now)?.vote?.id ?? "";
  useEffect(() => {
    if (!expiring || expiredVote.current === expiring || busy || loading || uncertain) return;
    expiredVote.current = expiring;
    void refresh();
  }, [expiring, busy, loading, uncertain, refresh]);
  const formatTime = (date: string) => new Date(date).toLocaleString(language === "zh-CN" ? "zh-CN" : "zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const locked = garden.busy || garden.loading || !!garden.uncertain;

  return <main className="public-garden-page">
    <header className="garden-page-header"><Link className="garden-back" to="/frontier">{uiText("← 返回開荒")}</Link><span className="garden-eyebrow">PROCYON / 01</span></header>
    <div className="garden-page-title"><div><p className="garden-eyebrow">THE COMMON GROUND</p><h1>{uiText("公共農田")}</h1><p>{uiText("一片由大家照顧的日常。")}</p></div><LeafMark /></div>
    <section className="garden-hero" aria-label={uiText("公共農田空間")}>
      <img src={FRONTIER_GARDEN_IMAGE} width="1536" height="1024" alt={uiText("星空裡的玻璃溫室，種著一畦畦蔬菜")} />
      <div className="garden-hero-top"><span className="garden-badge">● {uiText("一起照顧")}</span>{data && <span>{data.public_area.gross_m2} m²</span>}</div>
      <div className="garden-hero-caption"><span>01 / COMMUNITY GARDEN</span><h2>{uiText("一起種，下一季的日常。")}</h2><small>{uiText("菜園氛圍示意")}</small></div>
    </section>
    <div className="garden-update"><span>{data ? uiText`農園時間 ${formatTime(data.garden_time)}` : uiText("與農田連線中")}</span><button type="button" onClick={() => void garden.refresh()} disabled={garden.loading || garden.busy} aria-label={uiText("重新整理農田")}>{garden.loading ? uiText("讀取中…") : uiText("更新近況 ↻")}</button></div>
    {garden.error && <div className="garden-message garden-error" role="alert">{garden.error}</div>}
    {garden.notice && <div className="garden-message" role="status">{garden.notice}</div>}
    {garden.uncertain && <button type="button" className="garden-button garden-primary" disabled={garden.busy} onClick={garden.retry}>{garden.busy ? uiText("正在確認…") : uiText("確認同一筆操作")}</button>}
    {garden.loading && !data && <section className="garden-panel garden-empty" role="status"><LeafMark /><h2>{uiText("正在查看這片農田…")}</h2><p>{uiText("種植近況與可用操作會以最新資料為準。")}</p></section>}
    {data && !data.plots.length && <section className="garden-panel garden-empty"><LeafMark /><h2>{uiText("公共農田準備中")}</h2><p>{uiText("目前還沒有可照顧的田地，稍後再來看看。")}</p></section>}
    {data?.plots.map(plot => { const p = plot.planting; const cropName = plot.crop_name ?? data.crops.find(crop => crop.id === p?.crop_id)?.name ?? uiText("本輪作物");
      const joined = plot.contributors.some(person => person.id === data.actor.id && person.kind === data.actor.kind);
      return <div className="garden-plot" key={plot.id}>
        <section className="garden-panel garden-care" aria-labelledby={`garden-crop-${plot.id}`}>
          <div className="garden-section-heading"><span className="garden-eyebrow">{uiText("這一畦的近況")}</span><span className="garden-badge">● {p ? phaseLabel(p.status) : plot.vote ? uiText("下一輪投票中") : uiText("休耕中")}</span></div>
          {p ? <><div className="garden-crop-heading"><span className="garden-crop-icon" aria-hidden="true">{cropIcons[p.crop_id] ?? "🌱"}</span><div><p>{uiText("大家正在種植")}</p><h2 id={`garden-crop-${plot.id}`}>{uiText(cropName)}</h2></div></div>
            <div className="garden-needs">{p.needs.length ? <p>{p.needs.map(needLabel).join(" · ")}{p.random_problem && ` · ${p.random_problem.label}`}</p> : <p>{uiText("目前狀態穩定，來看看它也是日常的一部分。")}</p>}</div>
            <div className="garden-metrics">{([[uiText("健康"), p.health], [uiText("水分"), p.moisture], [uiText("養分"), p.nutrients]] as const).map(([label, value]) => <div key={label}><div><span>{label}</span><strong>{Math.round(value)}<small> / 100</small></strong></div><meter min="0" max="100" value={value} aria-label={label} /></div>)}</div>
            <div className="garden-care-actions"><button type="button" className="garden-button garden-primary" disabled={locked || !canGardenAct(plot, "water", now)} onClick={() => garden.submit(plot.id, "water")}><LeafMark drop />{uiText("澆水")}</button><button type="button" className="garden-button" disabled={locked || !canGardenAct(plot, "care", now)} onClick={() => garden.submit(plot.id, "care")}><LeafMark />{uiText("照顧")}</button></div>
            <p className="garden-fineprint">{uiText("即使需求已被滿足，你的照顧仍會記錄為本輪參與。")}</p>
          </> : <div className="garden-empty"><LeafMark /><h2 id={`garden-crop-${plot.id}`}>{plot.vote ? uiText("把下一輪的種子，交給大家。") : uiText("土地正在等待下一輪。")}</h2><p>{plot.vote ? uiText("往下選一種作物，一起決定這片農田的下一季。") : uiText("播種與採收由系統安排，不需要手動操作。")}</p></div>}
        </section>
        <section className="garden-panel garden-community"><div className="garden-section-heading"><h2>{uiText("一起照顧，一起收成")}</h2><span className="garden-community-count">{plot.contributors.length}<small>{uiText("個參與身份")}</small></span></div><p>{joined ? uiText("你已參與本輪照顧。") : uiText("澆水或照顧，就能留下本輪參與記錄。")}</p><ol className="garden-cycle"><li>{uiText("共同照顧")}</li><li>{uiText("系統採收")}</li><li>{uiText("分配收成")}</li></ol><p className="garden-fineprint">{uiText("成熟後由系統採收並分配；投票不計入照顧參與。")}</p></section>
        {plot.vote && <PublicVotePanel key={plot.vote.id} data={data} plot={plot} now={now} disabled={locked} submit={crop => garden.submit(plot.id, "vote", crop)} />}
        <details className="garden-panel garden-logs"><summary>{uiText("照顧紀錄")}<span>{uiText("最近動態")} <span aria-hidden="true">＋</span></span></summary><ol>{plot.care_logs.length ? plot.care_logs.map(log => <li key={log.id}><span><strong>{log.actor_key === `${data.actor.kind}:${data.actor.id}` ? uiText("你") : log.actor_key ? uiText("居民／室友") : uiText("系統")}</strong> · {logLabel(log.kind)}</span><time dateTime={log.created_at}>{formatTime(log.created_at)}</time></li>) : <li>{uiText("目前還沒有照顧紀錄。")}</li>}</ol></details>
      </div>;
    })}
    <footer className="garden-footer">PROCYON · {uiText("開荒")}<span>{uiText("把日子，種進土裡。")}</span></footer>
  </main>;
}
