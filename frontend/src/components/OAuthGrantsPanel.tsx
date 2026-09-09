import { uiText } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import { useEffect, useRef, useState } from "react";
import { listOAuthGrants, revokeOAuthGrant, type OAuthGrant } from "../api/oauth";
import { oauthError, oauthTime } from "../oauth-navigation";
import "../mcp-keys.css";

export function OAuthGrantsPanel() {
  useUiLanguage();
  const [grants, setGrants] = useState<OAuthGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const writeLock = useRef(false);
  const alive = useRef(true);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    listOAuthGrants(controller.signal).then(rows => {
      if (!controller.signal.aborted) { setGrants(rows); setUncertain(false); }
    }).catch(err => {
      if (!controller.signal.aborted) setError(oauthError(err, "暫時讀不到已授權的 app，請更新清單。"));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);

  async function revoke(grant: OAuthGrant) {
    if (writeLock.current || loading || uncertain || grant.revoked_at || confirmId !== grant.id) return;
    writeLock.current = true; setPending(grant.id); setError(""); setNotice("");
    try {
      await revokeOAuthGrant(grant.id);
      if (!alive.current) return;
      setGrants(rows => rows.map(row => row.id === grant.id ? { ...row, revoked_at: new Date().toISOString() } : row));
      setConfirmId(null);
      setNotice(`已撤銷「${grant.client_name || "未命名 app"}」的這筆授權。`);
    } catch (err) {
      if (!alive.current) return;
      setUncertain(true); setConfirmId(null);
      setError(oauthError(err, "未能確認撤銷結果，請先更新清單，再決定是否重試。"));
    } finally {
      writeLock.current = false;
      if (alive.current) setPending(null);
    }
  }

  return <section className="mcp-keys oauth-grants" aria-labelledby="oauth-grants-title">
    <div className="mcp-key-heading"><div><span className="mcp-eyebrow">AUTHORIZED APPS</span><h2 id="oauth-grants-title">{uiText("已授權的 app")}</h2></div>
      <button type="button" disabled={loading || !!pending} onClick={() => {
        setLoading(true); setGrants([]); setError(""); setNotice(""); setConfirmId(null); setRevision(n => n + 1);
      }}>{uiText("更新授權清單")}</button>
    </div>
    <p className="mcp-key-note">{uiText("這裡管理 OAuth 授權。撤銷只影響這筆授權，不會作廢你的 CLI 鑰匙。")}</p>
    {loading && <p role="status">{uiText("正在讀取授權…")}</p>}
    {error && <p role="alert">{uiText(error)}</p>}
    {notice && <p role="status">{uiText(notice)}</p>}
    {!loading && !error && grants.length === 0 && <p>{uiText("還沒有已授權的 app。從上方複製網址，完成登入與同意後，就會出現在這裡。")}</p>}
    {!loading && <div className="mcp-key-list">{grants.map(grant => <article className="mcp-key-row" key={grant.id}>
      <h3>{grant.client_name || uiText("未命名 app")}<span className="mcp-grant-status">{grant.revoked_at ? uiText("已撤銷") : uiText("已授權")}</span></h3>
      <dl className="mcp-key-dates"><div><dt>{uiText("建立時間")}</dt><dd>{oauthTime(grant.created_at)}</dd></div><div><dt>{uiText("最後使用")}</dt><dd>{oauthTime(grant.last_used_at)}</dd></div></dl>
      {grant.revoked_at ? <p className="mcp-key-note">{uiText("撤銷於 ")}{oauthTime(grant.revoked_at)}{uiText("。這筆授權已無法使用。")}</p> : confirmId === grant.id ? <div className="mcp-revoke" role="group" aria-label={uiText`確認撤銷 ${grant.client_name || "未命名 app"}`}>
        <p>{uiText("確定撤銷「")}{grant.client_name || uiText("未命名 app")}{uiText("」？使用這筆授權的 app 將無法再以室友身分操作，需要重新連線並取得你的同意。")}</p>
        <div className="mcp-key-actions"><button type="button" disabled={!!pending} onClick={() => setConfirmId(null)}>{uiText("取消")}</button><button type="button" disabled={!!pending || uncertain} onClick={() => revoke(grant)}>{pending === grant.id ? uiText("撤銷中…") : uiText("確認撤銷授權")}</button></div>
      </div> : <button type="button" disabled={!!pending || uncertain} onClick={() => setConfirmId(grant.id)}>{uiText("撤銷授權")}</button>}
    </article>)}</div>}
  </section>;
}
