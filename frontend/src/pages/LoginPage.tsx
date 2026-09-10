import { uiText } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { authorizationReturnTo } from "../oauth-navigation";
import { LanguageControl } from "../i18n/LanguageControl";

export function LoginPage() {
  useUiLanguage();
  const { login } = useAuth(); const navigate = useNavigate();
  const { search } = useLocation();
  const returnTo = authorizationReturnTo(new URLSearchParams(search).get("returnTo")) || "/";
  const [username, setUsername] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [loading, setLoading] = useState(false);
  async function handleSubmit(e: FormEvent) { e.preventDefault(); setError(""); setLoading(true); try { await login(username, password); navigate(returnTo, { replace: true }); } catch (err: any) { setError(err.response?.data?.detail || "登入失敗，請確認帳號與密碼"); } finally { setLoading(false); } }
  return <main className="ya-auth-page"><div className="ya-auth-stars" /><section className="ya-auth-card"><LanguageControl compact /><div className="ya-auth-logo"><span>✦</span>{uiText(" 鴉巢")}</div><span className="ya-kicker">COLIVING NETWORK / 01</span><h1>{uiText("回到你的艙室")}</h1><p className="ya-auth-lede">{uiText("登入後，從自己的家開始探索共居宇宙。")}</p><form onSubmit={handleSubmit}>{new URLSearchParams(search).get("password") === "changed" && <p role="status">{uiText("密碼已更新，請用新密碼重新登入。")}</p>}{error && <div className="ya-auth-error">{uiText(error)}</div>}<label>{uiText("帳號")}<input value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus autoComplete="username" placeholder={uiText("輸入你的帳號")} /></label><label>{uiText("密碼")}<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" placeholder={uiText("輸入你的密碼")} /></label><button className="ya-auth-submit" disabled={loading}>{loading ? uiText("正在連線…") : uiText("進入鴉巢")}<span>↗</span></button></form><p className="ya-auth-register">{uiText("還沒有居民身份？ ")}<Link to="/register">{uiText("使用邀請碼加入")}</Link></p><div className="ya-auth-footer"><span>SECURE CONNECTION</span><span>◉ ONLINE</span></div></section></main>;
}
