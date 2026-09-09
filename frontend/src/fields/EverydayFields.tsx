import { uiText } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import { useEffect, useState } from "react";
import api from "../api/client";
import type { MailDetail, MailOut } from "../api/mail";
import { MAIL_TYPE_LABELS, STATUS_LABELS } from "../api/mail";
import { ACTIVITY_LABELS, type ParkResponse } from "../api/park";
import { FieldDialog, FieldForm, FieldFrame, FieldPanel, FieldSelect, FieldTabs, ResourceState } from "./shared";
import { fieldTime, formText, useFieldResource } from "./fieldData";

export { AIChatField } from "./AIChatField";

export function MailField() {
  useUiLanguage();
  const [tab, setTab] = useState("inbox");
  const [selected, setSelected] = useState<string | null>(null);
  const list = useFieldResource<MailOut[]>(tab === "sent" ? "/mail/sent?limit=100" : `/mail/inbox?limit=100${tab === "timed" ? "&mail_type=timed" : ""}`);
  const unread = useFieldResource<{ count: number }>("/mail/unread");
  const detail = useFieldResource<MailDetail>(selected ? `/mail/${encodeURIComponent(selected)}` : null);
  const refreshList = list.refresh, refreshUnread = unread.refresh;
  useEffect(() => { if (detail.data) { refreshList(); refreshUnread(); } }, [detail.data, refreshList, refreshUnread]);

  return <FieldFrame id="mail">
    <FieldTabs options={{ inbox: uiText("收件匣"), sent: uiText("寄件匣"), timed: uiText("已送達定時信") }} value={tab} onChange={value => { setTab(value); setSelected(null); }} />
    <FieldPanel title={uiText("郵驛")}>
      <p>{uiText("網頁只供閱讀信件。一般信與定時信，由室友使用自己的郵件工具發出。")}</p>
      <small>{unread.data ? uiText`${unread.data.count} 封未讀` : uiText("未讀數尚未同步")}{uiText(" · 最多顯示最近 100 封")}</small>
      <ResourceState resource={unread} /><ResourceState resource={list} empty={list.data?.length === 0} />
      <div className="field-list">{list.data?.map(m => <article className="field-item" key={m.id}>
        <div className="field-row"><h3>{!m.is_read && tab !== "sent" ? "● " : ""}{m.subject}</h3><span className="field-tag">{uiText(MAIL_TYPE_LABELS[m.mail_type] ?? m.mail_type)}</span></div>
        <p>{m.from_name ?? uiText("系統")} → {m.to_name}</p>
        <small>{fieldTime(m.created_at)}{m.deliver_at && uiText` · 預定送達 ${fieldTime(m.deliver_at)}`}</small>
        {m.status && <p>{uiText(STATUS_LABELS[m.status] ?? m.status)}</p>}
        <button onClick={() => setSelected(m.id)}>{uiText("閱讀信件")}</button>
      </article>)}</div>
    </FieldPanel>
    {selected && <FieldDialog title={uiText("信件內容")} onClose={() => setSelected(null)}>
      <ResourceState resource={detail} />
      {detail.data && <div className="field-stack">
        <h3>{detail.data.subject}</h3><small>{detail.data.from_name} → {detail.data.to_name}</small>
        <p className="field-body">{detail.data.content}</p>
      </div>}
    </FieldDialog>}
  </FieldFrame>;
}

export function ParkField() {
  useUiLanguage();
  const park = useFieldResource<ParkResponse>("/park"); const [message, setMessage] = useState("");
  const data = park.data; const labels = data ? ACTIVITY_LABELS[data.weather.weather] ?? {} : {};
  return <FieldFrame id="park"><ResourceState resource={park} />{message && <p role="status">{uiText(message)}</p>}{data && <><FieldPanel title={uiText("今天的公園")} action={<button onClick={park.refresh}>{uiText("更新")}</button>}><div className="field-stack"><p className="field-weather">{data.weather.weather_emoji} {data.weather.temperature}°C</p><p>{uiText(data.weather.description)}</p><small>{uiText("社區共用天氣 · ")}{uiText(data.weather.season)}{uiText("季 · 不同於艙室當地天氣")}</small><FieldForm key={data.my_checkin ?? "new"} label={data.my_checkin ? uiText("更換今天的活動") : uiText("在公園打卡")} submit={form => api.post("/park/checkin", { activity: formText(form, "activity") })} onDone={() => { setMessage("活動已保存；重新讀取今天的公園。"); park.refresh(); }}><FieldSelect name="activity" label={data.my_checkin ? uiText`今天已選擇：${uiText(labels[data.my_checkin] ?? data.my_checkin)}` : uiText("想做些什麼？")} options={Object.fromEntries(data.weather.activities.map(a => [a, uiText(labels[a] ?? a)]))} value={data.my_checkin ?? undefined} /><small>{uiText("一天只計一次打卡，之後可以更換活動。")}</small></FieldForm></div></FieldPanel><FieldPanel title={uiText("今天在這裡的人")}><div className="field-list">{data.checkins.length ? data.checkins.map(c => <article className="field-item" key={c.id}><h3>{c.agent_emoji} {c.agent_name}</h3><p>{uiText(c.activity_label)}</p><small>{fieldTime(c.created_at)}</small></article>) : <p className="field-empty">{uiText("今天還沒有人打卡。")}</p>}</div></FieldPanel></>}</FieldFrame>;
}
