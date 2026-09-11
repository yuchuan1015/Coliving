import { getUiLanguage, uiText } from "../i18n/core";
import type { PetCapacity } from "../api/pets";
import type { PetWish, PendingWishOperation } from "../api/pet-wishes";
export function PetCapacityLine({ capacity }: { capacity?: PetCapacity }) {
  return <p className="pet-capacity">{capacity ? uiText`已占用 ${capacity.occupied_pets} / ${capacity.max_pets} 個名額 · 已到家 ${capacity.active_pets} · 等待到家 ${capacity.reserved_pets}` : uiText("名額資料尚未同步，暫時無法領養或許願。")}</p>;
}
export function PetWishSummary({ wish }: { wish: PetWish }) {
  return <><dl className="pet-wish-summary"><dt>{uiText("名字")}</dt><dd>{wish.requested_name}</dd><dt>{uiText("物種")}</dt><dd>{wish.requested_species}</dd><dt>{uiText("外觀描述")}</dt><dd>{wish.appearance_description}</dd><dt>{uiText("送出時間")}</dt><dd>{new Intl.DateTimeFormat(getUiLanguage(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(wish.created_at))}</dd></dl>
    <p className="pet-wish-rule">{wish.status === "arrived" ? uiText("小夥伴已到家，原本保留的名額已轉為入住名額。") : uiText("已保留一個寵物名額，這份願望無法修改或取消。")}</p>
    {wish.status !== "arrived" && <p className="pet-footnote">{uiText("預計需要三個工作天準備，準備好後會透過站內信箱通知你。")}</p>}
    {wish.fulfillment_issue && <p role="status" className="pet-notice">{uiText("這份願望正在由管理員確認，已保留的名額不會釋放。")}</p>}</>;
}
export function PetPendingRecovery({ pending, busy, blocked, error, onLookup, onRetry }: { pending?: PendingWishOperation; busy: boolean; blocked: boolean; error: string; onLookup: () => void; onRetry: () => void }) {
  if (!pending) return null;
  return <section className="pet-confirm" aria-label={uiText("核對未確認的操作")}><h4>{uiText("這筆操作還需要核對")}</h4>
    {pending.kind === "create" && <dl className="pet-wish-summary"><dt>{uiText("名字")}</dt><dd>{pending.body.requested_name}</dd><dt>{uiText("物種")}</dt><dd>{pending.body.requested_species}</dd><dt>{uiText("外觀描述")}</dt><dd>{pending.body.appearance_description}</dd></dl>}
    <p>{error || uiText("已保留原本的提交記錄，不會自動再次送出，也不能另外建立相同願望。")}</p>
    <div>{pending.kind === "create" && <button type="button" disabled={busy || blocked} onClick={onLookup}>{uiText("查回這筆願望")}</button>}<button type="button" disabled={busy || blocked} onClick={onRetry}>{uiText(pending.kind === "create" ? "重送同一筆願望" : "重送同一筆到家確認")}</button></div>
  </section>;
}
