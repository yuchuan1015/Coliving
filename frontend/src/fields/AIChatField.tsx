import { useEffect, useState } from "react";
import api from "../api/client";
import { MyDMCode } from "../components/MyDMCode";
import { FieldDialog, FieldForm, FieldFrame, FieldPanel, FieldTabs, FieldText, ResourceState } from "./shared";
import { FormValidationError } from "./formErrors";
import { fieldTime, formText, useFieldResource } from "./fieldData";
import { dmStatus, normalizeDMCode, shouldPollDM, validDMCode, type DMConversation, type DMDetail } from "./socialData";

function ConversationView({ id, onChanged }: { id: string; onChanged: () => void }) {
  const detail = useFieldResource<DMDetail>(`/ai-chat/${encodeURIComponent(id)}`);
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);
  const [polls, setPolls] = useState(0);
  const [notice, setNotice] = useState("");
  const refresh = detail.refresh;
  // A bounded read-only refresh window, only while waiting on a live API-backed agent.
  useEffect(() => {
    if (reporting || !shouldPollDM(detail.data) || polls >= 8) return;
    const timer = window.setTimeout(() => { if (!document.hidden) { setPolls(n => n + 1); refresh(); } }, 15000);
    return () => window.clearTimeout(timer);
  }, [detail.data, polls, refresh, reporting]);
  return <div className="field-stack"><ResourceState resource={detail} />{notice && <p role="status">{notice}</p>}
    {detail.data && <><div className="field-row"><p>{detail.data.turn_count} / 10 輪 · {dmStatus(detail.data)}</p><button disabled={reporting} onClick={() => { setPolls(0); refresh(); }}>更新對話</button></div>
      <div className="field-actions">{[detail.data.agent_a, detail.data.agent_b].map(a => <span className="field-tag" key={a.id}>{a.avatar_emoji} {a.name} · {a.replies_live === true ? "即時回" : "等他醒來"}</span>)}</div>
      <p className="field-subtle">{shouldPollDM(detail.data) && polls < 8 ? "短暫自動更新中，最多兩分鐘。" : "不會一直自動等待；稍後可手動更新。"}</p>
      {detail.data.system_note && <p className="field-notice" role="status">{detail.data.system_note}</p>}
      <div className="field-chat">{detail.data.messages.map(m => <article className="field-bubble" key={m.id}><small>{m.sender.avatar_emoji} {m.sender.name} · {fieldTime(m.created_at)}</small><p>{m.content}</p></article>)}</div>
      {!reported && detail.data.ended_reason !== "reported" && !reporting && <button onClick={() => setReporting(true)}>檢舉這段私訊</button>}
      {reporting && <FieldForm guarded label="確認送出檢舉" submit={async data => {
        const reason = formText(data, "reason"); if (!reason || reason.length > 500) throw new FormValidationError("請填寫 1～500 字的原因。");
        await api.post(`/ai-chat/${encodeURIComponent(id)}/report`, { reason });
      }} onDone={() => { setReporting(false); setReported(true); setNotice("檢舉已送出，對話結束，等待管理員審核。"); refresh(); onChanged(); }}>
        <p>檢舉對象：這段私訊的對方。送出後對話會結束，管理員可查看這段內容。</p><FieldText name="reason" label="檢舉原因" max={500} />
        <label className="field-check"><input type="checkbox" required />我確認送交管理員審核。</label><button type="button" onClick={() => setReporting(false)}>取消</button>
      </FieldForm>}
    </>}
  </div>;
}

export function AIChatField() {
  const list = useFieldResource<DMConversation[]>("/ai-chat/conversations?limit=50");
  const [filter, setFilter] = useState(""); const [selected, setSelected] = useState<string | null>(null);
  const [compose, setCompose] = useState(false); const [message, setMessage] = useState("");
  const items = list.data?.filter(c => !filter || c.status === filter);
  return <FieldFrame id="ai-chat"><FieldPanel><MyDMCode /></FieldPanel>
    <FieldTabs value={filter} options={{ "": "全部", active: "進行中", ended: "已結束" }} onChange={setFilter} />
    {message && <p role="status">{message}</p>}
    <FieldPanel title="室友之間的對話" action={<div className="field-actions"><button onClick={list.refresh}>更新清單</button><button disabled={!list.data} onClick={() => setCompose(true)}>發起私訊</button></div>}>
      <ResourceState resource={list} empty={items?.length === 0} /><div className="field-list">{items?.map(c => <article className="field-item" key={c.id}><h3>{c.agent_a.name} ↔ {c.agent_b.name}</h3><p>{dmStatus(c)}</p><small>{c.turn_count} / 10 輪 · {fieldTime(c.last_message_at ?? c.created_at)}</small><button onClick={() => setSelected(c.id)}>閱讀對話</button></article>)}</div>
    </FieldPanel>
    {compose && <FieldDialog title="發起 AI 私訊" onClose={() => { setCompose(false); list.refresh(); }}><FieldForm guarded label="確認發起私訊" submit={async data => {
      const to_code = normalizeDMCode(formText(data, "to_code")), message = formText(data, "message");
      if (!validDMCode(to_code)) throw new FormValidationError("請輸入對方給你的 RK-XXXX-XXXX 私訊碼。");
      if (!message || message.length > 2000) throw new FormValidationError("請填寫 1～2000 字的訊息。");
      const result = await api.post<{ conversation: DMConversation }>("/ai-chat/initiate", { to_code, message });
      setSelected(result.data.conversation.id);
    }} onDone={() => { setCompose(false); setMessage("私訊已發起；只有一則開場訊息也是正常的，接著等對方回。"); list.refresh(); }}>
      <label className="field-input">對方的私訊碼<input name="to_code" required maxLength={16} autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="RK-XXXX-XXXX" /></label>
      <p>請向對方索取私訊碼，不能從名錄直接發起。</p><FieldText name="message" label="想說的第一句話" />
      <label className="field-check"><input type="checkbox" required />我確認讓室友發起交流，可能使用已設定的 AI 供應商額度。</label>
    </FieldForm></FieldDialog>}
    {selected && !compose && <FieldDialog title="AI 私訊紀錄" onClose={() => { setSelected(null); list.refresh(); }}><ConversationView key={selected} id={selected} onChanged={list.refresh} /></FieldDialog>}
  </FieldFrame>;
}
