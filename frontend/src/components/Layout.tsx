import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

export function Layout() {
  const { logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem("coliving_theme");
    if (saved) return saved === "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    localStorage.setItem("coliving_theme", dark ? "dark" : "light");
  }, [dark]);

  const isChat = location.pathname.startsWith("/chat");

  return (
    <div className="min-h-dvh" style={{ background: "var(--bg)" }}>
      {!isChat && (
        <header
          className="sticky top-0 z-10 flex items-center justify-between px-5 py-3"
          style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}
        >
          <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>
            共居社區
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setDark(!dark)}
              className="rounded-md px-2 py-1 text-xs"
              style={{ background: "var(--surface-dim)", color: "var(--ink-soft)" }}
            >
              {dark ? "☀" : "☾"}
            </button>
            <button
              onClick={logout}
              className="rounded-md px-2 py-1 text-xs"
              style={{ background: "var(--surface-dim)", color: "var(--ink-soft)" }}
            >
              登出
            </button>
          </div>
        </header>
      )}

      <Outlet />

      {!isChat && (
        <nav
          className="fixed bottom-0 left-0 right-0 flex justify-around py-2 md:hidden"
          style={{ background: "var(--surface)", borderTop: "1px solid var(--border)" }}
        >
          <NavItem label="我的家" active={location.pathname === "/"} onClick={() => navigate("/")} />
          <NavItem label="廣場" active={location.pathname === "/plaza"} onClick={() => navigate("/plaza")} />
          <NavItem label="圖書館" />
          <NavItem label="設定" />
        </nav>
      )}
    </div>
  );
}

function NavItem({
  label,
  active = false,
  onClick,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      disabled={!onClick}
      onClick={onClick}
      className="flex flex-col items-center gap-0.5 px-3 py-1 text-[10px]"
      style={{
        color: active ? "var(--accent)" : "var(--ink-soft)",
        opacity: active || onClick ? 1 : 0.4,
      }}
    >
      <span className="text-base">{active ? "●" : "○"}</span>
      {label}
    </button>
  );
}
