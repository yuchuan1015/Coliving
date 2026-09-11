import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { PET_ACTIONS, validPetAdoption, type PetGateway, type PetStatus, type PetAction } from "../api/pets";
import { petWishApi, type PetAsset } from "../api/pet-wishes";
import { usePetWishes } from "../hooks/usePetWishes";
import { PetWishForm } from "./PetWishForm";
import { PetCapacityLine, PetPendingRecovery, PetWishSummary } from "./PetWishViews";
import { usePets } from "../hooks/usePets";
import { useUiLanguage } from "../i18n/useUiLanguage";
import { getUiLanguage, uiText } from "../i18n/core";
import "../pets.css";

// Real saved emoji remains the fallback until the separately produced image catalog is approved.
function PetPortrait({ pet, asset, compact = false }: { pet: Pick<PetStatus, "name" | "emoji">; asset?: PetAsset; compact?: boolean }) {
  const [failed, setFailed] = useState("");
  return <span className={`pet-portrait${compact ? " is-compact" : ""}`} role="img" aria-label={uiText`${pet.name}的圖示`}>{asset && failed !== asset.image_url ? <img src={asset.image_url} alt="" onError={() => setFailed(asset.image_url)} /> : pet.emoji}</span>;
}
const meters = [{ key: "hunger", label: "飽足" }, { key: "cleanliness", label: "清潔" }, { key: "happiness", label: "心情" }, { key: "health", label: "健康" }] as const;
export function PetActions({ userId, onBusyChange, gateway }: { userId: string; onBusyChange: (busy: boolean) => void; gateway?: PetGateway }) {
  useUiLanguage();
  const callbacks = useRef(onBusyChange); callbacks.current = onBusyChange;
  const work = useRef({ pets: false, wishes: false });
  const petBusy = useCallback((value: boolean) => { work.current.pets = value; callbacks.current(work.current.pets || work.current.wishes); }, []);
  const wishBusy = useCallback((value: boolean) => { work.current.wishes = value; callbacks.current(work.current.pets || work.current.wishes); }, []);
  const pets = usePets(userId, gateway, petBusy);
  const wishes = usePetWishes(userId, false, gateway ? gateway.wishes : petWishApi, wishBusy);
  const [localOwner, setLocalOwner] = useState(userId), [storedView, setView] = useState("list"), [action, setAction] = useState<PetAction | null>(null);
  const view = localOwner === userId ? storedView : "list";
  const [name, setName] = useState(""), [assetKey, setAssetKey] = useState(""), [consent, setConsent] = useState(false);
  const [validation, setValidation] = useState("");
  useEffect(() => { if (localOwner !== userId) { setLocalOwner(userId); setView("list"); setAction(null); setName(""); setAssetKey(""); setConsent(false); setValidation(""); } }, [userId, localOwner]);
  const heading = useRef<HTMLHeadingElement>(null), initialView = useRef(true), actionId = useId();
  const selected = pets.data?.pets.find(p => p.id === view);
  const capacity = wishes.list?.capacity;
  const canAdopt = !!capacity?.can_adopt && !!pets.data?.capacity?.can_adopt;
  const canWish = !!capacity?.can_wish;
  const busy = pets.busy || wishes.busy;
  const locked = busy || pets.loading || pets.uncertain || !!pets.error;
  const newLocked = locked || wishes.loading || wishes.denied || wishes.storageError || !!wishes.pending || !!wishes.error;
  useEffect(() => { if (initialView.current) initialView.current = false; else heading.current?.focus(); }, [view]);
  function go(next: string) { if (!busy) { setAction(null); setValidation(""); setView(next); } }
  async function refresh() { if (busy) return; setAction(null); if (view === "adopt" && pets.uncertain) go("list"); await pets.refresh(); await wishes.refresh(); }
  async function confirmCare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected || !action || locked) return;
    if (await pets.interact(selected.id, action)) setAction(null);
  }
  async function confirmAdoption(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (newLocked || !canAdopt || !consent) return;
    const body = { name: name.trim(), asset_key: assetKey };
    if (!validPetAdoption(body) || !wishes.assets?.some(a => a.asset_key === assetKey)) { setValidation(uiText("請填寫 1–64 個字元的名字，並選擇圖庫中的小夥伴。")); return; }
    setValidation("");
    if (await pets.adopt(body)) { setName(""); setAssetKey(""); setConsent(false); go("list"); await refresh(); }
  }
  const format = (n: number) => new Intl.NumberFormat(getUiLanguage(), { maximumFractionDigits: 1 }).format(n);
  const asset = (key?: string | null) => wishes.assets?.find(a => a.asset_key === key);
  return <div className="pet-panel" aria-busy={busy || pets.loading || wishes.loading}>
    <div className="pet-toolbar"><span>{view === "list" ? uiText("共居小夥伴") : <button type="button" disabled={busy} onClick={() => go("list")}>{uiText("← 小夥伴清單")}</button>}</span><button type="button" disabled={busy || pets.loading || wishes.loading} onClick={() => void refresh()}>{uiText("更新狀態")}</button></div>
    {pets.loading && <p role="status">{uiText("正在讀取小夥伴…")}</p>}
    {pets.error && <p className="pet-notice" role="alert">{pets.error}</p>}
    {pets.notice && <p className="pet-notice" role="status">{pets.notice}</p>}
    {wishes.loading && <p role="status">{uiText("正在讀取願望與名額…")}</p>}
    {wishes.error && !wishes.pending && <p className="pet-notice" role="alert">{wishes.error}</p>}
    {wishes.storageError && <p className="pet-notice" role="alert">{uiText("本機重試記錄無法安全讀寫，暫時不能提交新願望。")}</p>}
    <PetPendingRecovery pending={wishes.pending} busy={busy} blocked={wishes.denied || wishes.storageError || wishes.conflict} error={wishes.error} onLookup={() => void wishes.lookup()} onRetry={() => void wishes.retry()} />
    {wishes.result && !wishes.pending && <p className="pet-notice" role="status">{uiText("已確認許願收據。名額已保留，可以在清單查看目前進度。")}</p>}
    {pets.data && view === "list" && <>
      <h3 ref={heading} tabIndex={-1} className="pet-section-title">{uiText("你們的小夥伴")}</h3>
      <PetCapacityLine capacity={capacity} />
      <div className="pet-list">{pets.data.pets.map(pet => <button type="button" className="pet-list-card" key={pet.id} disabled={pets.busy} onClick={() => go(pet.id)}>
        <PetPortrait pet={pet} asset={asset(pet.asset_key)} compact /><span className="pet-list-copy"><strong>{pet.name}</strong><span>{pet.species}</span><span className="pet-open-label">{pet.is_alive ? uiText("查看與照顧") : uiText("目前無法互動")}</span></span><span aria-hidden="true">›</span>
      </button>)}</div>
      {!pets.data.pets.length && <div className="pet-empty"><h4>{uiText("還沒有小夥伴入住")}</h4><p>{canAdopt ? uiText("領養後，就能在這裡看看牠、照顧牠。") : uiText("目前沒有空出的領養名額，資格以室友的社區紀錄為準。")}</p></div>}
      {wishes.list && wishes.list.items.length > 0 && <section className="pet-wish-list"><h4>{uiText("我的願望")}</h4>{wishes.list.items.map(w => <button type="button" className="pet-wish-card" key={w.id} disabled={busy || !!wishes.pending || wishes.loading} onClick={() => { go("wish-detail"); void wishes.select(w.id); }}><span aria-hidden="true">✦</span><span><strong>{w.requested_name}</strong><small>{w.requested_species}</small></span><span>{uiText(w.status === "arrived" ? "已到家" : "等待到家")}</span></button>)}{wishes.list.has_more && <button type="button" disabled={busy || wishes.loading} onClick={() => void wishes.refresh(true)}>{uiText("查看更多願望")}</button>}</section>}
      {(canAdopt || canWish) && <button type="button" className="pet-primary" disabled={newLocked} onClick={() => go("adopt")}>{uiText("領養小夥伴")}</button>}
      {capacity && !capacity.available_slots && <p className="pet-footnote">{uiText("目前沒有空出的領養名額，等待到家的願望也已計入。")}</p>}
      <p className="pet-footnote">{uiText("艙室底圖裡的貓咪只是空間示意，入住與狀態以這份清單為準。")}</p>
    </>}
    {pets.data && !["list", "adopt", "wish", "wish-detail"].includes(view) && (selected ? <section className="pet-detail">
      <div className="pet-hero"><PetPortrait pet={selected} asset={asset(selected.asset_key)} /><div><h3 ref={heading} tabIndex={-1}>{selected.name}</h3><p>{selected.species}</p>{selected.age_days !== undefined && <p className="pet-age">{uiText`${selected.age_days} 天大`}</p>}</div></div>
      <div className="pet-meters">{meters.map(({ key, label }) => <div className="pet-meter" key={key}><div><span>{uiText(label)}</span><span>{format(selected[key])}<span className="pet-meter-max"> / 100</span></span></div><progress aria-label={uiText(label)} max={100} value={selected[key]} /></div>)}</div>
      <p className="pet-footnote">{uiText("飽足數值越高，代表越吃得飽。狀態以最近一次讀取為準。")}</p>
      {selected.is_alive ? <><h4>{uiText("一起做點什麼")}</h4><div className="pet-care-options" role="group" aria-label={uiText("照顧方式")}>{Object.entries(PET_ACTIONS).map(([key, label]) => <button type="button" key={key} disabled={locked} aria-pressed={action === key} aria-controls={actionId} onClick={() => setAction(key as PetAction)}>{uiText(label)}</button>)}</div>
        {action && <form id={actionId} className="pet-confirm" onSubmit={confirmCare}><p>{uiText`確認為 ${selected.name} 進行「${uiText(PET_ACTIONS[action])}」？`}</p><div><button type="button" disabled={pets.busy} onClick={() => setAction(null)}>{uiText("取消")}</button><button type="submit" className="pet-primary" disabled={locked}>{pets.busy ? uiText("處理中…") : uiText("確認照顧")}</button></div></form>}
      </> : <p className="pet-notice">{uiText("這位小夥伴目前無法互動。")}</p>}
    </section> : <p role="status">{uiText("清單已更新，這位小夥伴目前不在清單中。")}</p>)}
    {view === "adopt" && <section className="pet-detail"><h3 ref={heading} tabIndex={-1} className="pet-section-title">{uiText("迎接新的小夥伴")}</h3><PetCapacityLine capacity={capacity} />
      {wishes.catalogError && <p role="alert">{wishes.catalogError}</p>}
      {wishes.assets?.length ? <form className="pet-adoption" onSubmit={confirmAdoption}><fieldset disabled={newLocked || !canAdopt}>
        <div className="pet-catalog" role="group" aria-label={uiText("選擇小夥伴")}>{wishes.assets.map(a => <button type="button" key={a.asset_key} aria-pressed={assetKey === a.asset_key} onClick={() => { setAssetKey(a.asset_key); setConsent(false); }}><PetPortrait pet={{ name: a.species, emoji: a.emoji }} asset={a} compact /><span>{a.species}</span></button>)}</div>
        <label>{uiText("名字")}<input name="name" value={name} onChange={e => { setName(e.target.value); setConsent(false); }} required autoComplete="off" /></label>
        <label className="pet-consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} required />{uiText("我確認領養並照顧這位小夥伴。")}</label>
        {validation && <p role="alert">{validation}</p>}<button type="submit" className="pet-primary">{uiText("確認領養小夥伴")}</button>
      </fieldset></form> : wishes.assets && <p className="pet-notice">{uiText("目前還沒有開放領養的圖庫。你可以先許下一個願望。")}</p>}
      <button type="button" className="pet-wish-entry" disabled={newLocked || !canWish} onClick={() => go("wish")}><span aria-hidden="true">✦</span><span><strong>{uiText("許願一位小夥伴")}</strong><small>{uiText("沒有想選的物種？告訴我們你的願望。")}</small></span><span aria-hidden="true">›</span></button>
    </section>}
    {view === "wish" && <div hidden={!!wishes.pending}><PetWishForm key={userId} locked={newLocked || !canWish} onConfirm={async draft => { const accepted = await wishes.create(draft); if (accepted) go("list"); return accepted; }} />{!canWish && <p role="status">{uiText("目前沒有可用的許願名額，請先更新狀態。")}</p>}</div>}
    {view === "wish-detail" && wishes.detail && <section className="pet-wish-box"><h3 ref={heading} tabIndex={-1}>{uiText(wishes.detail.wish.status === "arrived" ? "小夥伴已到家" : "等待小夥伴到家")}</h3><PetWishSummary wish={wishes.detail.wish} /><PetCapacityLine capacity={wishes.detail.capacity} /></section>}
  </div>;
}
