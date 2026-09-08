import { Link, useParams } from "react-router-dom";
import { useFieldResource } from "../fields/fieldData";
import { FieldPanel, ResourceState } from "../fields/shared";
import { coordinateView } from "../coordinates";
import { AvatarContent } from "../components/AvatarContent";
import type { ResidentList, ResidentWithAgent } from "../types";

export function ResidentIdentity({ resident: r }: { resident: ResidentWithAgent }) {
  const c = coordinateView(r);
  return <><div className="field-row"><span className="resident-avatar"><AvatarContent url={r.agent_avatar_url} emoji={r.agent_emoji || "✦"} name={r.agent_name || r.display_name} /></span><div><h2>{r.agent_name ?? "尚未領養室友"}</h2><p>居民：{r.display_name}</p></div></div><p>{c.label}</p><p>l {c.longitude} · {c.latitude}</p><small>距離你 {typeof r.distance_ly === "number" && Number.isFinite(r.distance_ly) ? `${r.distance_ly.toFixed(2)} ly` : "尚未定位"}{r.agent_brain ? ` · ${r.agent_brain}` : ""}</small></>;
}
export function ResidentDirectory() {
  const list = useFieldResource<ResidentList>("/users/residents");
  return <main className="field-app"><div className="field-shell"><header className="field-topbar"><h1>居民名錄</h1><Link to="/outside">← 出艙導航</Link></header><FieldPanel title="社區裡的星球" action={<button onClick={list.refresh}>更新名錄</button>}><ResourceState resource={list} empty={!list.data?.residents.length} /><div className="field-list">{list.data?.residents.map(r => <article className="field-item" key={r.id}><ResidentIdentity resident={r} />{r.agent_id && <Link className="field-button" to={`/resident/${encodeURIComponent(r.agent_id)}`}>查看名片</Link>}</article>)}</div></FieldPanel></div></main>;
}
export function ResidentCardPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const list = useFieldResource<ResidentList>("/users/residents");
  const resident = list.data?.residents.find(r => r.agent_id === agentId);
  // Public directory data only: no private agent endpoint, room scripts, or private DM code.
  return <main className="field-app"><div className="field-shell"><header className="field-topbar"><h1>居民名片</h1><Link to="/residents">← 返回名錄</Link></header><FieldPanel><ResourceState resource={list} />{resident ? <><ResidentIdentity resident={resident} /><p>想開始私訊，請先向對方索取私訊碼。</p><Link className="field-button" to="/ai-chat">前往私訊</Link></> : list.data && <p>找不到這位居民，可能已經離開社區。</p>}</FieldPanel></div></main>;
}
