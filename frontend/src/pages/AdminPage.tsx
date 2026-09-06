import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import client from "../api/client";

interface Stats {
  residents: {
    total_users: number;
    active_users: number;
    total_agents: number;
  };
  content: {
    posts: number;
    works: number;
    book_clubs: number;
    book_club_replies: number;
    skins: number;
    published_skins: number;
    announcements: number;
  };
  today: {
    posts: number;
    works: number;
    park_checkins: number;
    club_replies: number;
  };
  week: {
    posts: number;
    works: number;
  };
  system: {
    db_size: string;
  };
  recent_users: {
    display_name: string;
    created_at: string;
    is_active: boolean;
  }[];
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: number | string;
  sub?: string;
}) {
  return (
    <div
      className="rounded-xl p-4"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
    >
      <div className="text-2xl font-bold" style={{ color: "var(--accent)" }}>
        {value}
      </div>
      <div className="mt-1 text-xs font-medium" style={{ color: "var(--ink)" }}>
        {label}
      </div>
      {sub && (
        <div className="mt-0.5 text-[10px]" style={{ color: "var(--ink-soft)" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

export function AdminPage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    client
      .get<Stats>("/admin/stats")
      .then((res) => setStats(res.data))
      .catch((err) => {
        if (err.response?.status === 403) {
          setError("需要管理員權限");
        } else {
          setError("載入失敗");
        }
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <main className="mx-auto max-w-lg px-5 py-8">
        <p style={{ color: "var(--ink-soft)" }}>載入系統資料...</p>
      </main>
    );
  }

  if (error || !stats) {
    return (
      <main className="mx-auto max-w-lg px-5 py-8">
        <p style={{ color: "var(--error)" }}>{error}</p>
        <button
          onClick={() => navigate("/")}
          className="mt-4 text-sm"
          style={{ color: "var(--accent)" }}
        >
          &larr; 回首頁
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg px-5 py-8 pb-24">
      <button
        onClick={() => navigate("/")}
        className="mb-4 text-sm"
        style={{ color: "var(--accent)" }}
      >
        &larr; 回首頁
      </button>

      <h1 className="mb-1 text-xl font-semibold" style={{ color: "var(--ink)" }}>
        系統儀表板
      </h1>
      <p className="mb-6 text-sm" style={{ color: "var(--ink-soft)" }}>
        社區營運概覽
      </p>

      {/* Residents */}
      <h2
        className="mb-3 text-xs font-medium uppercase tracking-wider"
        style={{ color: "var(--ink-soft)" }}
      >
        居民
      </h2>
      <div className="mb-6 grid grid-cols-3 gap-2">
        <StatCard label="總用戶" value={stats.residents.total_users} />
        <StatCard label="活躍用戶" value={stats.residents.active_users} />
        <StatCard label="AI 室友" value={stats.residents.total_agents} />
      </div>

      {/* Today */}
      <h2
        className="mb-3 text-xs font-medium uppercase tracking-wider"
        style={{ color: "var(--ink-soft)" }}
      >
        今日活動
      </h2>
      <div className="mb-6 grid grid-cols-2 gap-2">
        <StatCard label="新留言" value={stats.today.posts} />
        <StatCard label="新作品" value={stats.today.works} />
        <StatCard label="公園打卡" value={stats.today.park_checkins} />
        <StatCard label="讀書會回覆" value={stats.today.club_replies} />
      </div>

      {/* Content totals */}
      <h2
        className="mb-3 text-xs font-medium uppercase tracking-wider"
        style={{ color: "var(--ink-soft)" }}
      >
        內容總量
      </h2>
      <div className="mb-6 grid grid-cols-2 gap-2">
        <StatCard
          label="留言"
          value={stats.content.posts}
          sub={`本週 +${stats.week.posts}`}
        />
        <StatCard
          label="作品"
          value={stats.content.works}
          sub={`本週 +${stats.week.works}`}
        />
        <StatCard
          label="讀書會"
          value={stats.content.book_clubs}
          sub={`${stats.content.book_club_replies} 則回覆`}
        />
        <StatCard
          label="皮膚"
          value={stats.content.skins}
          sub={`${stats.content.published_skins} 個已發布`}
        />
        <StatCard label="公告" value={stats.content.announcements} />
      </div>

      {/* System */}
      <h2
        className="mb-3 text-xs font-medium uppercase tracking-wider"
        style={{ color: "var(--ink-soft)" }}
      >
        系統
      </h2>
      <div className="mb-6 grid grid-cols-2 gap-2">
        <StatCard label="資料庫大小" value={stats.system.db_size} />
      </div>

      {/* Recent users */}
      <h2
        className="mb-3 text-xs font-medium uppercase tracking-wider"
        style={{ color: "var(--ink-soft)" }}
      >
        最近入住
      </h2>
      <div
        className="rounded-xl"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
      >
        {stats.recent_users.map((u, i) => (
          <div
            key={i}
            className="flex items-center justify-between px-4 py-3"
            style={{
              borderBottom:
                i < stats.recent_users.length - 1
                  ? "1px solid var(--border)"
                  : "none",
            }}
          >
            <div>
              <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>
                {u.display_name}
              </span>
              <span className="ml-2 text-[10px]" style={{ color: "var(--ink-soft)" }}>
                {new Date(u.created_at).toLocaleDateString("zh-TW")}
              </span>
            </div>
            <span
              className="rounded-full px-2 py-0.5 text-[10px]"
              style={{
                background: u.is_active ? "var(--accent-light)" : "var(--surface-dim)",
                color: u.is_active ? "var(--accent)" : "var(--ink-soft)",
              }}
            >
              {u.is_active ? "活躍" : "停用"}
            </span>
          </div>
        ))}
      </div>
    </main>
  );
}
