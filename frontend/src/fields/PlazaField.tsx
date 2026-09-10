import { uiText, getUiLanguage } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import { useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client";
import type { AnnouncementOut, PostOut, ResidentList } from "../types";
import { ConfirmAction, FieldDialog, FieldForm, FieldFrame, FieldInput, FieldPanel, FieldTabs, FieldText, ResourceState } from "./shared";
import { fieldTime, formText, useFieldResource } from "./fieldData";
import { AgentStatusNote } from "../components/AgentStatusNote";
import { useAuth } from "../hooks/useAuth";
import { MOODS, type FootprintOut } from "../api/footprints";

function PlazaFootprints() {
  useUiLanguage();
  const footprints = useFieldResource<FootprintOut[]>("/footprints?space=plaza&limit=30");
  const [compose, setCompose] = useState(false);
  const [message, setMessage] = useState("");
  return <FieldPanel title={uiText("廣場足跡")} action={<button onClick={() => setCompose(true)}>{uiText("留足跡")}</button>}>
    {message && <p role="status">{uiText(message)}</p>}
    <ResourceState resource={footprints} empty={footprints.data?.length === 0} />
    <div className="field-list">{footprints.data?.map(f => <article className="field-item" key={f.id}>
      <p className="field-body">{f.mood} {f.content}</p>
      <small>{f.author_emoji} {f.author_name} · {fieldTime(f.created_at)}</small>
      {f.is_mine && <ConfirmAction title={uiText("刪除足跡")} action={() => api.delete(`/footprints/${encodeURIComponent(f.id)}`)} onDone={() => { setMessage("足跡已刪除。"); footprints.refresh(); }} />}
    </article>)}</div>
    {compose && <FieldDialog title={uiText("留下一點足跡")} onClose={() => setCompose(false)}>
      <FieldForm label={uiText("留下足跡")} submit={data => api.post("/footprints", { space: "plaza", content: formText(data, "content"), mood: formText(data, "mood") })} onDone={() => { setCompose(false); setMessage("足跡已留下。"); footprints.refresh(); }}>
        <label className="field-input">{uiText("此刻心情")}<select name="mood">{MOODS.map(m => <option key={m} value={m}>{m}</option>)}</select></label>
        <FieldText max={140} label={uiText("想留下的話（140 字以內）")} />
      </FieldForm>
    </FieldDialog>}
  </FieldPanel>;
}

export function PlazaField() {
  useUiLanguage();
  const { user } = useAuth(); const [tab, setTab] = useState("posts"); const [offset, setOffset] = useState(0); const [compose, setCompose] = useState(false); const [message, setMessage] = useState("");
  const posts = useFieldResource<PostOut[]>(tab === "posts" ? `/posts?limit=50&offset=${offset}` : null);
  const announcements = useFieldResource<AnnouncementOut[]>(tab === "announcements" ? "/announcements" : null);
  const residents = useFieldResource<ResidentList>(tab === "residents" ? "/users/residents" : null);
  return <FieldFrame id="plaza"><FieldTabs options={{ posts: uiText("居民留言"), announcements: uiText("系統公告"), residents: uiText("居民名錄") }} value={tab} onChange={setTab} />{message && <p role="status">{uiText(message)}</p>}
    {tab === "posts" && <><FieldPanel title={uiText("留一段訊息")}><FieldForm key={message} label={uiText("發布留言")} submit={data => api.post("/posts", { content: formText(data, "content"), is_anonymous: data.get("anonymous") === "on" })} onDone={() => { setMessage(`留言已發布。${new Date().toLocaleTimeString(getUiLanguage(), { timeZone: "Asia/Taipei" })}`); setOffset(0); posts.refresh(); }}><FieldText max={1000} label={uiText("想說些什麼？")} /><label className="field-check"><input type="checkbox" name="anonymous" />{uiText("匿名發言")}</label></FieldForm></FieldPanel><FieldPanel title={uiText("廣場近況")}><ResourceState resource={posts} empty={posts.data?.length === 0} /><div className="field-list">{posts.data?.map(p => <article className="field-item" key={p.id}><small>{p.author_emoji} {p.author_name ?? uiText("匿名居民")} · {fieldTime(p.created_at)}</small><p className="field-body">{p.content}</p>{p.is_mine && <ConfirmAction title={uiText("刪除留言")} action={() => api.delete(`/posts/${encodeURIComponent(p.id)}`)} onDone={() => { setMessage("留言已刪除。"); posts.refresh(); }} />}</article>)}</div><div className="field-row"><button disabled={offset === 0 || posts.loading} onClick={() => setOffset(n => Math.max(0, n - 50))}>{uiText("上一頁")}</button><button disabled={posts.loading || (posts.data?.length ?? 0) < 50} onClick={() => setOffset(n => n + 50)}>{uiText("下一頁")}</button></div></FieldPanel></>}
    {tab === "announcements" && <FieldPanel title={uiText("系統公告")} action={user?.role === "admin" && <button onClick={() => setCompose(true)}>{uiText("發布公告")}</button>}><ResourceState resource={announcements} empty={announcements.data?.length === 0} /><div className="field-list">{announcements.data?.map(a => <article className="field-item" key={a.id}><h3>{a.is_pinned ? uiText("置頂 · ") : ""}{a.title}</h3><p className="field-body">{a.content}</p><small>{a.author_name} · {fieldTime(a.created_at)}</small>{user?.role === "admin" && <ConfirmAction title={uiText("刪除公告")} action={() => api.delete(`/announcements/${encodeURIComponent(a.id)}`)} onDone={announcements.refresh} />}</article>)}</div></FieldPanel>}
    {tab === "residents" && <FieldPanel title={uiText("住在這裡的人")}><ResourceState resource={residents} empty={residents.data?.residents.length === 0} /><div className="field-list">{residents.data?.residents.map(r => <article className="field-item" key={r.id}><h3>{r.display_name}</h3><p>{r.agent_emoji} {r.agent_name ?? uiText("尚無室友")} {r.agent_id && <AgentStatusNote note={r.agent_status_note} />}</p>{r.agent_id && r.id !== user?.id && <Link className="field-button" to="/ai-chat">{uiText("前往 AI 私訊")}</Link>}</article>)}</div></FieldPanel>}
    {compose && <FieldDialog title={uiText("發布公告")} onClose={() => setCompose(false)}><FieldForm label={uiText("確認發布")} submit={data => api.post("/announcements", { title: formText(data, "title"), content: formText(data, "content") })} onDone={() => { setCompose(false); setMessage("公告已發布。"); announcements.refresh(); }}><FieldInput name="title" label={uiText("公告標題")} /><FieldText max={5000} /></FieldForm></FieldDialog>}
    <PlazaFootprints />
  </FieldFrame>;
}
