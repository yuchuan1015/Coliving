import { uiText, uiOptions } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import { useState } from "react";
import api from "../api/client";
import { FieldForm, FieldInput, FieldSelect, ResourceState } from "../fields/shared";
import { FormValidationError } from "../fields/formErrors";
import { formText, useFieldResource } from "../fields/fieldData";

interface ActionProps { onBusyChange: (busy: boolean) => void }
interface Outfit { id: string; name: string; description?: string | null }
interface Dining { active: boolean; session_id?: string; status?: string; description?: string }
interface Pet { id: string; name: string; species: string; emoji: string; hunger: number; cleanliness: number; happiness: number; health: number; is_alive: boolean }
const PET_ACTIONS = { feed: "餵食", clean: "清潔", play: "陪玩", walk: "散步", rest: "休息" };

export function WardrobeActions({ onBusyChange }: ActionProps) {
  useUiLanguage();
  const outfits = useFieldResource<Outfit[]>("/outfits/");
  const current = useFieldResource<{ outfit: Outfit | null }>("/outfits/current");
  const [notice, setNotice] = useState("");
  function refresh() { outfits.refresh(); current.refresh(); }
  return <div className="field-stack"><ResourceState resource={outfits} /><ResourceState resource={current} /><button onClick={refresh}>{uiText("更新衣櫃")}</button><p role="status">{uiText(notice)}</p>
    {current.data && <p>{uiText("目前造型：")}{current.data.outfit?.name ?? uiText("尚未穿戴")}</p>}
    {outfits.data && current.data && <FieldForm guarded label={uiText("確認換裝")} onBusyChange={onBusyChange} submit={async data => {
      const value = formText(data, "outfit_id"), outfit_id = value === "none" ? "" : value;
      if (outfit_id && !outfits.data?.some(o => o.id === outfit_id)) throw new FormValidationError("這套造型已不在清單，請重新讀取。");
      await api.post(outfit_id ? "/outfits/change" : "/outfits/remove", outfit_id ? { outfit_id } : undefined);
    }} onDone={() => { setNotice("造型已保存，正在重新讀取。"); refresh(); }}>
      <FieldSelect name="outfit_id" label={uiText("想換上的造型")} value={current.data.outfit?.id ?? "none"} options={{ none: uiText("不穿戴造型"), ...Object.fromEntries(outfits.data.map(o => [o.id, o.name])) }} />
      <small>{uiText("更新室友的造型設定；寫實艙室底圖不會因此重畫。")}</small>
    </FieldForm>}
  </div>;
}

export function DiningActions({ onBusyChange }: ActionProps) {
  useUiLanguage();
  const current = useFieldResource<Dining>("/home/dining/current"); const [notice, setNotice] = useState("");
  return <div className="field-stack"><ResourceState resource={current} /><button onClick={current.refresh}>{uiText("更新餐桌")}</button><p role="status">{uiText(notice)}</p>
    {current.data?.active ? <><p>{current.data.status === "pending" ? uiText("已邀請，等待室友回應") : uiText("正在一起吃飯")}</p><p>{current.data.description}</p><FieldForm guarded label={uiText("確認結束用餐")} onBusyChange={onBusyChange} submit={() => api.post("/home/dining/end")} onDone={() => { setNotice("用餐已結束，餐點照片已清除。"); current.refresh(); }}><label className="field-check"><input required type="checkbox" />{uiText("結束這次用餐並清除餐點照片。")}</label></FieldForm></> : current.data && <FieldForm guarded label={uiText("邀請室友一起吃飯")} onBusyChange={onBusyChange} submit={async data => {
      const file = data.get("photo");
      if (!(file instanceof File) || !file.size || file.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) throw new FormValidationError("請選擇 5MB 以內的 JPEG、PNG、WebP 或 GIF 餐點照片。");
      const body = new FormData(); body.append("photo", file); body.append("description", formText(data, "description"));
      await api.post("/home/dining/invite", body);
    }} onDone={() => { setNotice("邀請已送出，等待室友回應。"); current.refresh(); }}>
      <label className="field-input">{uiText("餐點照片")}<input name="photo" type="file" required accept="image/jpeg,image/png,image/webp,image/gif" /></label><FieldInput name="description" label={uiText("今天吃什麼？（選填）")} max={2000} required={false} />
      <small>{uiText("照片會上傳到社區，供室友回應；有掛 API 金鑰時可能交給你選的供應商，並使用其額度。結束用餐後照片清除。")}</small><label className="field-check"><input type="checkbox" required />{uiText("我確認上傳這張照片並發出邀請。")}</label>
    </FieldForm>}
  </div>;
}

export function PetActions({ onBusyChange }: ActionProps) {
  useUiLanguage();
  const list = useFieldResource<{ pets: Pet[]; max_pets: number }>("/pets"); const [notice, setNotice] = useState("");
  return <div className="field-stack"><ResourceState resource={list} /><button onClick={list.refresh}>{uiText("更新寵物狀態")}</button><p role="status">{uiText(notice)}</p>
    {list.data && <><p>{uiText("目前 ")}{list.data.pets.length} / {list.data.max_pets}{uiText(" 位小夥伴；領養資格以社區信用與後端檢查為準。")}</p>
      {list.data.pets.map(p => <section className="field-item" key={p.id}><h3>{p.emoji} {p.name} · {p.species}</h3><p>{uiText("飢餓 ")}{p.hunger}{uiText(" · 清潔 ")}{p.cleanliness}{uiText(" · 心情 ")}{p.happiness}{uiText(" · 健康 ")}{p.health}</p>{p.is_alive && <FieldForm guarded label={uiText`確認與 ${p.name} 互動`} onBusyChange={onBusyChange} submit={async data => {
        const action = formText(data, "action"); if (!(action in PET_ACTIONS)) throw new FormValidationError("請選擇互動方式。");
        await api.post(`/pets/${encodeURIComponent(p.id)}/interact`, null, { params: { action } });
      }} onDone={() => { setNotice("互動已完成，正在讀取小夥伴的狀態。"); list.refresh(); }}><FieldSelect name="action" label={uiText("想一起做什麼")} options={uiOptions(PET_ACTIONS)} /></FieldForm>}</section>)}
      {list.data.pets.length < list.data.max_pets ? <FieldForm guarded label={uiText("確認領養小夥伴")} onBusyChange={onBusyChange} submit={async data => {
        const name = formText(data, "name"), species = formText(data, "species"), emoji = formText(data, "emoji");
        if (!name || !species || !emoji || name.length > 64 || species.length > 64 || [...emoji].length > 8) throw new FormValidationError("請填寫名字、種類與圖示，並符合字數限制。");
        await api.post("/pets/adopt", { name, species, emoji });
      }} onDone={() => { setNotice("新的小夥伴入住了。"); list.refresh(); }}><FieldInput name="name" label={uiText("名字")} max={64} /><FieldInput name="species" label={uiText("種類")} max={64} /><FieldInput name="emoji" label={uiText("圖示（Emoji）")} max={8} /><label className="field-check"><input type="checkbox" required />{uiText("我確認領養並照顧這位小夥伴。")}</label></FieldForm> : <p>{uiText("目前沒有空出的領養名額。")}</p>}
      <small>{uiText("艙室底圖裡的貓咪只是空間示意，入住與狀態以這份清單為準。")}</small>
    </>}
  </div>;
}
