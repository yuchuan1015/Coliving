import { useState, type FormEvent } from "react";
import { uiText } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import { validWishDraft, type PetWishDraft } from "../api/pet-wish-draft";

export function PetWishForm({ locked, onConfirm }: { locked: boolean; onConfirm: (draft: PetWishDraft) => Promise<boolean> }) {
  useUiLanguage();
  const [draft, setDraft] = useState<PetWishDraft>({ requested_name: "", requested_species: "", appearance_description: "" });
  const [review, setReview] = useState(false), [consent, setConsent] = useState(false), [error, setError] = useState("");
  function change(key: keyof PetWishDraft, value: string) { if (!locked && !review) setDraft(p => ({ ...p, [key]: value })); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (locked) return;
    const clean = { requested_name: draft.requested_name.trim(), requested_species: draft.requested_species.trim(), appearance_description: draft.appearance_description.trim() };
    if (!validWishDraft(clean)) { setError(uiText("名字與物種請填 1–64 個字元，外觀描述請填 1–2000 個字元；不能只有空白。")); return; }
    setError("");
    if (!review) { setDraft(clean); setConsent(false); setReview(true); return; }
    if (!consent) { setError(uiText("請先確認名額與不可更改的規則。")); return; }
    await onConfirm(clean);
  }
  return <section className="pet-wish-box">
    <div className="pet-wish-heading"><span aria-hidden="true">✦</span><h3>{uiText(review ? "確認你的願望" : "許願一位小夥伴")}</h3></div>
    <p>{uiText("告訴我們，你希望誰來陪你生活？")}</p>
    <p className="pet-footnote">{uiText("預計需要三個工作天準備，準備好後會透過站內信箱通知你。")}</p>
    <form className="pet-adoption" onSubmit={submit}><fieldset disabled={locked}>
      {review ? <dl className="pet-wish-summary"><dt>{uiText("名字")}</dt><dd>{draft.requested_name}</dd><dt>{uiText("物種")}</dt><dd>{draft.requested_species}</dd><dt>{uiText("外觀描述")}</dt><dd>{draft.appearance_description}</dd></dl> : <>
        <label>{uiText("名字")}<input name="requested_name" value={draft.requested_name} onChange={e => change("requested_name", e.target.value)} required autoComplete="off" /></label>
        <label>{uiText("想要的物種")}<input name="requested_species" value={draft.requested_species} onChange={e => change("requested_species", e.target.value)} required autoComplete="off" /></label>
        <label>{uiText("外觀描述")}<textarea name="appearance_description" value={draft.appearance_description} onChange={e => change("appearance_description", e.target.value)} required rows={4} placeholder={uiText("例如毛色、花紋，或你希望牠有的小特徵。")} /></label>
      </>}
      <p className="pet-wish-rule">{uiText("許願成功就占用一個寵物名額，之後無法修改或取消。到家時不會再多占一格。")}</p>
      {review && <label className="pet-consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} required />{uiText("我確認這個願望，並了解送出成功後無法修改或取消。")}</label>}
      {error && <p role="alert">{error}</p>}
      <div className="pet-wish-buttons">{review && <button type="button" onClick={() => { setReview(false); setConsent(false); }}>{uiText("返回填寫")}</button>}<button type="submit" className="pet-primary">{uiText(locked ? "處理中…" : review ? "確認許願並保留名額" : "檢查我的願望")}</button></div>
    </fieldset></form>
  </section>;
}
