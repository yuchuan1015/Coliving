import { useEffect, useState } from "react";
import api from "../api/client";
import type { ResidentList } from "../types";
import { useAuth } from "../hooks/useAuth";
import type { MailDetail, MailOut } from "../api/mail";
import { MAIL_TYPE_LABELS, STATUS_LABELS } from "../api/mail";
import { ACTIVITY_LABELS, type ParkResponse } from "../api/park";
import { ConfirmAction, FieldDialog, FieldForm, FieldFrame, FieldInput, FieldPanel, FieldSelect, FieldTabs, FieldText, ResourceState } from "./shared";
import { fieldTime, formText, useFieldResource } from "./fieldData";

export { AIChatField } from "./AIChatField";

export function MailField() {
  const { user } = useAuth(); const [tab, setTab] = useState("inbox"); const [compose, setCompose] = useState(false); const [kind, setKind] = useState("letter"); const [selected, setSelected] = useState<string | null>(null); const [message, setMessage] = useState("");
  const list = useFieldResource<MailOut[]>(tab === "sent" ? "/mail/sent?limit=100" : `/mail/inbox?limit=100${tab === "physical" ? "&mail_type=physical" : tab === "timed" ? "&mail_type=timed" : ""}`);
  const unread = useFieldResource<{ count: number }>("/mail/unread");
  const residents = useFieldResource<ResidentList>(compose && kind !== "physical" ? "/users/residents" : null);
  const detail = useFieldResource<MailDetail>(selected ? `/mail/${encodeURIComponent(selected)}` : null);
  const refreshList = list.refresh, refreshUnread = unread.refresh;
  useEffect(() => { if (detail.data) { refreshList(); refreshUnread(); } }, [detail.data, refreshList, refreshUnread]);
  const recipients = Object.fromEntries((residents.data?.residents ?? []).filter(r => r.agent_id && (kind === "timed" || r.id !== user?.id)).map(r => [r.agent_id!, r.agent_name ?? r.display_name]));
  function changed() { setSelected(null); list.refresh(); unread.refresh(); }
  async function send(data: FormData) {
    const subject = formText(data, "subject"), content = formText(data, "content");
    let payload: Record<string, unknown> = { subject, content };
    if (kind !== "physical") payload.to_agent_id = formText(data, "to_agent_id");
    if (kind === "letter") payload.is_anonymous = data.get("anonymous") === "on";
    if (kind === "timed") {
      const wallTime = formText(data, "deliver_at");
      const date = new Date(`${wallTime.length === 16 ? wallTime + ":00" : wallTime}+08:00`);
      if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) throw new Error("請選擇未來的台北時間。");
      // Send UTC: backend accepts both explicit offsets and UTC.
      payload = { ...payload, deliver_at: date.toISOString() };
    }
    const result = await api.post<MailOut>(`/mail/${kind}`, payload);
    setMessage(kind === "timed" ? `定時信已建立（${result.data.id}），預計 ${fieldTime(result.data.deliver_at)} 送達。可到寄件匣查看預定投遞時間。` : kind === "physical" ? "實體寄送訂單已建立；後續狀態以管理員更新為準。" : `信件已交給郵驛，預計 ${fieldTime(result.data.deliver_at)} 送達。`);
  }
  return <FieldFrame id="mail"><FieldTabs options={{ inbox: "收件匣", sent: "寄件匣", timed: "已送達定時信", physical: "實體寄送" }} value={tab} onChange={value => { setTab(value); setSelected(null); }} />{message && <p role="status">{message}</p>}<FieldPanel title="郵驛" action={tab === "sent" ? <button onClick={() => setCompose(true)}>寫一封信</button> : undefined}><small>{unread.data ? `${unread.data.count} 封未讀` : "未讀數尚未同步"} · 最多顯示最近 100 封</small><ResourceState resource={unread} /><ResourceState resource={list} empty={list.data?.length === 0} /><div className="field-list">{list.data?.map(m => <article className="field-item" key={m.id}><div className="field-row"><h3>{!m.is_read && tab !== "sent" ? "● " : ""}{m.subject}</h3><span className="field-tag">{MAIL_TYPE_LABELS[m.mail_type] ?? m.mail_type}</span></div><p>{m.from_name ?? "系統"} → {m.to_name}</p><small>{fieldTime(m.created_at)}{m.deliver_at && ` · 送達 ${fieldTime(m.deliver_at)}`}</small>{m.status && <p>{STATUS_LABELS[m.status] ?? m.status}</p>}<button onClick={() => setSelected(m.id)}>閱讀信件</button>{(tab !== "sent" || user?.role === "admin") && <ConfirmAction title="刪除這封信" label="確認刪除" action={() => api.delete(`/mail/${encodeURIComponent(m.id)}`)} onDone={() => { setMessage("信件已刪除。"); changed(); }} />}</article>)}</div></FieldPanel>
    {selected && <FieldDialog title="信件內容" onClose={() => setSelected(null)}><ResourceState resource={detail} />{detail.data && <div className="field-stack"><h3>{detail.data.subject}</h3><small>{detail.data.from_name} → {detail.data.to_name}</small><p className="field-body">{detail.data.content}</p>{detail.data.mail_type === "physical" && user?.role === "admin" && <FieldForm label="更新寄送狀態" submit={data => api.patch(`/mail/${encodeURIComponent(selected)}/status`, null, { params: { status: formText(data, "status") } })} onDone={() => { setMessage("寄送狀態已更新。"); changed(); }}><FieldSelect name="status" label="狀態" options={STATUS_LABELS} value={detail.data.status ?? "pending"} /></FieldForm>}</div>}</FieldDialog>}
    {compose && <FieldDialog title="寄送信件" onClose={() => setCompose(false)}><FieldTabs options={{ letter: "一般信件", timed: "定時投遞", physical: "實體寄送" }} value={kind} onChange={setKind} /><ResourceState resource={residents} /><FieldForm key={kind} label="確認寄送" submit={send} onDone={() => { setCompose(false); if (kind !== "physical") setTab("sent"); list.refresh(); unread.refresh(); }}><FieldInput name="subject" label="主旨" max={100} />{kind !== "physical" && <FieldSelect name="to_agent_id" label="收件室友" options={{ "": "請選擇收件人", ...recipients }} />}<FieldText />{kind === "letter" && <><label className="field-check"><input name="anonymous" type="checkbox" />匿名寄送</label><small>一般信件約 12～48 小時送達，不是即時訊息。</small></>}{kind === "timed" && <><FieldInput name="deliver_at" label="送達時間（Asia/Taipei）" type="datetime-local" /><small>可在寄件匣追蹤；收件人送達後看到系統名義。修正前建立的舊定時信可能不在寄件匣。</small></>}{kind === "physical" && <small>建立實體寄送需求，不代表已付款或已完成物流寄送。請勿在此填寫不必要的敏感資料。</small>}</FieldForm></FieldDialog>}
  </FieldFrame>;
}

export function ParkField() {
  const park = useFieldResource<ParkResponse>("/park"); const [message, setMessage] = useState("");
  const data = park.data; const labels = data ? ACTIVITY_LABELS[data.weather.weather] ?? {} : {};
  return <FieldFrame id="park"><ResourceState resource={park} />{message && <p role="status">{message}</p>}{data && <><FieldPanel title="今天的公園" action={<button onClick={park.refresh}>更新</button>}><div className="field-stack"><p className="field-weather">{data.weather.weather_emoji} {data.weather.temperature}°C</p><p>{data.weather.description}</p><small>社區共用天氣 · {data.weather.season}季 · 不同於艙室當地天氣</small><FieldForm key={data.my_checkin ?? "new"} label={data.my_checkin ? "更換今天的活動" : "在公園打卡"} submit={form => api.post("/park/checkin", { activity: formText(form, "activity") })} onDone={() => { setMessage("活動已保存；重新讀取今天的公園。"); park.refresh(); }}><FieldSelect name="activity" label={data.my_checkin ? `今天已選擇：${labels[data.my_checkin] ?? data.my_checkin}` : "想做些什麼？"} options={Object.fromEntries(data.weather.activities.map(a => [a, labels[a] ?? a]))} value={data.my_checkin ?? undefined} /><small>一天只計一次打卡，之後可以更換活動。</small></FieldForm></div></FieldPanel><FieldPanel title="今天在這裡的人"><div className="field-list">{data.checkins.length ? data.checkins.map(c => <article className="field-item" key={c.id}><h3>{c.agent_emoji} {c.agent_name}</h3><p>{c.activity_label}</p><small>{fieldTime(c.created_at)}</small></article>) : <p className="field-empty">今天還沒有人打卡。</p>}</div></FieldPanel></>}</FieldFrame>;
}
