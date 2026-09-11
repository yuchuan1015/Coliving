import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatGardenQuantity, privateCommand, type PrivateCrop, type PrivateGarden, type PrivateGardenGateway, type PrivateIntent, type PrivatePlot } from "../api/private-garden";
import { usePrivateGarden, type PrivateOutcome } from "../hooks/usePrivateGarden";
import { GardenWarehouse } from "../components/GardenWarehouse";
import { gardenMarketApi, unavailableGardenMarketApi, type GardenMarketGateway } from "../api/garden-market";
import { FRONTIER_GARDEN_IMAGE } from "../data/frontier";
import { privateCropIcons as icons } from "../data/private-crop-icons";
import referenceCrops from "../data/garden-reference.json";
import { uiText } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import "../private-garden.css";

const phase = (status?: string) => ({ growing: uiText("正在生長"), regrowing: uiText("再次生長中"), harvest_ready: uiText("有成熟批次"), production_complete: uiText("本輪生產完成"), dead: uiText("作物已枯萎") })[status ?? ""] ?? uiText("等待室友播種");
const needs = (value: string) => ({ water: uiText("需要澆水"), nutrients: uiText("需要養分"), waterlogging: uiText("需要排水"), random_problem: uiText("需要照顧") })[value] ?? uiText("需要室友照顧");
const logText = (value: string) => ({ water: uiText("澆水"), care: uiText("照顧作物"), plant: uiText("播種"), harvest: uiText("採收"), steal: uiText("偷菜入倉"), batch_ready: uiText("一批作物成熟"), propose_clear: uiText("提出共同挖除"), consent_clear: uiText("回覆挖除提案"), revoke_clear: uiText("取消挖除提案"), clear: uiText("共同挖除完成") })[value] ?? uiText("田地狀態更新");
const actionText = (value: string) => ({ water: uiText("澆水"), steal: uiText("偷菜"), propose_clear: uiText("提出挖除"), consent_clear: uiText("回覆提案"), revoke_clear: uiText("撤回提案") })[value] ?? uiText("操作");
const harvestMode = (mode: string) => ({ single: uiText("一次性採收"), regrow: uiText("再生續採"), continuous: uiText("連續結果"), flush: uiText("分潮採收"), perennial: uiText("多年生續採") })[mode] ?? uiText("依作物批次採收");
const quantity = (v: string) => <span title={`${v} g`}>{formatGardenQuantity(v)}{v.includes("/") && <span className="private-exact"><button type="button" className="private-exact-toggle" aria-label={uiText`精確數量 ${v} g`} onClick={e => { const text = e.currentTarget.nextElementSibling as HTMLElement; text.hidden = !text.hidden; e.currentTarget.setAttribute("aria-expanded", String(!text.hidden)); }} aria-expanded="false">{uiText("精確數量")}</button><span hidden>{v} g</span></span>}</span>;

function ResultList({ outcomes, data }: { outcomes: PrivateOutcome[]; data?: PrivateGarden }) {
  return <ol className="private-results" aria-live="polite">{outcomes.map(({ command: c, receipt: r }) => {
    const plot = data?.plots.find(p => p.id === c.plot_id);
    const batch = c.action === "steal" ? plot?.planting?.batches[c.batch_id] : null;
    return <li key={c.request_id} data-outcome={r.ok === null ? "unknown" : r.ok ? "ok" : "failed"}>
      <strong>{plot ? uiText`第 ${plot.number} 塊田` : uiText("田地")}{batch && uiText` · 第 ${batch.cycle_index + 1} 輪第 ${batch.batch_index + 1} 批`} · {actionText(c.action)}</strong>
      <span>{r.ok === null ? uiText("結果尚未確認") : !r.ok ? r.detail : r.cleared ? uiText("雙方已同意，挖除完成。") : r.credited !== undefined ? uiText`已入倉 ${formatGardenQuantity(r.credited)}` : c.action === "propose_clear" ? uiText("提案已送出，等待室友回覆。") : c.action === "revoke_clear" || (c.action === "consent_clear" && !c.accept) ? uiText("提案已取消，作物保留。") : uiText("操作已記錄。")}</span>
    </li>;
  })}</ol>;
}

export function PrivateClearPanel({ plot, data, locked, submit }: { plot: PrivatePlot; data: PrivateGarden; locked: boolean; submit: (intents: PrivateIntent[]) => void }) {
  const [reason, setReason] = useState(""), [consent, setConsent] = useState(false);
  const proposal = plot.planting?.clear_proposal, actorKey = `${data.actor.kind}:${data.actor.id}`;
  const own = proposal?.proposed_by === actorKey;
  const proposalAction: PrivateIntent = proposal ? { plotId: plot.id, action: "consent_clear", proposalId: proposal.id, accept: true }
    : { plotId: plot.id, action: "propose_clear", reason, consent };
  const eligible = !!privateCommand(data, proposalAction, "permission-check");
  if (!plot.planting) return null;
  return <details className="private-panel private-clear" open={proposal ? true : undefined}>
    <summary>{uiText("共同挖除")}{proposal && <span className="private-badge">{own ? uiText("等待室友") : uiText("等待你回覆")}</span>}</summary>
    <div className="private-detail-body">
      <p>{uiText("挖除需要你和室友都同意。完成後作物與未採收的剩餘批次會移除；已入倉的收成不受影響。")}</p>
      {proposal ? <><div className="private-proposal"><strong>{own ? uiText("你提出的原因") : uiText("室友提出的原因")}</strong><p>{proposal.reason}</p></div>
        {own ? <><p>{uiText("你已同意，現在等室友自行回覆。這裡不能代替室友確認。")}</p><button className="private-button" type="button" disabled={locked || !privateCommand(data, { plotId: plot.id, action: "revoke_clear", proposalId: proposal.id }, "permission-check")} onClick={() => submit([{ plotId: plot.id, action: "revoke_clear", proposalId: proposal.id }])}>{uiText("撤回我的提案")}</button></>
          : <><label className="private-check"><input type="checkbox" checked={consent} disabled={locked || !eligible} onChange={e => setConsent(e.target.checked)} /><span>{uiText("我了解挖除的影響，並同意室友的提案。")}</span></label><div className="private-actions"><button type="button" className="private-button private-danger" disabled={locked || !consent || !eligible} onClick={() => submit([proposalAction])}>{uiText("確認同意並挖除")}</button><button type="button" className="private-button" disabled={locked || !privateCommand(data, { plotId: plot.id, action: "consent_clear", proposalId: proposal.id, accept: false }, "permission-check")} onClick={() => submit([{ plotId: plot.id, action: "consent_clear", proposalId: proposal.id, accept: false }])}>{uiText("保留作物，拒絕提案")}</button></div></>}
      </> : <form onSubmit={e => { e.preventDefault(); if (!locked && eligible) submit([proposalAction]); }}>
        <label className="private-label" htmlFor="private-clear-reason">{uiText("想挖除的原因")}</label><textarea id="private-clear-reason" value={reason} maxLength={500} rows={3} disabled={locked || !plot.allowed_actions.includes("propose_clear")} onChange={e => setReason(e.target.value)} placeholder={uiText("把原因留給室友…")} required />
        <label className="private-check"><input type="checkbox" checked={consent} disabled={locked} onChange={e => setConsent(e.target.checked)} /><span>{uiText("我同意提出共同挖除，並等待室友的決定。")}</span></label>
        <button type="submit" className="private-button" disabled={locked || !eligible}>{uiText("送出挖除提案")}</button>
      </form>}
    </div>
  </details>;
}

export function PrivateGardenPage({ gateway, marketGateway }: { gateway?: PrivateGardenGateway; marketGateway?: GardenMarketGateway } = {}) {
  const language = useUiLanguage(), garden = usePrivateGarden(gateway);
  const [tab, setTab] = useState<"plots" | "inventory" | "catalog">("plots"), [selected, setSelected] = useState(1), [tier, setTier] = useState(1);
  const data = garden.data, plot = data?.plots.find(p => p.number === selected), plant = plot?.planting;
  const locked = garden.busy || garden.loading || garden.uncertain;
  const date = (value: string, virtual = false) => new Date(value).toLocaleString(language === "zh-CN" ? "zh-CN" : "zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: virtual ? "UTC" : garden.timezone });
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: "instant" }); }, []);
  const batches = plant ? Object.values(plant.batches).sort((a, b) => a.cycle_index - b.cycle_index || a.batch_index - b.batch_index) : [];
  const activeBatches = batches.filter(b => b.status === "ready").sort((a, b) => Number(b.steal_available) - Number(a.steal_available)), historyBatches = batches.filter(b => b.status !== "ready");
  const catalog: { id: string; name: string; category: string; description: string; emoji: string | null; timing?: PrivateCrop["timing"]; harvest?: PrivateCrop["harvest"] }[] = tier === 1 ? data?.crops.map(c => ({ ...c, description: c.care.note, emoji: icons[c.id] ?? "🌱" })) ?? [] : referenceCrops.filter(c => c.tier === tier);
  return <main className="private-garden-page">
    <div className="private-wrap"><header className="private-header"><Link to="/">{uiText("← 返回艙室")}</Link><span>CABIN / GARDEN</span></header>
      <section className="private-hero" aria-label={uiText("私人菜園空間")}><img src={FRONTIER_GARDEN_IMAGE} width="1536" height="1024" alt={uiText("星空裡的玻璃溫室，種著一畦畦蔬菜")} /><div className="private-hero-copy"><span className="private-eyebrow">OUR LITTLE PATCH</span><h1>{uiText("艙室小畦")}</h1><p>{uiText("把日子，種進土裡。")}</p><span className="private-badge">{uiText("4 塊私田 · 共 10 坪")}</span></div><small className="private-image-note">{uiText("菜園氛圍示意")}</small></section>
      <div className="private-update"><span>{data ? uiText`農園時間 ${date(data.garden_time, true)}` : uiText("正在與菜園連線")}</span><button type="button" disabled={garden.loading || garden.busy} onClick={garden.refresh}>{garden.loading ? uiText("讀取中…") : uiText("更新近況 ↻")}</button></div>
      <nav className="private-tabs" aria-label={uiText("私人菜園分頁")}>{([['plots', uiText("我的田地")], ['inventory', uiText("雙方倉庫")], ['catalog', uiText("作物圖鑑")]] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}</nav>
      {garden.error && <p className="private-message private-error" role="alert">{garden.error}</p>}
      {!!garden.outcomes.length && <ResultList outcomes={garden.outcomes} data={data} />}
      {garden.uncertain && <div className="private-message"><p>{uiText("有操作尚未確認。請確認原操作，期間先不要重複澆水或偷菜。")}</p><button type="button" className="private-button private-primary" disabled={garden.busy} onClick={garden.retry}>{garden.busy ? uiText("正在確認…") : uiText("確認未完成的原操作")}</button></div>}
      {garden.loading && !data && <div className="private-panel private-empty" role="status">{uiText("正在查看你們的菜園…")}</div>}
      {data && tab === "plots" && <>
        <div className="private-section-heading"><h2>{uiText("四塊田，一起過日子")}</h2><span className="private-muted">{uiText("點選田地查看")}</span></div>
        <div className="private-plots">{data.plots.map(p => <button type="button" key={p.id} className="private-plot" aria-pressed={selected === p.number} onClick={() => setSelected(p.number)}><span className="private-plot-top"><span>{uiText`第 ${p.number} 塊田`}</span><span className="private-muted">{uiText("2.5 坪")}</span></span><span className="private-plot-name"><span aria-hidden="true">{p.planting ? icons[p.planting.crop_id] ?? "🌱" : "◌"}</span><strong>{p.crop_name ? uiText(p.crop_name) : uiText("空地")}</strong></span><span className="private-plot-status">{phase(p.planting?.status)}{p.planting?.clear_proposal && uiText(" · 有挖除提案")}</span></button>)}</div>
        <p className="private-fineprint">{uiText("每塊 2.5 坪總面積，其中 6 m² 用來種植，其餘留給走道與作業。")}</p>
        {plot && <><section className="private-panel private-care" aria-labelledby="private-crop-title"><div className="private-section-heading"><span className="private-eyebrow">PATCH / 0{plot.number}</span><span className="private-badge">{phase(plant?.status)}</span></div>
          {plant ? <><div className="private-crop-heading"><span aria-hidden="true">{icons[plant.crop_id] ?? "🌱"}</span><div><p className="private-muted">{uiText("室友正在種植")}</p><h2 id="private-crop-title">{uiText(plot.crop_name ?? data.crops.find(c => c.id === plant.crop_id)?.name ?? "作物")}</h2></div></div>
            <p className="private-muted">{uiText`播種於 ${date(plant.planted_at)}`}</p><p>{plant.needs.length ? plant.needs.map(needs).join(" · ") : plant.status === "dead" ? uiText("可以和室友討論是否挖除。") : uiText("目前沒有待處理的照顧需求。")}{plant.random_problem && ` · ${plant.random_problem.label}`}</p>
            <div className="private-metrics">{([[uiText("健康"), plant.health], [uiText("水分"), plant.moisture], [uiText("養分"), plant.nutrients]] as const).map(([label, value]) => <div key={label}><span>{label}<strong>{Math.round(value)}<small> / 100</small></strong></span><meter aria-label={label} min={0} max={100} value={value} /></div>)}</div>
            <button className="private-button private-primary private-water" type="button" disabled={locked || !privateCommand(data, { plotId: plot.id, action: "water" }, "permission-check")} onClick={() => garden.submit([{ plotId: plot.id, action: "water" }])}>{uiText("為這塊田澆水")}</button>
            <p className="private-fineprint">{uiText("播種、照顧與採收由室友自己進行；你可以澆水，也可以趁成熟時偷一點菜。")}</p>
            <div className="private-batches"><h3>{uiText("這一株的收成批次")}</h3><p className="private-muted">{uiText("每個成熟批次可偷一次、拿走一半，沒有成熟保護時間。偷到的立即進你的倉庫，剩下的留給室友採收。")}</p>
              {activeBatches.length ? activeBatches.map(b => <div className="private-batch" key={b.id}><div><strong>{uiText`第 ${b.cycle_index + 1} 輪 · 第 ${b.batch_index + 1} 批`}</strong><span className="private-muted">{b.stolen ? uiText("你已偷過這一批") : uiText("已成熟")}</span><span>{uiText("剩餘 ")}{quantity(String(b.remaining_g))}</span></div><button className="private-button" type="button" disabled={locked || !privateCommand(data, { plotId: plot.id, action: "steal", batchId: b.id }, "permission-check")} onClick={() => garden.submit([{ plotId: plot.id, action: "steal", batchId: b.id }])}>{b.stolen ? uiText("本批已偷過") : uiText("偷菜 · 50%")}</button></div>) : <p className="private-empty-small">{batches.length ? uiText("目前沒有等待採收的批次。") : uiText("還沒有成熟批次，讓它再長一會兒。")}</p>}
              {!!historyBatches.length && <details className="private-batch-history"><summary>{uiText`過往 ${historyBatches.length} 批收成`} ＋</summary><ol>{historyBatches.map(b => <li key={b.id}><span>{uiText`第 ${b.cycle_index + 1} 輪 · 第 ${b.batch_index + 1} 批`}</span><span>{b.status === "harvested" ? uiText("室友已採收") : uiText("本批已結束")}{b.stolen && uiText(" · 你已偷過")}</span></li>)}</ol></details>}
            </div>
          </> : <div className="private-empty"><span aria-hidden="true">🌱</span><h2 id="private-crop-title">{uiText("這塊田，等室友來種")}</h2><p>{uiText("室友可以自己決定種什麼。種下後，近況和你能做的事會出現在這裡。")}</p></div>}
        </section><PrivateClearPanel key={`${data.actor.id}:${plant?.planting_id}:${plant?.clear_proposal?.id}`} plot={plot} data={data} locked={locked} submit={garden.submit} />
          <details className="private-panel private-logs"><summary>{uiText("照顧紀錄")}<span className="private-muted">{uiText("展開查看")} ＋</span></summary><ol>{plot.care_logs.length ? plot.care_logs.map(log => <li key={log.id}><span><strong>{log.actor_key === `${data.actor.kind}:${data.actor.id}` ? uiText("你") : log.actor_key?.startsWith("agent:") ? uiText("室友") : log.actor_key ? uiText("居民") : uiText("系統")}</strong> · {logText(log.kind)}</span><time dateTime={log.created_at}>{date(log.created_at)}</time></li>) : <li>{uiText("還沒有照顧紀錄。")}</li>}</ol></details>
        </>}
      </>}
      <GardenWarehouse key={garden.owner} userId={garden.owner} active={!!data && tab === "inventory"} locked={locked} gateway={marketGateway ?? (gateway ? unavailableGardenMarketApi : gardenMarketApi)} inventory={garden.inventory} loadInventory={garden.loadMore} onSold={garden.refresh} />
      {data && tab === "catalog" && <><section className="private-panel"><div className="private-section-heading"><div><span className="private-eyebrow">GROW TOGETHER</span><h2>{uiText("你們的共同圖鑑")}</h2></div><span className="private-badge">{uiText("第一級")}</span></div>{garden.progress.error && <p role="alert" className="private-error">{garden.progress.error}</p>}{garden.progress.data && <><p className="private-progress-number">{garden.progress.data.completed_count}<small> / {garden.progress.data.required_count} {uiText("種")}</small></p><progress aria-label={uiText("共同圖鑑完成進度")} value={garden.progress.data.completed_count} max={garden.progress.data.required_count} /><p>{garden.progress.data.completed_count >= garden.progress.data.required_count ? uiText("第一級已集齊！後續級別仍待開放種植。") : uiText("集齊第一級 12 種收成，累積下一級的解鎖進度。")}</p></>}<p className="private-fineprint">{uiText("只計室友從私田實際採收到的正數收成。偷菜、公共分配或挖除都不增加進度。")}</p></section>
        <div className="private-tier-picker" aria-label={uiText("選擇圖鑑級別")}>{[1, 2, 3, 4, 5, 6].map(t => <button type="button" key={t} aria-pressed={tier === t} onClick={() => setTier(t)}>{uiText`第 ${t} 級`}</button>)}</div><p className="private-catalog-note">{tier === 1 ? uiText("第一級 · 目前開放種植") : uiText("參考圖鑑 · 尚未開放種植，不是可選作物")}</p>
        <div className="private-catalog">{catalog.map(c => <article className="private-panel private-crop-card" key={c.id}><div className="private-crop-card-top"><span aria-hidden="true">{c.emoji ?? "🌱"}</span><span className="private-badge">{tier > 1 ? uiText("僅供參考") : garden.progress.data?.completed_crop_ids.includes(c.id) ? uiText("已收成 ✓") : uiText("尚未收成")}</span></div><span className="private-muted">{uiText(c.category)}</span><h3>{uiText(c.name)}</h3>{c.timing && c.harvest && <div className="private-crop-baseline"><span>{harvestMode(c.harvest.mode)}</span><span>{uiText`首收基準：約 ${(c.timing.first_harvest_days / data.time_multiplier).toLocaleString(language, { maximumFractionDigits: 1 })} 個現實天`}</span><small>{uiText("為基準等待，不是目前田地的成熟倒數；照顧狀態會影響實際生長。")}</small></div>}<details className="private-crop-description"><summary>{tier === 1 ? uiText("照顧說明") : uiText("作物簡介")} ＋</summary><p>{uiText(c.description)}</p></details></article>)}</div>
      </>}
      <footer className="private-footer"><span>CABIN GARDEN</span><Link to="/frontier/garden">{uiText("去公共農田看看 ↗")}</Link></footer>
    </div>
  </main>;
}
