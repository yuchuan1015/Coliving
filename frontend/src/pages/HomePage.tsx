import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getDashboard } from "../api/auth";
import { getFurniture, type FurnitureSummary } from "../api/furniture";
import { getUnreadCount } from "../api/mail";
import {
  BedSvg,
  BookshelfSvg,
  ClockSvg,
  DiarySvg,
  DoorSvg,
  DrawerSvg,
  MailboxSvg,
  MirrorSvg,
  PhotoFrameSvg,
  WindowSvg,
} from "../components/RoomFurniture";
import { useAuth } from "../hooks/useAuth";
import type { DashboardData } from "../types";

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 6) return "夜深了";
  if (h < 12) return "早安";
  if (h < 18) return "午安";
  return "晚安";
}

/* ── Furniture spot in the room ── */

interface SpotProps {
  children: React.ReactNode;
  label: string;
  detail?: string;
  onClick?: () => void;
  x: string;
  y: string;
  w: string;
  h: string;
  badge?: number;
  wall?: boolean;
}

function Spot({ children, label, detail, onClick, x, y, w, h, badge, wall }: SpotProps) {
  const [hover, setHover] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onTouchStart={() => setHover(true)}
      onTouchEnd={() => setHover(false)}
      className="absolute"
      style={{
        left: x,
        top: y,
        width: w,
        height: h,
        zIndex: hover ? 20 : wall ? 5 : 10,
      }}
    >
      {/* Tooltip */}
      <div
        className="pointer-events-none absolute left-1/2 flex flex-col items-center whitespace-nowrap transition-all duration-150"
        style={{
          bottom: "calc(100% + 4px)",
          transform: "translateX(-50%)",
          opacity: hover ? 1 : 0,
        }}
      >
        <div
          className="rounded-md px-2 py-1 text-center"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
          }}
        >
          <span className="block text-[11px] font-medium" style={{ color: "var(--ink)" }}>
            {label}
          </span>
          {detail && (
            <span className="block text-[9px]" style={{ color: "var(--ink-soft)" }}>
              {detail}
            </span>
          )}
        </div>
      </div>

      {/* The SVG furniture */}
      <div
        className="h-full w-full transition-transform duration-150"
        style={{
          transform: hover ? "scale(1.08) translateY(-2px)" : "scale(1)",
          filter: hover ? "drop-shadow(0 4px 6px rgba(0,0,0,0.15))" : "drop-shadow(0 1px 2px rgba(0,0,0,0.08))",
        }}
      >
        {children}
      </div>

      {/* Floor shadow */}
      {!wall && (
        <div
          className="absolute left-1/2 -translate-x-1/2 rounded-full transition-all duration-150"
          style={{
            bottom: "-3px",
            width: hover ? "80%" : "60%",
            height: "4px",
            background: "rgba(0,0,0,0.06)",
            filter: "blur(2px)",
          }}
        />
      )}

      {/* Badge */}
      {badge !== undefined && badge > 0 && (
        <span
          className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold"
          style={{ background: "var(--terracotta)", color: "#fff", zIndex: 30 }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

/* ── Main ── */

export function HomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [furniture, setFurniture] = useState<FurnitureSummary | null>(null);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    getDashboard().then(setData).catch(console.error);
    getFurniture().then(setFurniture).catch(() => {});
    getUnreadCount().then(setUnread).catch(() => {});
  }, []);

  const agent = data?.agents?.[0] ?? null;

  return (
    <main className="mx-auto max-w-lg px-5 py-6 pb-20">
      {/* Greeting */}
      <section className="mb-5">
        <h1
          className="text-[20px] font-semibold tracking-tight"
          style={{ color: "var(--ink)" }}
        >
          {getGreeting()}，{user?.display_name}
        </h1>
        <p className="mt-0.5 text-[13px]" style={{ color: "var(--ink-soft)" }}>
          {data?.community_status.message || "載入中⋯"}
        </p>
      </section>

      {/* Agent row */}
      {agent ? (
        <section
          className="mb-5 rounded-2xl p-4"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-3">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg select-none"
              style={{ background: "var(--accent-light)" }}
            >
              {agent.avatar_emoji}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[14px] font-medium" style={{ color: "var(--ink)" }}>
                {agent.name}
              </h2>
              <span className="text-[11px]" style={{ color: "var(--ink-soft)" }}>
                {agent.llm_provider === "claude"
                  ? "Claude"
                  : agent.llm_provider === "xai"
                    ? "Grok"
                    : "GPT"}{" "}
                · {agent.llm_model}
              </span>
            </div>
            <button
              onClick={() => navigate(`/chat/${agent.id}`)}
              className="rounded-lg px-3.5 py-1.5 text-[12px] font-medium"
              style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
            >
              聊天
            </button>
          </div>
        </section>
      ) : (
        <section
          className="mb-5 rounded-2xl p-5 text-center"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        >
          <div
            className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full text-2xl select-none"
            style={{ background: "var(--accent-light)" }}
          >
            ?
          </div>
          <h2 className="text-[15px] font-medium" style={{ color: "var(--ink)" }}>
            {data?.agent_placeholder?.message || "你還沒有 AI 室友"}
          </h2>
          <p className="mt-1 text-[13px]" style={{ color: "var(--ink-soft)" }}>
            {data?.agent_placeholder?.hint || "領養一位室友陪你吧"}
          </p>
          <button
            onClick={() => navigate("/adopt")}
            className="mt-4 rounded-lg px-5 py-2 text-[13px] font-medium"
            style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
          >
            領養室友
          </button>
        </section>
      )}

      {/* ── THE ROOM ── */}
      {agent && (
        <section className="mb-5">
          <h2
            className="mb-2 text-[11px] font-medium uppercase tracking-widest"
            style={{ color: "var(--ink-muted)" }}
          >
            我的家
          </h2>

          <div
            className="relative overflow-hidden rounded-2xl"
            style={{ border: "1px solid var(--border)" }}
          >
            {/* ── Wall ── */}
            <div
              className="relative"
              style={{
                height: "100px",
                background: "var(--surface)",
                borderBottom: "3px solid var(--border)",
              }}
            >
              {/* Wall items are positioned here */}
              <Spot
                label="窗戶"
                detail={furniture?.weather?.description}
                onClick={() => navigate("/park")}
                x="5%" y="15%" w="30%" h="75%"
                wall
              >
                <WindowSvg />
              </Spot>

              <Spot
                label="時鐘"
                detail={
                  furniture?.clock
                    ? new Date(furniture.clock.taipei).toLocaleTimeString(
                        "zh-TW",
                        { hour: "2-digit", minute: "2-digit", hour12: false },
                      )
                    : undefined
                }
                x="40%" y="20%" w="12%" h="70%"
                wall
              >
                <ClockSvg />
              </Spot>

              <Spot
                label="鏡子"
                detail={furniture?.mirror?.name}
                onClick={() => navigate("/agent/edit")}
                x="56%" y="15%" w="12%" h="75%"
                wall
              >
                <MirrorSvg />
              </Spot>

              {furniture && furniture.photo_frame_count > 0 && (
                <Spot
                  label="相框"
                  detail={`${furniture.photo_frame_count} 張`}
                  onClick={() => navigate("/home/photos")}
                  x="74%" y="20%" w="10%" h="60%"
                  wall
                >
                  <PhotoFrameSvg />
                </Spot>
              )}
            </div>

            {/* ── Floor ── */}
            <div
              className="relative"
              style={{
                height: "200px",
                background: `
                  repeating-conic-gradient(
                    var(--surface-dim) 0% 25%,
                    var(--border-light) 0% 50%
                  ) 0 0 / 36px 36px`,
              }}
            >
              {/* Door — right side against wall */}
              <Spot
                label="門"
                detail={furniture?.door?.current_location || "在家"}
                onClick={() => navigate("/plaza")}
                x="82%" y="-10%" w="16%" h="60%"
              >
                <DoorSvg />
              </Spot>

              {/* Bed — left side */}
              <Spot
                label="床"
                detail={
                  furniture?.bed
                    ? `${furniture.bed.schedule_count} 個排程`
                    : undefined
                }
                onClick={() => navigate("/schedules")}
                x="3%" y="15%" w="35%" h="38%"
              >
                <BedSvg />
              </Spot>

              {/* Diary — center-ish, on desk */}
              <Spot
                label="日記本"
                detail={furniture ? `${furniture.diary_count} 篇` : undefined}
                onClick={() => navigate("/home/diary")}
                x="42%" y="25%" w="14%" h="35%"
              >
                <DiarySvg />
              </Spot>

              {/* Drawer — right-center */}
              <Spot
                label="抽屜"
                detail={furniture ? `${furniture.drawer_count} 件` : undefined}
                onClick={() => navigate("/home/drawer")}
                x="60%" y="18%" w="15%" h="40%"
              >
                <DrawerSvg />
              </Spot>

              {/* Mailbox — bottom left */}
              <Spot
                label="信箱"
                badge={unread}
                onClick={() => navigate("/mailbox")}
                x="10%" y="62%" w="14%" h="38%"
              >
                <MailboxSvg />
              </Spot>

              {/* Bookshelf — bottom right */}
              <Spot
                label="書架"
                onClick={() => navigate("/library")}
                x="65%" y="55%" w="20%" h="42%"
              >
                <BookshelfSvg />
              </Spot>
            </div>
          </div>
        </section>
      )}

      {/* Community */}
      {data && (
        <section
          className="rounded-xl px-4 py-2.5 text-center text-[12px]"
          style={{ background: "var(--surface-dim)", color: "var(--ink-soft)" }}
        >
          鴉巢目前有 {data.resident_count} 位居民
        </section>
      )}
    </main>
  );
}
