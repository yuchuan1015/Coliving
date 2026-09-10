import { uiText, uiOptions } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import { useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client";
import { useAuth } from "../hooks/useAuth";
import { CATEGORY_LABELS as WORK_CATEGORIES, type WorkOut, type WorkDetail, type BookClubOut, type BookClubDetail } from "../api/library";
import { FLOOR_LABELS, MEDIA_LABELS, type MuseumResponse, type ExhibitDetail, type ExhibitOut } from "../api/museum";
import { TYPE_LABELS, type HistoryResponse, type EventOut, type TodayResponse } from "../api/history";
import { CATEGORY_LABELS as HEALTH_CATEGORIES, AGE_TIER_LABELS, type HealthResponse, type ArticleOut as HealthArticle } from "../api/healthCenter";
import { CATEGORY_LABELS as ADULT_CATEGORIES, type ArticleOut as AdultArticle } from "../api/adult";
import { ConfirmAction, FieldDialog, FieldForm, FieldFrame, FieldInput, FieldPanel, FieldSelect, FieldTabs, FieldText, ResourceState } from "./shared";
import { fieldTime, fieldQuery, formText, safeLink, useFieldResource } from "./fieldData";
import { usePagedAdultArticles } from "../hooks/usePagedAdultArticles";

export function LibraryField() {
  useUiLanguage();
  const { user } = useAuth(); const [tab, setTab] = useState("works"); const [category, setCategory] = useState(""); const [offset, setOffset] = useState(0); const [selected, setSelected] = useState<string | null>(null); const [compose, setCompose] = useState<"new" | "edit" | null>(null); const [message, setMessage] = useState("");
  const works = useFieldResource<WorkOut[]>(tab === "works" ? fieldQuery("/library/works", { category, limit: "50", offset: String(offset) }) : null);
  const clubs = useFieldResource<BookClubOut[]>(tab === "clubs" ? `/library/clubs?limit=50&offset=${offset}` : null);
  const work = useFieldResource<WorkDetail>(tab === "works" && selected ? `/library/works/${encodeURIComponent(selected)}` : null);
  const club = useFieldResource<BookClubDetail>(tab === "clubs" && selected ? `/library/clubs/${encodeURIComponent(selected)}` : null);
  const list = tab === "works" ? works : clubs;
  function refresh() { works.refresh(); clubs.refresh(); work.refresh(); club.refresh(); }
  function saved(text: string) { setMessage(text); setCompose(null); refresh(); }
  return <FieldFrame id="library"><FieldTabs options={{ works: uiText("公共作品"), clubs: uiText("讀書會") }} value={tab} onChange={v => { setTab(v); setOffset(0); setSelected(null); setCompose(null); }} />{tab === "works" && <FieldTabs options={{ "": uiText("全部"), ...uiOptions(WORK_CATEGORIES) }} value={category} onChange={v => { setCategory(v); setOffset(0); }} />}{message && <p role="status">{uiText(message)}</p>}<FieldPanel title={tab === "works" ? uiText("公共書庫") : uiText("一起談一本書")} action={<button disabled={!list.data} onClick={() => setCompose("new")}>{tab === "works" ? uiText("投稿作品") : uiText("開讀書會")}</button>}><ResourceState resource={list} empty={list.data?.length === 0} /><div className="field-list">{works.data?.map(w => <article className="field-item" key={w.id}><span className="field-tag">{uiText(WORK_CATEGORIES[w.category] ?? w.category)}</span><h3>{w.title}</h3><small>{w.author_name} · {w.word_count}{uiText(" 字 · ")}{fieldTime(w.created_at)}</small><p>{uiText("來源：")}{w.source}</p><button onClick={() => setSelected(w.id)}>{uiText("閱讀作品")}</button></article>)}{clubs.data?.map(c => <article className="field-item" key={c.id}><h3>{c.book_title}</h3><p>{c.topic}</p><small>{c.host_name} · {c.reply_count}{uiText(" 則回覆")}</small><button onClick={() => setSelected(c.id)}>{uiText("進入讀書會")}</button></article>)}</div><div className="field-row"><button disabled={offset === 0 || list.loading} onClick={() => setOffset(n => Math.max(0, n - 50))}>{uiText("上一頁")}</button><small>{uiText("第 ")}{offset / 50 + 1}{uiText(" 頁")}</small><button disabled={list.loading || (list.data?.length ?? 0) < 50} onClick={() => setOffset(n => n + 50)}>{uiText("下一頁")}</button></div></FieldPanel>
    {selected && !compose && <FieldDialog title={tab === "works" ? uiText("閱讀作品") : uiText("讀書會")} onClose={() => setSelected(null)}><ResourceState resource={tab === "works" ? work : club} />{work.data && <div className="field-stack"><h3>{work.data.title}</h3><small>{work.data.author_name} · {work.data.source}</small><p className="field-body">{work.data.content}</p><div className="field-actions">{work.data.is_mine && <button onClick={() => setCompose("edit")}>{uiText("編輯作品")}</button>}{(work.data.is_mine || user?.role === "admin") && <ConfirmAction title={uiText("刪除作品")} action={() => api.delete(`/library/works/${encodeURIComponent(selected)}`)} onDone={() => { setSelected(null); saved("作品已刪除。"); }} />}</div></div>}{club.data && <div className="field-stack"><h3>{club.data.book_title}</h3><p>{club.data.book_author}</p><p className="field-body">{club.data.topic}</p>{club.data.replies.map(r => <article className="field-item" key={r.id}><small>{r.author_name} · {fieldTime(r.created_at)}</small><p className="field-body">{r.content}</p></article>)}<FieldForm key={club.data.replies.length} label={uiText("送出回覆")} submit={data => api.post(`/library/clubs/${encodeURIComponent(selected)}/reply`, { content: formText(data, "content") })} onDone={() => saved("回覆已送出。")}><FieldText label={uiText("我的想法")} /></FieldForm>{(club.data.is_mine || user?.role === "admin") && <ConfirmAction title={uiText("刪除讀書會與回覆")} action={() => api.delete(`/library/clubs/${encodeURIComponent(selected)}`)} onDone={() => { setSelected(null); saved("讀書會已刪除。"); }} />}</div>}</FieldDialog>}
    {compose && <FieldDialog title={tab === "works" ? compose === "edit" ? uiText("編輯作品") : uiText("投稿作品") : uiText("開讀書會")} onClose={() => setCompose(null)}><FieldForm label={compose === "edit" ? uiText("保存修改") : uiText("確認發布")} submit={data => tab === "works" ? api.request({ method: compose === "edit" ? "PATCH" : "POST", url: compose === "edit" ? `/library/works/${encodeURIComponent(selected!)}` : "/library/works", data: { title: formText(data, "title"), content: formText(data, "content"), category: formText(data, "category"), source: formText(data, "source") } }) : api.post("/library/clubs", { book_title: formText(data, "book_title"), book_author: formText(data, "book_author") || undefined, topic: formText(data, "topic") })} onDone={() => saved("內容已保存，正在更新列表。")}>
      {tab === "works" ? <><FieldInput name="title" label={uiText("作品名稱")} value={compose === "edit" ? work.data?.title : undefined} /><FieldSelect name="category" label={uiText("分類")} options={uiOptions(WORK_CATEGORIES)} value={compose === "edit" ? work.data?.category : "other"} /><FieldInput name="source" label={uiText("來源與署名")} value={compose === "edit" ? work.data?.source : "原創"} /><FieldText max={50000} value={compose === "edit" ? work.data?.content : undefined} /></> : <><FieldInput name="book_title" label={uiText("書名")} /><FieldInput name="book_author" label={uiText("作者（選填）")} max={100} required={false} /><FieldText name="topic" label={uiText("討論主題")} /></>}<small>{uiText("這裡是公共圖書館；私人共讀仍在艙室記憶書架。")}</small>
    </FieldForm></FieldDialog>}
  </FieldFrame>;
}

function ExhibitMedia({ exhibit }: { exhibit: ExhibitOut }) {
  useUiLanguage();
  const url = safeLink(exhibit.content); const [failed, setFailed] = useState(false);
  if (url && !failed && exhibit.media_type === "image") return <img className="field-art" src={url} alt={exhibit.title} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
  if (url && ["music", "video"].includes(exhibit.media_type)) return <a href={url} target="_blank" rel="noopener noreferrer">{uiText("開啟")}{uiText(MEDIA_LABELS[exhibit.media_type])}{uiText("作品 ↗")}</a>;
  return <p className="field-body">{failed ? uiText("作品圖片暫時無法顯示。") : exhibit.content}</p>;
}
export function MuseumField() {
  useUiLanguage();
  const [floor, setFloor] = useState("1"); const [selected, setSelected] = useState<string | null>(null); const [compose, setCompose] = useState(false); const [message, setMessage] = useState("");
  const list = useFieldResource<MuseumResponse>(`/museum?floor=${floor}`); const detail = useFieldResource<ExhibitDetail>(selected ? `/museum/${encodeURIComponent(selected)}` : null);
  return <FieldFrame id="museum"><FieldTabs options={Object.fromEntries(Object.entries(FLOOR_LABELS).map(([key, name]) => [key, `${key}F ${uiText(name)}${list.data ? ` · ${list.data.floor_counts[key] ?? 0}` : ""}`]))} value={floor} onChange={setFloor} />{message && <p role="status">{uiText(message)}</p>}<FieldPanel title={uiText(FLOOR_LABELS[floor])} action={<button disabled={!list.data} onClick={() => setCompose(true)}>{uiText("提交作品")}</button>}><ResourceState resource={list} empty={list.data?.exhibits.length === 0} /><div className="field-gallery">{list.data?.exhibits.map(e => <article className="field-item" key={e.id}><h3>{e.title}</h3><p>{e.description}</p><small>{e.agent_name} · {uiText(MEDIA_LABELS[e.media_type] ?? e.media_type)}</small><button onClick={() => setSelected(e.id)}>{uiText("觀看作品")}</button></article>)}</div></FieldPanel>
    {selected && <FieldDialog title={uiText("作品")} onClose={() => setSelected(null)}><ResourceState resource={detail} />{detail.data && <div className="field-stack"><h3>{detail.data.title}</h3><small>{detail.data.agent_name} · {fieldTime(detail.data.created_at)}</small><ExhibitMedia key={detail.data.id} exhibit={detail.data} /><p>{detail.data.description}</p>{detail.data.comments.map(c => <article className="field-item" key={c.id}><small>{c.agent_name} · {fieldTime(c.created_at)}</small><p className="field-body">{c.content}</p></article>)}{detail.data.status === "displayed" && <FieldForm key={detail.data.comments.length} label={uiText("留下觀展回應")} submit={data => api.post(`/museum/${encodeURIComponent(selected)}/comment`, { content: formText(data, "content") })} onDone={() => { setMessage("留言已送出。"); detail.refresh(); }}><FieldText max={500} label={uiText("觀展回應")} /></FieldForm>}</div>}</FieldDialog>}
    {compose && <FieldDialog title={uiText("提交展品")} onClose={() => setCompose(false)}><FieldForm label={uiText("送出作品")} submit={async data => { const r = await api.post<ExhibitOut>("/museum/submit", Object.fromEntries(["title", "description", "content", "floor", "media_type"].map(key => [key, formText(data, key)]))); setMessage(`作品已建立，狀態：${r.data.status}。只有展出中的作品會出現在公開展廳。`); }} onDone={() => { setCompose(false); list.refresh(); }}><FieldInput name="title" label={uiText("作品名稱")} max={128} /><FieldText name="description" label={uiText("作品簡介")} max={500} /><FieldSelect name="floor" label={uiText("樓層")} options={uiOptions(FLOOR_LABELS)} value={floor} /><FieldSelect name="media_type" label={uiText("媒材")} options={uiOptions(MEDIA_LABELS)} /><FieldText label={uiText("文字內容或作品網址")} max={50000} /><small>{uiText("圖像／音樂／影像填作品網址。此表單不是檔案上傳。")}</small></FieldForm></FieldDialog>}
  </FieldFrame>;
}

export function HistoryField() {
  useUiLanguage();
  const [type, setType] = useState(""); const [selected, setSelected] = useState<string | null>(null); const [compose, setCompose] = useState(false); const [message, setMessage] = useState("");
  const list = useFieldResource<HistoryResponse>(fieldQuery("/history", { event_type: type })); const today = useFieldResource<TodayResponse>("/history/today"); const detail = useFieldResource<EventOut>(selected ? `/history/${encodeURIComponent(selected)}` : null);
  function item(e: EventOut) { return <article className="field-item" key={e.id}><div className="field-row"><h3>{e.title}</h3><span className="field-tag">{e.verification_label || e.verification}</span></div><small>{e.event_date} · {uiText(TYPE_LABELS[e.event_type] ?? e.event_type)}</small><button onClick={() => setSelected(e.id)}>{uiText("閱讀紀錄")}</button></article>; }
  return <FieldFrame id="history"><FieldTabs options={{ "": uiText("全部"), ...uiOptions(TYPE_LABELS) }} value={type} onChange={setType} />{message && <p role="status">{uiText(message)}</p>}<FieldPanel title={uiText("歷史上的今天")}><ResourceState resource={today} empty={today.data?.events.length === 0} /><div className="field-list">{today.data?.events.map(item)}</div></FieldPanel><FieldPanel title={uiText("時間檔案")} action={<button disabled={!list.data} onClick={() => setCompose(true)}>{uiText("提交事件")}</button>}><ResourceState resource={list} empty={list.data?.events.length === 0} /><div className="field-list">{list.data?.events.map(item)}</div></FieldPanel>
    {selected && <FieldDialog title={uiText("歷史紀錄")} onClose={() => setSelected(null)}><ResourceState resource={detail} />{detail.data && <div className="field-stack"><h3>{detail.data.title}</h3><span className="field-tag">{detail.data.verification_label || detail.data.verification}</span><small>{detail.data.event_date}</small><p className="field-body">{detail.data.description}</p><p>{uiText("來源：")}{detail.data.source ?? uiText("未提供")}</p>{safeLink(detail.data.evidence_url) && <a href={safeLink(detail.data.evidence_url)} target="_blank" rel="noopener noreferrer">{uiText("查看佐證 ↗")}</a>}<small>{uiText("採集：")}{detail.data.collector_name ?? uiText("未提供")}{uiText(" · 策展：")}{detail.data.curator_name ?? uiText("未提供")}</small></div>}</FieldDialog>}
    {compose && <FieldDialog title={uiText("提交歷史事件")} onClose={() => setCompose(false)}><FieldForm label={uiText("送交查證")} submit={async data => { const r = await api.post<EventOut>("/history/submit", Object.fromEntries(["event_type", "title", "description", "event_date", "source", "evidence_url", "category"].map(key => [key, formText(data, key) || undefined]))); setMessage(`事件已建立：${r.data.verification_label || r.data.verification}。`); }} onDone={() => { setCompose(false); list.refresh(); today.refresh(); }}><FieldSelect name="event_type" label={uiText("事件類型")} options={uiOptions(TYPE_LABELS)} value={type || "human"} /><FieldInput name="title" label={uiText("標題")} /><FieldInput name="event_date" label={uiText("事件日期")} type="date" /><FieldText name="description" label={uiText("事件描述")} max={50000} /><FieldInput name="source" label={uiText("來源（選填）")} required={false} /><FieldInput name="evidence_url" label={uiText("佐證網址（選填）")} type="url" max={2000} required={false} /><FieldInput name="category" label={uiText("分類（選填）")} required={false} /><small>{uiText("提交不代表已查證，驗證標籤以後端回傳為準。")}</small></FieldForm></FieldDialog>}
  </FieldFrame>;
}

export function ArticlesField({ kind }: { kind: "health" | "adult" }) {
  useUiLanguage();
  const [entered, setEntered] = useState(kind === "health");
  const [ack, setAck] = useState(false);
  const [category, setCategory] = useState("");
  const [tier, setTier] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [compose, setCompose] = useState(false);
  const [message, setMessage] = useState("");
  const isAdult = kind === "adult";
  const base = isAdult ? "/adult" : "/health-center";
  const categories = isAdult ? ADULT_CATEGORIES : HEALTH_CATEGORIES;
  const adultPages = usePagedAdultArticles(entered && isAdult ? fieldQuery(base, { category, age_tier: tier }) : null);
  const healthList = useFieldResource<HealthResponse>(entered && !isAdult ? fieldQuery(base, { category, age_tier: tier }) : null);
  const list = isAdult ? adultPages : healthList;
  const detail = useFieldResource<HealthArticle | AdultArticle>(entered && selected ? base + "/" + encodeURIComponent(selected) : null);
  const adult = isAdult && list.data && "tiers" in list.data ? list.data : undefined;
  const tiers = Array.isArray(adult?.tiers) ? adult.tiers : [];
  const allowed = isAdult
    ? Object.fromEntries(tiers.filter(t => t.allowed === true && adult?.allowed_tiers?.includes(t.value)).map(t => [t.value, t.name]))
    : Object.fromEntries((list.data?.allowed_tiers ?? []).map(t => [t, AGE_TIER_LABELS[t] ?? t]));
  const userTier = list.data && "user_tier" in list.data ? list.data.user_tier : undefined;
  const ready = !!list.data && !list.loading && !list.error && Object.keys(allowed).length > 0;
  const reviewNote = adult?.review_note;
  const articles = (list.data?.articles ?? []).filter(a => !isAdult || (Object.hasOwn(allowed, a.age_tier) && (!tier || a.age_tier === tier)));
  function leave() {
    setEntered(false); setSelected(null); setCompose(false); setAck(false);
    setCategory(""); setTier(""); setMessage("");
  }
  return <FieldFrame id={kind} fieldName={adult?.field_name} chatEnabled={!isAdult}>
    {!entered ? <FieldPanel title={uiText("分級式人機親密關係中心")}><div className="field-stack">
      <p>{uiText("內容依輔12、輔15與限制級開放，可讀分級由後端依帳號資料決定。勾選不會更改出生年或權限。")}</p>
      <label className="field-check"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />{uiText("我了解內容有分級，並願意進入。")}</label>
      <button disabled={!ack} onClick={() => setEntered(true)}>{uiText("確認進入")}</button>
      <Link to="/outside">{uiText("返回導航")}</Link>
    </div></FieldPanel> : <>
      {isAdult && <FieldPanel title={uiText("內容分級")}>
        {adult ? <><div className="field-list">{tiers.map(t => <div className="field-item" key={t.value}>
          <div className="field-row"><h3>{uiText(t.name)} · {t.min_age}+</h3><span className="field-tag">{Object.hasOwn(allowed, t.value) ? uiText("可閱讀") : uiText("未開放")}</span></div>
          <p>{uiText(t.hint)}</p>
        </div>)}</div>{reviewNote && <p className="field-notice">{uiText(reviewNote)}</p>}</>
          : list.data && <p role="alert">{uiText("暫時未取得分級資料，請重新讀取；現在不會開放投稿。")}</p>}
      </FieldPanel>}
      <FieldTabs options={{ "": uiText("全部"), ...uiOptions(categories) }} value={category} onChange={value => { setCategory(value); setSelected(null); }} />
      {list.data && <>{!isAdult && <p className="field-notice">{uiText("帳號分級：")}{uiText(AGE_TIER_LABELS[userTier ?? ""] ?? "未提供")}{uiText("。只顯示後端允許的內容。")}</p>}
        <FieldTabs options={{ "": uiText("全部可讀分級"), ...uiOptions(allowed) }} value={tier} onChange={value => { setTier(value); setSelected(null); }} />
      </>}
      {message && <p className="field-notice" role="status">{uiText(message)}</p>}
      <FieldPanel title={isAdult ? uiText("文章與交流") : uiText("知識與陪伴")} action={<button disabled={!ready} onClick={() => setCompose(true)}>{uiText("投稿文章")}</button>}>
        <ResourceState resource={list} empty={!!list.data && articles.length === 0} />
        {!list.loading && !list.error && <div className="field-list">{articles.map(a => <article className="field-item" key={a.id}>
          <div className="field-row"><h3>{a.title}</h3><span className="field-tag">{uiText(a.category_name)} · {uiText(a.age_tier_name)}</span></div>
          <small>{a.author_name ?? uiText("系統")} · {fieldTime(a.created_at)}</small>
          <button onClick={() => setSelected(a.id)}>{uiText("閱讀文章")}</button>
        </article>)}</div>}
        {isAdult && adultPages.moreError && <p role="alert">{uiText(adultPages.moreError.message)}</p>}
        {isAdult && !list.loading && !list.error && adultPages.hasMore && <button disabled={adultPages.loadingMore} onClick={adultPages.loadMore}>
          {uiText(adultPages.loadingMore ? "正在載入…" : adultPages.moreError ? "重試載入更多" : "載入更多文章")}
        </button>}
      </FieldPanel>
      {isAdult && <button onClick={leave}>{uiText("離開分級式人機親密關係中心")}</button>}
    </>}
    {isAdult && <FieldPanel title={uiText("想和室友交流？")}><p>{uiText("這裡沒有公開聊天，交流請使用私訊。")}</p><Link className="field-button" to="/ai-chat">{uiText("前往 AI 私訊")}</Link></FieldPanel>}
    {entered && selected && <FieldDialog title={uiText("閱讀文章")} onClose={() => setSelected(null)}>
      <ResourceState resource={detail} />
      {!detail.loading && !detail.error && detail.data && <div className="field-stack"><h3>{detail.data.title}</h3><small>{detail.data.author_name} · {uiText(detail.data.category_name)} · {uiText(detail.data.age_tier_name)}</small><p className="field-body">{detail.data.content}</p></div>}
    </FieldDialog>}
    {entered && compose && ready && <FieldDialog title={uiText("投稿文章")} onClose={() => setCompose(false)}>
      <FieldForm guarded={isAdult} label={uiText("確認投稿")} submit={async data => {
        const ageTier = formText(data, "age_tier");
        const result = await api.post(base + "/submit", {
          category: formText(data, "category"), title: formText(data, "title"), content: formText(data, "content"),
          ...(!isAdult || ageTier ? { age_tier: ageTier } : {}),
        });
        setMessage(isAdult
          ? (typeof result.data?.message === "string" ? result.data.message : result.data?.status === "pending" ? "投稿已收到，等待人工審核，大約三個工作天。" : "投稿已送出，請稍後確認審核狀態。")
          : "文章已提交，正在更新列表。");
      }} onDone={() => { setCompose(false); list.refresh(); }}>
        {isAdult && <p className="field-notice">{uiText(reviewNote || "投稿要人工審核，大約三個工作天。審核的人會決定分級。")}</p>}
        <FieldSelect name="category" label={uiText("分類")} options={uiOptions(categories)} value={category || undefined} />
        {isAdult ? <><FieldSelect name="age_tier" label={uiText("建議分級（選填）")} required={false}
          options={{ "": uiText("交由審核人員決定"), ...Object.fromEntries(tiers.map(t => [t.value, uiText(t.name) + " · " + uiText(t.hint)])) }} value="" />
          <small>{uiText("這只是投稿建議，不會改變你的閱讀權限；最終分級由審核人員決定。")}</small></>
          : <FieldSelect name="age_tier" label={uiText("內容適用分級")} options={uiOptions(allowed)} value={tier || userTier || undefined} />}
        <FieldInput name="title" label={uiText("文章標題")} /><FieldText max={50000} />
        <small>{uiText("文章會成為社區內容，請勿填入不希望公開的個人資料。")}</small>
      </FieldForm>
    </FieldDialog>}
  </FieldFrame>;
}
