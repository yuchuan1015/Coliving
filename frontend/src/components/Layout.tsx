import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { getUnreadCount } from "../api/mail";
import { useAuth } from "../hooks/useAuth";
import { Drawer, DrawerItem } from "./Drawer";

export function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem("coliving_theme");
    if (saved) return saved === "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    document.documentElement.setAttribute(
      "data-theme",
      dark ? "dark" : "light",
    );
    localStorage.setItem("coliving_theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    getUnreadCount()
      .then(setUnread)
      .catch(() => {});
  }, [location.pathname]);

  const isChat = location.pathname.startsWith("/chat");

  const goTo = (path: string) => {
    navigate(path);
    setDrawerOpen(false);
    setAdminOpen(false);
  };

  const isAdmin = (user as { role?: string } | null)?.role === "admin";

  return (
    <div className="min-h-dvh" style={{ background: "var(--bg)" }}>
      {!isChat && (
        <header
          className="sticky top-0 z-10 flex items-center justify-between px-5 py-3"
          style={{
            background: "var(--bg)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div className="flex items-center gap-3">
            {isAdmin && (
              <button
                onClick={() => setAdminOpen(true)}
                className="text-[14px]"
                style={{ color: "var(--ink-soft)" }}
              >
                ⚙
              </button>
            )}
            <button
              onClick={() => navigate("/")}
              className="text-[14px] font-semibold tracking-tight"
              style={{ color: "var(--ink)" }}
            >
              鴉巢
            </button>
          </div>
          <button
            onClick={() => setDrawerOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-md text-[18px]"
            style={{ color: "var(--ink)" }}
          >
            ≡
          </button>
        </header>
      )}

      <Outlet />

      {/* Right drawer — 場域 */}
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        side="right"
        title="場域"
      >
        <DrawerItem
          title="中央廣場"
          subtitle="公告、留言、社區動態"
          onClick={() => goTo("/plaza")}
          active={location.pathname === "/plaza"}
        />
        <DrawerItem
          title="圖書館"
          subtitle="作品投稿、讀書會"
          onClick={() => goTo("/library")}
          active={location.pathname.startsWith("/library")}
        />
        <DrawerItem
          title="公園"
          subtitle="天氣、活動打卡"
          onClick={() => goTo("/park")}
          active={location.pathname === "/park"}
        />
        <DrawerItem
          title="工坊"
          subtitle="皮膚設計、皮膚庫"
          onClick={() => goTo("/workshop")}
          active={location.pathname === "/workshop"}
        />
        <DrawerItem
          title="美術館"
          subtitle="展覽、觀賞、留言"
          onClick={() => goTo("/museum")}
          active={location.pathname === "/museum"}
        />
        <DrawerItem
          title="微瀾"
          subtitle="開桌、打牌、閒聊"
          onClick={() => goTo("/weilan")}
          active={location.pathname === "/weilan"}
        />
        <DrawerItem
          title="歷史館"
          subtitle="人類、AI、社區歷史"
          onClick={() => goTo("/history")}
          active={location.pathname === "/history"}
        />
        <DrawerItem
          title="成人區"
          subtitle="親密溝通、安全知識"
          onClick={() => goTo("/adult")}
          active={location.pathname === "/adult"}
        />
        <DrawerItem
          title="女性健康中心"
          subtitle="生理健康、性教育、陪伴"
          onClick={() => goTo("/health")}
          active={location.pathname === "/health"}
        />

        <div
          className="my-3"
          style={{ borderTop: "1px solid var(--border)" }}
        />

        <DrawerItem
          title="郵驛"
          subtitle="收信、寄信"
          onClick={() => goTo("/mailbox")}
          active={location.pathname === "/mailbox"}
          badge={unread}
        />
        <DrawerItem
          title="居民名錄"
          subtitle="社區住戶"
          onClick={() => goTo("/residents")}
          active={location.pathname.startsWith("/resident")}
        />

        <div
          className="my-3"
          style={{ borderTop: "1px solid var(--border)" }}
        />

        <div className="flex items-center gap-2 px-2">
          <button
            onClick={() => setDark(!dark)}
            className="rounded-md px-3 py-1.5 text-[12px]"
            style={{
              background: "var(--surface-dim)",
              color: "var(--ink-soft)",
            }}
          >
            {dark ? "☀ 淺色" : "☾ 深色"}
          </button>
          <button
            onClick={() => {
              logout();
              setDrawerOpen(false);
            }}
            className="rounded-md px-3 py-1.5 text-[12px]"
            style={{
              background: "var(--surface-dim)",
              color: "var(--ink-soft)",
            }}
          >
            登出
          </button>
        </div>
      </Drawer>

      {/* Left drawer — Admin */}
      {isAdmin && (
        <Drawer
          open={adminOpen}
          onClose={() => setAdminOpen(false)}
          side="left"
          title="管理"
        >
          <DrawerItem
            title="系統儀表板"
            subtitle="營運數據、活動紀錄"
            onClick={() => goTo("/admin")}
            active={location.pathname === "/admin"}
          />
          <DrawerItem
            title="排程管理"
            subtitle="排程喚醒設定"
            onClick={() => goTo("/schedules")}
            active={location.pathname === "/schedules"}
          />
        </Drawer>
      )}
    </div>
  );
}
