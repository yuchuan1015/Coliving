import { useState } from "react";
import { uiText } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import { useAuth } from "../hooks/useAuth";
import api from "../api/client";
import { CabinUtilityShell } from "../components/CabinUtilityShell";
import { FieldDialog, FieldForm, FieldSelect, FieldText, ResourceState } from "../fields/shared";
import { fieldTime, formText, useFieldResource } from "../fields/fieldData";
import { FormValidationError } from "../fields/formErrors";
import "../dm-reports.css";

interface ReviewRecord {
  id: string; title: string | null; content_type: string; status: string;
  submitter_name: string; created_at: string; reviewer_note: string | null;
}
interface ReviewDetail extends ReviewRecord {
  content: { type: string; title: string; content: string; age_tier: string; age_tier_name: string;
    tier_options: { value: string; name: string; hint: string }[] } | null;
}

export function ContentReviewsPage() {
  useUiLanguage();
  const { user } = useAuth();
  return <CabinUtilityShell title={uiText("親密中心投稿審核")} code="CONTENT REVIEW" backTo="/admin" backLabel={uiText("← 系統儀表板")}>
    <div className="dm-reports">{user?.role === "admin" ? <ContentReviewQueue />
      : <section className="photo-panel"><p role="alert">{uiText("需要管理員權限。")}</p></section>}</div>
  </CabinUtilityShell>;
}

export function ContentReviewQueue() {
  useUiLanguage();
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const list = useFieldResource<ReviewRecord[]>("/review/pending?content_type=adult&limit=50&offset=" + offset);
  return <>
    {notice && <p role="status" className="reports-notice">{uiText(notice)}</p>}
    <section className="photo-panel">
      <div className="utility-toolbar"><h2>{uiText("待審核投稿")}</h2><button disabled={list.loading} onClick={list.refresh}>{uiText("更新清單")}</button></div>
      <p>{uiText("請閱讀全文、決定內容分級，並留下審核意見。投稿人會收到結果通知。")}</p>
      <ResourceState resource={list} empty={list.data?.length === 0} />
      {!list.loading && !list.error && <div className="reports-list">{list.data?.map(r => <article className="reports-item" key={r.id}>
        <h3>{r.title || uiText("未提供標題")}</h3>
        <p className="reports-meta">{r.submitter_name} · {fieldTime(r.created_at)}</p>
        <button onClick={() => setSelected(r.id)}>{uiText("閱讀與決定分級")}</button>
      </article>)}</div>}
      <div className="utility-toolbar"><button disabled={offset === 0 || list.loading} onClick={() => setOffset(n => Math.max(0, n - 50))}>{uiText("上一頁")}</button>
        <span>{uiText("第 ")}{offset / 50 + 1}{uiText(" 頁")}</span>
        <button disabled={list.loading || (list.data?.length ?? 0) < 50} onClick={() => setOffset(n => n + 50)}>{uiText("下一頁")}</button></div>
    </section>
    {selected && <FieldDialog title={uiText("親密中心投稿審核")} onClose={() => { setSelected(null); list.refresh(); }}>
      <ContentReviewDetail key={selected} id={selected} onDone={() => { setSelected(null); setNotice("審核結果已保存。"); list.refresh(); }} />
    </FieldDialog>}
  </>;
}

export function ContentReviewDetail({ id, onDone }: { id: string; onDone: () => void }) {
  useUiLanguage();
  const detail = useFieldResource<ReviewDetail>("/review/" + encodeURIComponent(id));
  const [decision, setDecision] = useState("");
  const record = !detail.error && !detail.loading ? detail.data : undefined;
  const content = record?.content?.type === "adult" ? record.content : undefined;
  const options = content?.tier_options ?? [];
  return <><ResourceState resource={detail} />
    {record && !content && <p role="alert">{uiText("文章已移除或不是親密中心投稿，無法在這裡審核。")}</p>}
    {content && <div className="reports-review">
      <section className="reports-summary"><h3>{content.title}</h3>
        <p className="reports-meta">{record?.submitter_name} · {uiText("投稿建議：")}{uiText(content.age_tier_name)}</p>
        <p className="reports-body">{content.content}</p>
      </section>
      {record?.status !== "pending" ? <p className="reports-notice">{uiText("這筆投稿已處理，不會重複送出審核。")}{record?.reviewer_note}</p>
        : <FieldForm guarded label={uiText("確認保存審核")} submit={async data => {
          const note = formText(data, "note"), ageTier = formText(data, "age_tier");
          if (!["approved", "rejected"].includes(decision)) throw new FormValidationError("請選擇審核結果。");
          if (!note || note.length > 2000) throw new FormValidationError("請填寫 2000 字以內的審核意見。");
          if (decision === "approved" && !options.some(t => t.value === ageTier)) throw new FormValidationError("請選擇後端提供的內容分級。");
          await api.post("/review/" + encodeURIComponent(id) + "/decide", { decision, note, ...(decision === "approved" ? { age_tier: ageTier } : {}) });
        }} onDone={onDone}>
          <label className="field-input">{uiText("審核結果")}<select required name="decision" value={decision} onChange={e => setDecision(e.target.value)}>
            <option value="">{uiText("請選擇")}</option><option value="approved">{uiText("通過並上架")}</option><option value="rejected">{uiText("退回投稿")}</option>
          </select></label>
          {decision === "approved" && <>
            <FieldSelect name="age_tier" label={uiText("決定分級")} value={options.some(t => t.value === content.age_tier) ? content.age_tier : ""}
              options={{ "": uiText("請選擇"), ...Object.fromEntries(options.map(t => [t.value, uiText(t.name) + " · " + uiText(t.hint)])) }} />
            {!options.length && <p role="alert">{uiText("未取得可用分級，請關閉後重新讀取，現在無法通過投稿。")}</p>}
          </>}
          <FieldText name="note" label={uiText("審核意見")} max={2000} />
          <label className="field-check"><input type="checkbox" required />{uiText("我已閱讀全文，確認保存這筆審核。")}</label>
        </FieldForm>}
    </div>}
  </>;
}
