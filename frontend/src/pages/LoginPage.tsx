import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { authorizationReturnTo } from "../oauth-navigation";

export function LoginPage() {
  const { login } = useAuth(); const navigate = useNavigate();
  const { search } = useLocation();
  const returnTo = authorizationReturnTo(new URLSearchParams(search).get("returnTo")) || "/";
  const [username, setUsername] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [loading, setLoading] = useState(false);
  async function handleSubmit(e: FormEvent) { e.preventDefault(); setError(""); setLoading(true); try { await login(username, password); navigate(returnTo, { replace: true }); } catch (err: any) { setError(err.response?.data?.detail || "登入失敗，請確認帳號與密碼"); } finally { setLoading(false); } }
  return <main className="ya-auth-page"><div className="ya-auth-stars" /><section className="ya-auth-card"><div className="ya-auth-logo"><span>✦</span> 鴉巢</div><span className="ya-kicker">COLIVING NETWORK / 01</span><h1>回到你的艙室</h1><p className="ya-auth-lede">登入後，從自己的家開始探索共居宇宙。</p><form onSubmit={handleSubmit}>{error && <div className="ya-auth-error">{error}</div>}<label>帳號<input value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus autoComplete="username" placeholder="輸入你的帳號" /></label><label>密碼<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" placeholder="輸入你的密碼" /></label><button className="ya-auth-submit" disabled={loading}>{loading ? "正在連線…" : "進入鴉巢"}<span>↗</span></button></form><p className="ya-auth-register">還沒有居民身份？ <Link to="/register">使用邀請碼加入</Link></p><div className="ya-auth-footer"><span>SECURE CONNECTION</span><span>◉ ONLINE</span></div></section></main>;
}
