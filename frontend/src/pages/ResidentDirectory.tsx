import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useFieldResource } from "../fields/fieldData";
import { FieldPanel, ResourceState } from "../fields/shared";
import { coordinateView } from "../coordinates";
import { AvatarContent } from "../components/AvatarContent";
import type { ResidentList, ResidentWithAgent } from "../types";

export function PublicDMCode({ code, name }: { code: string; name: string }) {
  const [feedback, setFeedback] = useState("");
  const [manual, setManual] = useState(false);
  const [copying, setCopying] = useState(false);
  const copyingRef = useRef(false);
  async function copy() {
    if (copyingRef.current) return;
    copyingRef.current = true;
    setCopying(true);
    setFeedback("");
    try {
      await navigator.clipboard.writeText(code);
      setFeedback("私訊碼已複製。");
      setManual(false);
    } catch {
      setManual(true);
      setFeedback("無法自動複製，請長按下方私訊碼複製。");
    } finally {
      copyingRef.current = false;
      setCopying(false);
    }
  }
  return <section className="resident-dm-code" aria-label={`${name}的公開私訊碼`}>
    <small>公開私訊碼</small>
    <div className="field-actions"><code>{code}</code><button type="button" onClick={copy} disabled={copying} aria-label={`複製${name}的私訊碼`}>{copying ? "正在複製…" : "複製私訊碼"}</button></div>
    {manual && <label>手動複製私訊碼<input value={code} readOnly onFocus={event => event.currentTarget.select()} /></label>}
    <small role="status">{feedback}</small>
  </section>;
}

export function ResidentIdentity({ resident: r }: { resident: ResidentWithAgent }) {
  const c = coordinateView(r);
  const code = typeof r.agent_dm_code === "string" && r.agent_dm_code.trim() ? r.agent_dm_code : null;
  return <><div className="field-row"><span className="resident-avatar"><AvatarContent url={r.agent_avatar_url} emoji={r.agent_emoji || "✦"} name={r.agent_name || r.display_name} /></span><div><h2>{r.agent_name ?? "尚未領養室友"}</h2><p>居民：{r.display_name}</p></div></div><p>{c.label}</p><p>l {c.longitude} · {c.latitude}</p><small>距離你 {typeof r.distance_ly === "number" && Number.isFinite(r.distance_ly) ? `${r.distance_ly.toFixed(2)} ly` : "尚未定位"}{r.agent_brain ? ` · ${r.agent_brain}` : ""}</small>{r.agent_id && code && <PublicDMCode key={code} code={code} name={r.agent_name || r.display_name} />}</>;
}
export function ResidentDirectory() {
  const list = useFieldResource<ResidentList>("/users/residents");
  return <main className="field-app"><div className="field-shell"><header className="field-topbar"><h1>居民名錄</h1><Link to="/outside">← 出艙導航</Link></header><FieldPanel title="社區裡的星球" action={<button onClick={list.refresh}>更新名錄</button>}><ResourceState resource={list} empty={!list.data?.residents.length} /><div className="field-list">{list.data?.residents.map(r => <article className="field-item" key={r.id}><ResidentIdentity resident={r} />{r.agent_id && <Link className="field-button" to={`/resident/${encodeURIComponent(r.agent_id)}`}>查看名片</Link>}</article>)}</div></FieldPanel></div></main>;
}
export function ResidentCardPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const list = useFieldResource<ResidentList>("/users/residents");
  const resident = list.data?.residents.find(r => r.agent_id === agentId);
  // Only show the code explicitly included by the directory API, never private agent data.
  return <main className="field-app"><div className="field-shell"><header className="field-topbar"><h1>居民名片</h1><Link to="/residents">← 返回名錄</Link></header><FieldPanel><ResourceState resource={list} />{resident ? <><ResidentIdentity resident={resident} /><p>已有私訊碼？前往私訊輸入即可。</p><Link className="field-button" to="/ai-chat">前往私訊</Link></> : list.data && <p>找不到這位居民，可能已經離開社區。</p>}</FieldPanel></div></main>;
}
