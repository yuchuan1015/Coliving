import { uiText } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { shelfError } from "../hooks/useBookshelf";
import "../register.css";
import { LanguageControl } from "../i18n/LanguageControl";

export function RegisterPage() {
  useUiLanguage();
  const { register } = useAuth();
  const navigate = useNavigate();
  const [inviteCode, setInviteCode] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const lock = useRef(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (lock.current) return;
    if (!/^\d{4}$/.test(birthYear) || Number(birthYear) < 1900 || Number(birthYear) > new Date().getFullYear()) {
      setError("請確認出生年，再送出註冊。"); return;
    }
    lock.current = true;
    setError("");
    setLoading(true);
    try {
      await register(username, password, inviteCode, displayName || undefined, Number(birthYear));
      navigate("/", { replace: true });
    } catch (err) {
      setError(shelfError(err).message);
    } finally {
      lock.current = false;
      setLoading(false);
    }
  }

  return (
    <main className="ya-auth-page ya-register-page">
      <div className="ya-auth-stars" aria-hidden="true" />
      <section className="ya-auth-card" aria-labelledby="register-title">
        <LanguageControl compact />
        <div className="ya-auth-logo"><span aria-hidden="true">✦</span>{uiText(" 鴉巢")}</div>
        <span className="ya-kicker">COLIVING NETWORK / 02</span>
        <h1 id="register-title">{uiText("入住你的艙室")}</h1>
        <p className="ya-auth-lede">{uiText("使用邀請碼，加入鴉巢。")}</p>

        <form onSubmit={handleSubmit} aria-busy={loading}>
          {error && <div className="ya-auth-error" role="alert">{uiText(error)}</div>}
          <fieldset className="ya-register-fields" disabled={loading}>
            <legend className="ya-register-sr-only">{uiText("入住資料")}</legend>
            <label htmlFor="register-invite-code">{uiText("邀請碼")}<input id="register-invite-code" name="invite_code" type="text"
                value={inviteCode} onChange={e => setInviteCode(e.target.value.toUpperCase())}
                required maxLength={16} autoComplete="off" autoCapitalize="characters"
                autoCorrect="off" spellCheck={false} placeholder={uiText("輸入邀請碼")} />
            </label>
            <label htmlFor="register-username">{uiText("帳號")}<input id="register-username" name="username" type="text"
                value={username} onChange={e => setUsername(e.target.value)}
                required autoComplete="username" autoCapitalize="none" autoCorrect="off"
                spellCheck={false} minLength={2} maxLength={32} placeholder={uiText("2–32 個字元")} />
            </label>
            <label htmlFor="register-display-name">{uiText("暱稱 ")}<span className="ya-register-optional">{uiText("（選填）")}</span>
              <input id="register-display-name" name="display_name" type="text"
                value={displayName} onChange={e => setDisplayName(e.target.value)}
                maxLength={64} autoComplete="nickname" placeholder={uiText("留空則同帳號")} />
            </label>
            <label htmlFor="register-password">{uiText("密碼")}<input id="register-password" name="password" type="password"
                value={password} onChange={e => setPassword(e.target.value)}
                required autoComplete="new-password" minLength={6} maxLength={128}
                placeholder={uiText("至少 6 個字元")} />
            </label>
            <label htmlFor="register-birth-year">{uiText("出生年")}<input id="register-birth-year" name="birth_year" type="number"
                inputMode="numeric" autoComplete="bday-year" min={1900} max={new Date().getFullYear()}
                required value={birthYear} onChange={e => setBirthYear(e.target.value)}
                placeholder={uiText("西元年份")} aria-describedby="register-birth-hint" />
              <span className="ya-register-hint" id="register-birth-hint">{uiText("用於年齡分級；註冊後不能更改，請確認再送出。")}</span>
            </label>
            <button type="submit" className="ya-auth-submit" disabled={loading}>
              {loading ? uiText("註冊中⋯") : uiText("入住鴉巢")}<span aria-hidden="true">↗</span>
            </button>
          </fieldset>
        </form>
        <p className="ya-auth-register">{uiText("已有帳號？ ")}<Link to="/login">{uiText("返回登入")}</Link></p>
      </section>
    </main>
  );
}
