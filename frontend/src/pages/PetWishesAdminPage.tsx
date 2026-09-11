import { useState, type FormEvent } from "react";
import { useAuth } from "../hooks/useAuth";
import { usePetWishes } from "../hooks/usePetWishes";
import { petWishApi, type PetWishGateway, type WishStatus, type WishDetail, type PetAsset } from "../api/pet-wishes";
import { CabinUtilityShell } from "../components/CabinUtilityShell";
import { PetCapacityLine, PetPendingRecovery, PetWishSummary } from "../components/PetWishViews";
import { uiText } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import "../pets.css";

export function PetWishesAdminPage({ gateway = petWishApi }: { gateway?: PetWishGateway }) {
  useUiLanguage(); const { user } = useAuth();
  return <CabinUtilityShell title={uiText("寵物許願管理")} code="PET WISHES" backTo="/admin" backLabel={uiText("← 系統儀表板")}>
    {user?.role === "admin" ? <PetWishQueue key={user.id} userId={user.id} gateway={gateway} /> : <section className="photo-panel"><p role="alert">{uiText("需要管理員權限。")}</p></section>}
  </CabinUtilityShell>;
}
export function PetWishQueue({ userId, gateway = petWishApi }: { userId: string; gateway?: PetWishGateway }) {
  useUiLanguage(); const desk = usePetWishes(userId, true, gateway);
  const [filter, setFilter] = useState<WishStatus | "">("");
  const locked = desk.busy || desk.loading || desk.denied || desk.storageError || !!desk.pending;
  return <div className="pet-admin pet-panel">
    <div className="pet-toolbar">{desk.detail ? <button type="button" disabled={desk.busy} onClick={desk.back}>{uiText("← 願望清單")}</button> : <h2 className="pet-section-title">{uiText("小夥伴的到家準備")}</h2>}<button type="button" disabled={desk.busy || desk.loading} onClick={() => { if (desk.detail && !desk.pending) void desk.select(desk.detail.wish.id); else void desk.refresh(); }}>{uiText("重新讀取")}</button></div>
    {desk.loading && <p role="status">{uiText("正在讀取許願資料…")}</p>}
    {desk.error && !desk.pending && <p className="pet-notice" role="alert">{desk.error}</p>}
    {desk.storageError && <p role="alert">{uiText("本機重試記錄無法安全讀寫，暫時不能確認到家。")}</p>}
    <PetPendingRecovery pending={desk.pending} busy={desk.busy} blocked={desk.denied || desk.storageError || desk.conflict} error={desk.error} onLookup={() => {}} onRetry={() => void desk.retry()} />
    {desk.result && !desk.pending && <p className="pet-notice" role="status">{uiText("到家結果已確認，寵物與站內通知不會重複建立。")}</p>}
    {!desk.detail && <section className="photo-panel pet-wish-list"><div className="pet-status-tabs" role="group" aria-label={uiText("許願狀態")}>{([["", "全部"], ["pending", "待準備"], ["preparing", "準備中"], ["arrived", "已到家"]] as const).map(([key, label]) => <button type="button" key={key} disabled={desk.busy || desk.loading} aria-pressed={filter === key} onClick={() => { setFilter(key); void desk.refresh(false, key); }}>{uiText(label)}</button>)}</div>
      {desk.list?.items.map(w => <button type="button" className="pet-wish-card" key={w.id} disabled={locked} onClick={() => void desk.select(w.id)}><span aria-hidden="true">✦</span><span><strong>{w.requested_name}</strong><small>{w.requested_species}</small></span><span>{uiText(w.status === "arrived" ? "已到家" : w.status === "preparing" ? "準備中" : "待準備")}</span></button>)}
      {desk.list?.items.length === 0 && <p>{uiText("這個狀態目前沒有許願申請。")}</p>}
      {desk.list?.has_more && <button type="button" disabled={locked} onClick={() => void desk.refresh(true)}>{uiText("查看更多願望")}</button>}
    </section>}
    {desk.detail && !desk.denied && <section className="photo-panel pet-detail"><h2 className="pet-section-title">{desk.detail.wish.requested_name}</h2><PetWishSummary wish={desk.detail.wish} /><PetCapacityLine capacity={desk.detail.capacity} />
      {desk.detail.wish.status !== "arrived" && !desk.pending && <PetWishPreparation key={`${desk.detail.wish.id}:${desk.detail.wish.version}`} detail={desk.detail} assets={desk.assets} catalogError={desk.catalogError} locked={locked || desk.preparationUnknown} onPrepare={desk.prepare} onArrive={desk.arrive} />}
    </section>}
  </div>;
}
export function PetWishPreparation({ detail, assets, catalogError, locked, onPrepare, onArrive }: { detail: WishDetail; assets?: PetAsset[]; catalogError: string; locked: boolean;
  onPrepare: (assetKey: string | null, note: string) => Promise<boolean>; onArrive: () => Promise<boolean> }) {
  useUiLanguage(); const w = detail.wish;
  const [assetKey, setAssetKey] = useState(w.asset_key ?? ""), [note, setNote] = useState(w.preparation_note ?? ""), [confirmed, setConfirmed] = useState(false), [notice, setNotice] = useState("");
  const dirty = assetKey !== (w.asset_key ?? "") || note !== (w.preparation_note ?? "");
  const available = !!assetKey && !!assets?.some(a => a.asset_key === assetKey);
  const canArrive = w.status === "preparing" && available && !dirty && !locked && confirmed;
  async function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (locked) return; if ([...note].length > 2000) { setNotice(uiText("準備筆記請保持在 2000 個字元以內。")); return; } if (await onPrepare(assetKey || null, note)) setNotice(uiText("準備資料已保存。")); }
  return <div className="pet-detail"><form className="pet-adoption" onSubmit={save}><fieldset disabled={locked}>
    <label>{uiText("已交付的寵物圖資")}<select value={assetKey} onChange={e => { setAssetKey(e.target.value); setConfirmed(false); }}><option value="">{uiText("尚未準備好")}</option>{assetKey && !available && <option disabled value={assetKey}>{uiText("原圖資目前不可用")}</option>}{assets?.map(a => <option key={a.asset_key} value={a.asset_key}>{a.species} · {a.asset_key}</option>)}</select><span>{uiText("只能選擇已交付並登錄的圖片，不能自行貼網址。")}</span></label>
    {catalogError && <p role="alert">{catalogError}</p>}
    {assets?.length === 0 && <p className="pet-notice">{uiText("圖資尚未交付。可以先記錄準備進度，現在不能確認到家。")}</p>}
    <label>{uiText("管理準備筆記")}<textarea value={note} onChange={e => { setNote(e.target.value); setConfirmed(false); }} rows={4} /><span>{uiText("僅管理員可見，不會改動居民原本的願望。")}</span></label>
    {notice && <p role="status">{notice}</p>}<button type="submit">{uiText(w.status === "pending" ? "開始準備" : "保存準備資料")}</button>
  </fieldset></form>
    <section className="pet-confirm"><h3 className="pet-section-title">{uiText("確認小夥伴到家")}</h3><p>{uiText("這會把已保留的名額轉為入住寵物，並寄出一封站內通知；不會再占用第二格。")}</p>
      {dirty && <p>{uiText("請先保存準備資料，再確認到家。")}</p>}
      <label className="pet-consent"><input type="checkbox" checked={confirmed} disabled={locked || dirty || !available || w.status !== "preparing"} onChange={e => setConfirmed(e.target.checked)} />{uiText("我已核對原願望與交付圖片，確認讓小夥伴到家。")}</label>
      <button type="button" className="pet-primary" disabled={!canArrive} onClick={() => { if (canArrive) void onArrive(); }}>{uiText("確認到家並通知居民")}</button>
    </section>
  </div>;
}
