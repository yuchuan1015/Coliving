import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";

export function Layout() {
  const [dark] = useState(() => {
    const saved = localStorage.getItem("coliving_theme");
    if (saved) return saved === "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    localStorage.setItem("coliving_theme", dark ? "dark" : "light");
  }, [dark]);

  return (
    <div className="min-h-dvh" style={{ background: "var(--bg)" }}>
      <Outlet />
    </div>
  );
}
