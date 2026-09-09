import { uiText } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { decideOAuthRequest, getOAuthRequest, type OAuthRequest } from "../api/oauth";
import { useAuth } from "../hooks/useAuth";
import { authorizationRequestId, oauthError, oauthStatus, oauthTime, safeOAuthCallback } from "../oauth-navigation";
import "../oauth.css";

const RECONNECT = "請回到 app 重新連線。";

export function AuthorizePage() {
  const { search } = useLocation();
  const { user } = useAuth();
  const requestId = authorizationRequestId(search);
  // A changed request or account must never retain the previous consent state.
  return <AuthorizeRequest key={`${user?.id}:${requestId}`} requestId={requestId} />;
}

export function AuthorizeRequest({ requestId }: { requestId: string | null }) {
  useUiLanguage();
  const [request, setRequest] = useState<OAuthRequest | null>(null);
  const [loading, setLoading] = useState(!!requestId);
  const [error, setError] = useState(requestId ? "" : `找不到有效的授權請求。${RECONNECT}`);
  const [terminal, setTerminal] = useState(!requestId);
  const [expired, setExpired] = useState(false);
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState<"approve" | "deny" | null>(null);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const writeLock = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    if (!requestId) return;
    const controller = new AbortController();
    getOAuthRequest(requestId, controller.signal).then(data => {
      if (controller.signal.aborted) return;
      if (data.request_id !== requestId || !data.redirect_host || !Array.isArray(data.scopes) || !Number.isFinite(Date.parse(data.expires_at))) {
        setTerminal(true); setError(`授權資料不完整。${RECONNECT}`); return;
      }
      setRequest(data);
    }).catch(err => {
      if (controller.signal.aborted) return;
      const status = oauthStatus(err);
      setTerminal(status === 404 || status === 410);
      setError(status === 410 ? `這個授權請求已過期或處理過了。${RECONNECT}` : status === 404 ? `找不到這個授權請求。${RECONNECT}` : oauthError(err, "暫時讀不到授權資料，請再試一次。"));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [requestId, revision]);

  useEffect(() => {
    if (!request) return;
    const remaining = Date.parse(request.expires_at) - Date.now();
    const timer = window.setTimeout(() => setExpired(true), Math.max(0, remaining));
    return () => window.clearTimeout(timer);
  }, [request]);

  async function decide(approve: boolean) {
    if (!request || loading || terminal || expired || writeLock.current) return;
    if (Date.parse(request.expires_at) <= Date.now()) { setExpired(true); return; }
    if (approve && (!request.agent_id || request.scopes.length !== 1 || request.scopes[0] !== "mcp")) return;
    writeLock.current = true;
    setPending(approve ? "approve" : "deny");
    setError("");
    try {
      const result = await decideOAuthRequest(request.request_id, approve);
      if (!alive.current) return;
      const callback = typeof result.redirect_to === "string" ? safeOAuthCallback(result.redirect_to, request.redirect_host) : null;
      if (!callback || result.approved !== approve) throw new Error("Invalid decision response");
      // Never display, store, log, or copy the callback's code/state.
      window.location.replace(callback);
    } catch (err) {
      if (!alive.current) return;
      setTerminal(true);
      setPending(null);
      setError(oauthStatus(err) === 410 ? `這個授權請求已過期或處理過了。${RECONNECT}` : oauthError(err, `未能確認授權結果，為避免重複送出，${RECONNECT}`));
      // An ambiguous POST may have succeeded. Do not retry it automatically.
    }
  }

  const unavailable = loading || terminal || expired || !!pending;
  const scopeSupported = request?.scopes.length === 1 && request.scopes[0] === "mcp";
  // Do not fetch untrusted client logos or leak request IDs to third-party images.
  const avatar = request?.agent_avatar_url?.startsWith("/uploads/") && !request.agent_avatar_url.includes("\\") ? request.agent_avatar_url : null;

  return <main className="ya-auth-page oauth-page">
    <meta name="referrer" content="no-referrer" />
    <div className="ya-auth-stars" aria-hidden="true" />
    <section className="ya-auth-card oauth-card" aria-labelledby="oauth-title" aria-busy={loading || !!pending}>
      <div className="ya-auth-logo"><span aria-hidden="true">✦</span>{uiText(" 鴉巢")}</div>
      <span className="ya-kicker">CONNECTION / AUTHORIZE</span>
      <h1 id="oauth-title">{uiText("允許 app 連上室友？")}</h1>
      <p className="oauth-muted">{uiText("先確認來訪的 app，再決定是否讓它進入社區。")}</p>
      {loading && <p role="status">{uiText("正在確認連線請求…")}</p>}
      {error && <p className="oauth-message" role="alert">{uiText(error)}</p>}
      {expired && !terminal && <p className="oauth-message" role="alert">{uiText("這個授權請求已過期。")}{RECONNECT}</p>}
      {!loading && request && !terminal && <>
        <div className="oauth-identity">
          <span className="oauth-app-mark" aria-hidden="true">↗</span>
          <div><span className="oauth-muted">{uiText("提出請求的 app")}</span><h2>{request.client_name || request.redirect_host}</h2><p className="oauth-host">{uiText("返回位置：")}{request.redirect_host}</p></div>
        </div>
        <div className="oauth-agent">
          <div className="oauth-avatar" aria-hidden="true">{avatar && !avatarFailed ? <img src={avatar} alt="" referrerPolicy="no-referrer" onError={() => setAvatarFailed(true)} /> : request.agent_avatar_emoji || "✦"}</div>
          <div><span className="oauth-muted">{uiText("要連線的室友")}</span><h2>{request.agent_name || uiText("尚未領養室友")}</h2></div>
        </div>
        <div className="oauth-permissions">
          <h2>{uiText("你將允許")}</h2>
          <p>{uiText("這個 app 用你室友的身分進社區，讀取資料並執行社區功能（包含寫入操作）。")}</p>
          <p className="oauth-muted">{uiText("只同意你信任的 app。之後可在「進階連線與房間設定」撤銷授權。")}</p>
          {!scopeSupported && <p role="alert">{uiText("這個請求包含目前無法確認的權限，暫時不能同意。請拒絕並回到 app 重新連線。")}</p>}
          {!request.agent_id && <p role="status">{uiText("你還沒有室友，暫時無法同意。請先回艙室領養，再從 app 重新連線。")}</p>}
        </div>
        <div className="oauth-decisions">
          <button type="button" className="oauth-secondary" disabled={unavailable} onClick={() => decide(false)}>{pending === "deny" ? uiText("正在返回 app…") : uiText("拒絕")}</button>
          <button type="button" className="ya-auth-submit" disabled={unavailable || !request.agent_id || !scopeSupported} onClick={() => decide(true)}>{pending === "approve" ? uiText("正在連線…") : uiText("同意並連線")}</button>
        </div>
        <p className="oauth-expiry">{uiText("有效至 ")}{oauthTime(request.expires_at)}</p>
      </>}
      {!loading && error && !terminal && <button type="button" className="oauth-secondary" onClick={() => { setLoading(true); setError(""); setRequest(null); setRevision(n => n + 1); }}>{uiText("重新讀取")}</button>}
      <Link className="oauth-home" to="/">{uiText("返回艙室")}</Link>
    </section>
  </main>;
}
