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

  const inputStyle = {
    background: "var(--surface-dim)",
    border: "1px solid var(--border)",
    color: "var(--ink)",
  };

  return (
    <div className="flex min-h-dvh items-center justify-center px-4" style={{ background: "var(--bg)" }}>
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold" style={{ color: "var(--ink)" }}>
            搬進來
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--ink-soft)" }}>
            使用邀請碼加入共居社區
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-xl p-6"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        >
          {error && (
            <div className="mb-4 rounded-lg px-4 py-2 text-sm" style={{ background: "var(--warm-light)", color: "var(--error)" }}>
              {error}
            </div>
          )}

          <label className="mb-4 block">
            <span className="mb-1 block text-xs font-medium" style={{ color: "var(--accent)" }}>邀請碼</span>
            <input
              type="text"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              required
              autoFocus
              placeholder="輸入 8 位邀請碼"
              className="w-full rounded-lg px-3 py-2 text-sm font-mono tracking-wider outline-none"
              style={{ ...inputStyle, letterSpacing: "0.15em" }}
            />
          </label>

          <label className="mb-4 block">
            <span className="mb-1 block text-xs font-medium" style={{ color: "var(--ink-soft)" }}>帳號</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={2}
              maxLength={32}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={inputStyle}
            />
          </label>

          <label className="mb-4 block">
            <span className="mb-1 block text-xs font-medium" style={{ color: "var(--ink-soft)" }}>暱稱 <span className="opacity-50">(選填)</span></span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={64}
              placeholder="留空則同帳號"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={inputStyle}
            />
          </label>

          <label className="mb-6 block">
            <span className="mb-1 block text-xs font-medium" style={{ color: "var(--ink-soft)" }}>密碼</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={inputStyle}
            />
          </label>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg py-2.5 text-sm font-medium text-white transition-opacity disabled:opacity-50"
            style={{ background: "var(--accent)" }}
          >
            {loading ? "註冊中..." : "搬進來"}
          </button>

          <p className="mt-4 text-center text-xs" style={{ color: "var(--ink-soft)" }}>
            已有帳號？{" "}
            <Link to="/login" className="underline" style={{ color: "var(--accent)" }}>
              登入
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
