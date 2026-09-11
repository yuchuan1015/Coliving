import { useGardenMarket } from "../hooks/useGardenMarket";
import { hasSaleStock, saleQuantityLabel, validSaleQuantity, type GardenMarketGateway } from "../api/garden-market";
import type { GardenInventory, WarehouseOwner } from "../api/private-garden";
import { groupShellDisplay } from "../api/economy";
import { uiText } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import { privateCropIcons, privateCropLabel } from "../data/private-crop-icons";
const unavailableText = (code: string) => ({
  inventory_source_mismatch: uiText("收成來源與數量需要核對，暫時不能出售。"),
  batch_price_missing: uiText("這批收成的售價尚待核對，暫時不能出售。"),
})[code] ?? uiText("這份收成暫時無法出售，請更新倉庫或聯絡客服。");

interface Props {
  userId: string; active: boolean; locked: boolean; gateway?: GardenMarketGateway; onSold: () => void;
  inventory: Record<WarehouseOwner, { data?: GardenInventory; error: string; loading?: boolean }>;
  loadInventory: (owner: WarehouseOwner) => void;
}
export function GardenWarehouse({ userId, active, locked, gateway, onSold, inventory, loadInventory }: Props) {
  useUiLanguage();
  const market = useGardenMarket(userId, active, locked, gateway, onSold);
  if (!active) return null;
  const blocked = locked || market.busy || market.denied || market.storageError || !!market.pending;
  const exactQuantity = (value: string) => <span>{saleQuantityLabel(value)}{(value.includes("/") || value.length > 12) && <span className="private-exact"><button type="button" className="private-exact-toggle" aria-label={uiText`精確數量 ${value} g`} aria-expanded="false" onClick={e => { const detail = e.currentTarget.nextElementSibling as HTMLElement; detail.hidden = !detail.hidden; e.currentTarget.setAttribute("aria-expanded", String(!detail.hidden)); }}>{uiText("精確數量")}</button><span hidden>{value} g</span></span>}</span>;
  const order = market.selected && !market.pending && <form className="market-order" onSubmit={e => { e.preventDefault(); void market.requestQuote(); }} aria-label={uiText("出售收成")}>
          <div className="private-section-heading"><h3>{uiText(market.selected.crop_name)}</h3><button type="button" className="private-button" disabled={locked || market.denied} onClick={market.close}>{uiText("取消")}</button></div>
          <p className="private-muted">{uiText("先選數量，取得報價後才會確認出售。")}</p>
          <div className="private-actions"><button className="private-button" type="button" disabled={blocked || !validSaleQuantity(market.selected.quantity_g, market.selected.quantity_g)} onClick={() => market.changeQuantity(market.selected!.quantity_g)}>{uiText("全部數量")}</button><button className="private-button" type="button" disabled={blocked} onClick={() => market.changeQuantity("")}>{uiText("部分數量")}</button></div>
          <label className="private-label" htmlFor="market-quantity">{uiText("出售數量（g）")}</label>
          <input id="market-quantity" className="market-quantity" type="text" inputMode="text" value={market.quantity} autoComplete="off" disabled={blocked} onChange={e => market.changeQuantity(e.target.value)} aria-describedby="market-quantity-help" />
          <p id="market-quantity-help" className="private-muted">{uiText("可填整數、小數或分數，例如 100、0.5、200/3。")}</p>
          {!!market.quantity && !validSaleQuantity(market.quantity, market.selected.quantity_g) && <p className="private-error">{market.quantity.length > 128 ? uiText("數量太長了，請填 128 字元以內的數量。") : uiText("請填大於 0、且不超過庫存的有效克數。")}</p>}
          {!market.quote && <button className="private-button private-primary market-quote-button" type="submit" disabled={blocked || market.stores.user.loading || !validSaleQuantity(market.quantity, market.selected.quantity_g)}>{market.busy ? uiText("處理中…") : uiText("取得報價")}</button>}
          {market.quote && <div className="market-quote" role="status"><p>{uiText("本次出售 ")}{exactQuantity(market.quote.quantity_g)}</p><p>{uiText("可獲得 ")}<strong>{groupShellDisplay(market.quote.shells_display)} {uiText("貝")}</strong></p><span className="private-exact" key={market.quote.quote_id}><button type="button" className="private-exact-toggle" aria-expanded="false" onClick={e => { const detail = e.currentTarget.nextElementSibling as HTMLElement; detail.hidden = !detail.hidden; e.currentTarget.setAttribute("aria-expanded", String(!detail.hidden)); }}>{uiText("精確售值")}</button><span hidden>{market.quote.shells_exact} {uiText("貝")}</span></span><p className="private-muted">{uiText("依成熟批次固定價格收購。確認後才會扣除收成、存入你的錢包。")}</p><button className="private-button private-primary" type="button" disabled={blocked || market.stores.user.loading} onClick={market.confirm}>{uiText("確認出售")}</button></div>}
        </form>;
  return <div className="garden-market">
    <div className="private-section-heading"><h2>{uiText("各自收藏生活裡的收成")}</h2><button className="private-button" type="button" disabled={locked || market.busy} onClick={() => void market.refresh()}>{uiText("更新倉庫與售值")}</button></div>
    <p className="private-muted">{uiText("私人田地與公共農田分配的收成，都會記入各自的倉庫。")}</p>
    {market.error && <p className="private-message private-error" role="alert">{market.error}</p>}
    {market.pending && !market.denied && <section className="private-panel market-pending" aria-label={uiText("未確認的出售")}>
      <h3>{market.busy ? uiText("正在確認出售…") : uiText("這筆出售還在確認中")}</h3>
      <p>{uiText("重試會使用同一筆記錄，不會另外建立出售。在結果確認前，先暫停其他出售。")}</p>
      <p className="private-muted">{uiText("請保留這個分頁，先確認原本的出售結果。")}</p>
      <p className="private-muted">{uiText("作物：")}{uiText(privateCropLabel(market.pending.crop_id))} · {exactQuantity(market.pending.quantity_g)}</p>
      <button className="private-button" type="button" disabled={locked || market.busy || market.storageError || market.conflict} onClick={market.retry}>{uiText("確認這筆出售結果")}</button>
    </section>}
    {market.receipt && !market.denied && <p className="private-message market-receipt" role="status">{uiText("出售完成：")}{uiText(market.receipt.crop_name)} · {exactQuantity(market.receipt.quantity_g)} · {uiText("本筆收入 ")}{groupShellDisplay(market.receipt.shells_display)} {uiText("貝")}<small className="private-exact">{uiText("錢包與庫存以重新讀取的結果為準。")}</small></p>}
    {!market.denied && <div className="private-warehouses">{(["user", "agent"] as const).map(owner => {
      const store = market.stores[owner], fallback = inventory[owner], data = store.data;
      const rows = data?.items ?? fallback.data?.items ?? [];
      return <section className="private-panel" key={owner} aria-label={owner === "user" ? uiText("我的倉庫") : uiText("室友的倉庫")}>
        <div className="private-section-heading"><h2>{owner === "user" ? uiText("我的倉庫") : uiText("室友的倉庫")}</h2><span className="private-badge">{owner === "user" ? "YOU" : "AGENT"}</span></div>
        <p className="private-muted">{owner === "user" ? uiText("你偷到的菜與分到的公共收成。") : uiText("室友的收成由室友自行出售；這裡只供查看。")}</p>
        {data && <div className="market-wallet"><span>{owner === "user" ? uiText("我的貝") : uiText("室友的貝")}</span><strong title={data.wallet.exact ?? undefined}>{groupShellDisplay(data.wallet.display)} <small>{uiText("貝")}</small></strong></div>}
        {store.loading && <p className="private-muted" role="status">{uiText("正在更新售值…")}</p>}
        {store.error && <p className="private-error" role="status">{store.error}</p>}
        {!data && fallback.error && <p className="private-error" role="alert">{fallback.error}</p>}
        {rows.length ? <ul className="market-items">{rows.map(item => {
          const price = data?.items.find(i => i.crop_id === item.crop_id);
          const sellable = owner === "user" && data?.can_sell && price?.can_sell && hasSaleStock(item.quantity_g);
          return <li key={item.crop_id}><div className="market-item-heading"><h3><span aria-hidden="true">{privateCropIcons[item.crop_id] ?? "🌱"}</span> {uiText(item.crop_name)}</h3><strong>{exactQuantity(item.quantity_g)}</strong></div>
            {price && <div className="market-item-value"><span>{uiText("整份收成售值")}</span><strong>{price.shells_display === undefined ? uiText("待核對") : <>{groupShellDisplay(price.shells_display)} {uiText("貝")}</>}</strong></div>}
            {price?.unavailable_reason && <p className="private-muted">{unavailableText(price.unavailable_reason)}</p>}
            {sellable && !validSaleQuantity(item.quantity_g, item.quantity_g) && <p className="private-muted">{uiText("這份庫存暫時無法全部出售，仍可填寫部分數量；不會截斷庫存。")}</p>}
            {sellable && <button className="private-button market-sell" type="button" disabled={blocked || store.loading} onClick={() => market.select(item.crop_id)} aria-label={uiText`選擇出售 ${item.crop_name}`}>{uiText("選擇出售數量")}</button>}
            {owner === "user" && market.selected?.crop_id === item.crop_id && order}
          </li>;
        })}</ul> : (data || fallback.data) && <div className="private-empty-small">{uiText("倉庫目前沒有收成。")}</div>}
        {(data?.has_more || (!data && fallback.data?.has_more)) && <button className="private-button" type="button" disabled={blocked || store.loading || fallback.loading} onClick={() => data ? market.loadMore(owner) : loadInventory(owner)}>{uiText("載入更多收成")}</button>}
      </section>;
    })}</div>}
    <p className="private-fineprint">{uiText("畫面顯示值可能四捨五入；分數會另列精確數量，不影響實際庫存。")}</p>
  </div>;
}
