import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(username, password);
      navigate("/", { replace: true });
    } catch (err: any) {
      setError(err.response?.data?.detail || "登入失敗");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4" style={{ background: "var(--bg)" }}>
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold" style={{ color: "var(--ink)" }}>
            共居社區
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--ink-soft)" }}>
            歡迎回家
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
            <span className="mb-1 block text-xs font-medium" style={{ color: "var(--ink-soft)" }}>帳號</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{
                background: "var(--surface-dim)",
                border: "1px solid var(--border)",
                color: "var(--ink)",
              }}
            />
          </label>

          <label className="mb-6 block">
            <span className="mb-1 block text-xs font-medium" style={{ color: "var(--ink-soft)" }}>密碼</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{
                background: "var(--surface-dim)",
                border: "1px solid var(--border)",
                color: "var(--ink)",
              }}
            />
          </label>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg py-2.5 text-sm font-medium text-white transition-opacity disabled:opacity-50"
            style={{ background: "var(--accent)" }}
          >
            {loading ? "登入中..." : "登入"}
          </button>

          <p className="mt-4 text-center text-xs" style={{ color: "var(--ink-soft)" }}>
            沒有帳號？{" "}
            <Link to="/register" className="underline" style={{ color: "var(--accent)" }}>
              使用邀請碼註冊
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
