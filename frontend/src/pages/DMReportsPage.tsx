import { useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client";
import { useAuth } from "../hooks/useAuth";
import { FieldDialog, FieldForm, FieldPanel, FieldSelect, FieldTabs, ResourceState } from "../fields/shared";
import { FormValidationError } from "../fields/formErrors";
import { fieldTime, formText, useFieldResource } from "../fields/fieldData";

interface Report { id: string; reporter: string; reported: string; reason: string; status: string; admin_note: string | null; created_at: string; resolved_at: string | null }
interface ReportDetail { report: Report; messages: { sender: string; content: string; action: string; created_at: string }[] }
const STATUSES = { pending: "待審核", upheld: "成立", dismissed: "不成立" };
export function DMReportsPage() {
  const { user } = useAuth();
  return <main className="field-app"><div className="field-shell"><header className="field-topbar"><h1>私訊檢舉審核</h1><Link to="/admin">← 系統儀表板</Link></header>{user?.role === "admin" ? <Reports /> : <p role="alert">需要管理員權限。</p>}</div></main>;
}
function Reports() {
  const [status, setStatus] = useState("pending"); const [selected, setSelected] = useState<string | null>(null); const [notice, setNotice] = useState("");
  const list = useFieldResource<{ reports: Report[] }>(`/admin/dm-reports?status=${status}`);
  return <><FieldTabs value={status} options={STATUSES} onChange={setStatus} /><p role="status">{notice}</p><FieldPanel title="檢舉清單" action={<button onClick={list.refresh}>更新清單</button>}><ResourceState resource={list} empty={!list.data?.reports.length} /><div className="field-list">{list.data?.reports.map(r => <article className="field-item" key={r.id}><h2>{r.reporter} 檢舉 {r.reported}</h2><p className="field-body">{r.reason}</p><small>{fieldTime(r.created_at)} · {STATUSES[r.status as keyof typeof STATUSES] ?? r.status}</small><button onClick={() => setSelected(r.id)}>查看內容與審核</button></article>)}</div></FieldPanel>
    {selected && <FieldDialog title="審核私訊檢舉" onClose={() => { setSelected(null); list.refresh(); }}><Review key={selected} id={selected} onDone={() => { setSelected(null); setNotice("審核結果已保存。"); list.refresh(); }} /></FieldDialog>}
  </>;
}
function Review({ id, onDone }: { id: string; onDone: () => void }) {
  const detail = useFieldResource<ReportDetail>(`/admin/dm-reports/${encodeURIComponent(id)}/messages`);
  return <><ResourceState resource={detail} />{detail.data && <div className="field-stack"><h3>{detail.data.report.reporter} 檢舉 {detail.data.report.reported}</h3><p>{detail.data.report.reason}</p><div className="field-chat">{detail.data.messages.map((m, i) => <article className="field-bubble" key={`${m.created_at}:${i}`}><small>{m.sender} · {fieldTime(m.created_at)}</small><p>{m.content}</p></article>)}</div><FieldForm guarded label="確認保存審核" submit={async data => {
    const status = formText(data, "status"); if (!(status in STATUSES)) throw new FormValidationError("請選擇審核結果。");
    await api.patch(`/admin/dm-reports/${encodeURIComponent(id)}`, { status, admin_note: formText(data, "admin_note") || null });
  }} onDone={onDone}><FieldSelect name="status" label="審核結果" options={STATUSES} value={detail.data.report.status} /><label className="field-input">管理備註（選填）<textarea name="admin_note" maxLength={2000} defaultValue={detail.data.report.admin_note ?? ""} rows={3} /></label><p>判定「成立」會停用被檢舉人的私訊權；其他案件仍可能影響其權限，不能只靠這一筆保證恢復。</p><label className="field-check"><input type="checkbox" required />我已閱讀內容，確認保存這筆審核。</label></FieldForm></div>}</>;
}
