import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [inviteCode, setInviteCode] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await register(username, password, inviteCode, displayName || undefined);
      navigate("/", { replace: true });
    } catch (err: any) {
      setError(err.response?.data?.detail || "註冊失敗");
    } finally {
      setLoading(false);
    }
  }

  const inputClass = "w-full rounded-lg px-3 py-2.5 text-[14px] outline-none transition-colors";
  const inputStyle = {
    background: "var(--surface-dim)",
    border: "1px solid var(--border)",
    color: "var(--ink)",
  };

  function focusBorder(e: React.FocusEvent<HTMLInputElement>) {
    e.currentTarget.style.borderColor = "var(--accent)";
  }
  function blurBorder(e: React.FocusEvent<HTMLInputElement>) {
    e.currentTarget.style.borderColor = "var(--border)";
  }

  return (
    <div
      className="flex min-h-dvh items-center justify-center px-5"
      style={{ background: "var(--bg)" }}
    >
      <div className="w-full max-w-[340px]">
        {/* Brand */}
        <div className="mb-10 text-center">
          <div
            className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl text-3xl select-none"
            style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
          >
            🪺
          </div>
          <h1
            className="text-[22px] font-semibold tracking-tight"
            style={{ color: "var(--ink)" }}
          >
            搬進來
          </h1>
          <p className="mt-1 text-[13px]" style={{ color: "var(--ink-soft)" }}>
            使用邀請碼入住鴉巢
          </p>
        </div>

        {/* Form card */}
        <form
          onSubmit={handleSubmit}
          className="rounded-2xl p-6"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          }}
        >
          {error && (
            <div
              className="mb-5 rounded-lg px-3.5 py-2.5 text-[13px]"
              style={{ background: "var(--surface-dim)", color: "var(--error)" }}
            >
              {error}
            </div>
          )}

          <div className="mb-4">
            <label
              className="mb-1.5 block text-[12px] font-medium"
              style={{ color: "var(--accent)" }}
            >
              邀請碼
            </label>
            <input
              type="text"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              required
              autoFocus
              placeholder="8 位邀請碼"
              className={`${inputClass} font-mono tracking-[0.15em]`}
              style={inputStyle}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>

          <div className="mb-4">
            <label
              className="mb-1.5 block text-[12px] font-medium"
              style={{ color: "var(--ink-soft)" }}
            >
              帳號
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
              minLength={2}
              maxLength={32}
              className={inputClass}
              style={inputStyle}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>

          <div className="mb-4">
            <label
              className="mb-1.5 block text-[12px] font-medium"
              style={{ color: "var(--ink-soft)" }}
            >
              暱稱
              <span className="ml-1 opacity-50">（選填）</span>
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={64}
              placeholder="留空則同帳號"
              className={inputClass}
              style={inputStyle}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>

          <div className="mb-6">
            <label
              className="mb-1.5 block text-[12px] font-medium"
              style={{ color: "var(--ink-soft)" }}
            >
              密碼
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
              minLength={6}
              className={inputClass}
              style={inputStyle}
              onFocus={focusBorder}
              onBlur={blurBorder}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg py-2.5 text-[14px] font-medium transition-opacity disabled:opacity-50"
            style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
          >
            {loading ? "註冊中⋯" : "入住鴉巢"}
          </button>
        </form>

        <p
          className="mt-5 text-center text-[12px]"
          style={{ color: "var(--ink-soft)" }}
        >
          已有帳號？{" "}
          <Link
            to="/login"
            className="underline underline-offset-2"
            style={{ color: "var(--accent)" }}
          >
            登入
          </Link>
        </p>
      </div>
    </div>
  );
}
