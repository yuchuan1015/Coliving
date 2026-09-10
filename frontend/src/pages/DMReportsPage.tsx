import { uiText, uiOptions } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import { useState } from "react";
import api from "../api/client";
import { useAuth } from "../hooks/useAuth";
import { CabinUtilityShell } from "../components/CabinUtilityShell";
import { FieldDialog, FieldForm, FieldSelect, FieldTabs, ResourceState } from "../fields/shared";
import { FormValidationError } from "../fields/formErrors";
import { fieldTime, formText, useFieldResource } from "../fields/fieldData";
import "../dm-reports.css";

interface Report { id: string; reporter: string; reported: string; reason: string; status: string; admin_note: string | null; created_at: string; resolved_at: string | null }
interface ReportDetail { report: Report; messages: { sender: string; content: string; action: string; created_at: string }[] }
const STATUSES = { pending: "待審核", upheld: "成立", dismissed: "不成立" };
const statusLabel = (value: string) => uiText(STATUSES[value as keyof typeof STATUSES] ?? value);
export function DMReportsPage() {
  useUiLanguage();
  const { user } = useAuth();
  return <CabinUtilityShell title={uiText("私訊檢舉審核")} code="REPORTS" backTo="/admin" backLabel={uiText("← 系統儀表板")}>
    <div className="dm-reports">
      {user?.role === "admin" ? <Reports /> : <section className="photo-panel"><p role="alert">{uiText("需要管理員權限。")}</p></section>}
    </div>
  </CabinUtilityShell>;
}
function Reports() {
  useUiLanguage();
  const [status, setStatus] = useState("pending");
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const list = useFieldResource<{ reports: Report[] }>(`/admin/dm-reports?status=${status}`);
  return <>
    <FieldTabs value={status} options={uiOptions(STATUSES)} onChange={setStatus} />
    {notice && <p className="reports-notice" role="status">{uiText(notice)}</p>}
    <section className="photo-panel">
      <div className="utility-toolbar"><h2>{uiText("檢舉清單")}</h2><button type="button" disabled={list.loading} onClick={list.refresh}>{uiText("更新清單")}</button></div>
      <ResourceState resource={list} />
      {!list.loading && !list.error && list.data?.reports.length === 0 && <div className="reports-empty">
        <h3>{status === "pending" ? uiText("目前沒有待審核的檢舉") : uiText("此分類目前沒有檢舉")}</h3>
        <p>{uiText("可切換分類查看已處理的案件，或稍後更新清單。")}</p>
      </div>}
      <div className="reports-list">{list.data?.reports.map(r => <article className="reports-item" key={r.id}>
        <div className="utility-toolbar"><h3>{r.reporter}{uiText(" 檢舉 ")}{r.reported}</h3><span className="photo-badge">{statusLabel(r.status)}</span></div>
        <p className="reports-body">{r.reason}</p>
        <p className="reports-meta">{uiText("檢舉時間")} · {uiText(fieldTime(r.created_at))}</p>
        <button type="button" onClick={() => setSelected(r.id)}>{uiText("查看內容與審核")}</button>
      </article>)}</div>
    </section>
    {selected && <FieldDialog title={uiText("審核私訊檢舉")} onClose={() => { setSelected(null); list.refresh(); }}>
      <Review key={selected} id={selected} onDone={() => { setSelected(null); setNotice("審核結果已保存。"); list.refresh(); }} />
    </FieldDialog>}
  </>;
}
function Review({ id, onDone }: { id: string; onDone: () => void }) {
  useUiLanguage();
  const detail = useFieldResource<ReportDetail>(`/admin/dm-reports/${encodeURIComponent(id)}/messages`);
  return <><ResourceState resource={detail} />{detail.data && <div className="reports-review">
    <section className="reports-summary">
      <div className="utility-toolbar"><h3>{detail.data.report.reporter}{uiText(" 檢舉 ")}{detail.data.report.reported}</h3><span className="photo-badge">{statusLabel(detail.data.report.status)}</span></div>
      <p className="reports-body">{detail.data.report.reason}</p>
      <p className="reports-meta">{uiText("檢舉時間")} · {uiText(fieldTime(detail.data.report.created_at))}</p>
      {detail.data.report.resolved_at && <p className="reports-meta">{uiText("處理時間")} · {uiText(fieldTime(detail.data.report.resolved_at))}</p>}
    </section>
    <section className="reports-messages" aria-label={uiText("相關對話")}>
      <h3>{uiText("相關對話")}</h3>
      {detail.data.messages.length === 0 ? <p className="reports-notice">{uiText("目前沒有可顯示的對話訊息。")}</p> :
        <ol className="reports-transcript">{detail.data.messages.map((m, i) => <li key={`${m.created_at}:${i}`}>
          <div className="reports-message-meta"><span>{m.sender}</span><time dateTime={m.created_at}>{uiText(fieldTime(m.created_at))}</time></div>
          <p className="reports-body">{m.content}</p>
        </li>)}</ol>}
    </section>
    <FieldForm guarded label={uiText("確認保存審核")} submit={async data => {
      const status = formText(data, "status");
      if (!Object.hasOwn(STATUSES, status)) throw new FormValidationError("請選擇審核結果。");
      await api.patch(`/admin/dm-reports/${encodeURIComponent(id)}`, { status, admin_note: formText(data, "admin_note") || null });
    }} onDone={onDone}>
      <FieldSelect name="status" label={uiText("審核結果")} options={uiOptions(STATUSES)} value={detail.data.report.status} />
      <label className="field-input">{uiText("管理備註（選填）")}<textarea name="admin_note" maxLength={2000} defaultValue={detail.data.report.admin_note ?? ""} rows={3} /></label>
      <p className="reports-warning">{uiText("判定「成立」會停用被檢舉人的私訊權；其他案件仍可能影響其權限，不能只靠這一筆保證恢復。")}</p>
      <label className="field-check"><input type="checkbox" required />{uiText("我已閱讀內容，確認保存這筆審核。")}</label>
    </FieldForm>
  </div>}</>;
}
