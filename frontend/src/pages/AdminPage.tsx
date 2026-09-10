import { uiText, getUiLanguage } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CabinUtilityShell } from "../components/CabinUtilityShell";
import client from "../api/client";
import "../cabin-management.css";

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


function StatCard({ label, value, sub }: { label: string; value?: number | string | null; sub?: string }) {
  const display = typeof value === "number" && Number.isFinite(value) ? value.toLocaleString(getUiLanguage())
    : typeof value === "string" && value ? value : uiText("未取得");
  return <div className="photo-panel admin-stat">
    <span className="admin-stat-value">{display}</span>
    <span className="admin-stat-label">{label}</span>
    {sub && <span className="admin-stat-note">{sub}</span>}
  </div>;
}

export function AdminPage() {
  useUiLanguage();
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [denied, setDenied] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(""); setDenied(false); setStats(null);
    client.get<Stats>("/admin/stats")
      .then(res => {
        if (!res.data || typeof res.data !== "object" || Array.isArray(res.data)) throw Error("Invalid stats");
        if (active) setStats(res.data);
      })
      .catch(err => {
        if (!active) return;
        const forbidden = err?.response?.status === 403;
        setDenied(forbidden);
        setError(forbidden ? "需要管理員權限" : "暫時無法讀取系統資料，請稍後再試。");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);

  return <CabinUtilityShell title={uiText("系統儀表板")} code="SYSTEM">
    <div className="cabin-admin">
      {loading ? <section className="photo-panel"><p role="status">{uiText("正在讀取系統資料…")}</p></section>
        : error || !stats ? <section className="photo-panel admin-problem">
          <h2>{denied ? uiText("需要管理員權限") : uiText("系統資料暫時無法取得")}</h2>
          <p role="alert">{denied ? uiText("這裡只開放給管理員，請返回艙室。") : uiText(error || "暫時無法讀取系統資料，請稍後再試。")}</p>
          {!denied && <button type="button" onClick={() => setRevision(value => value + 1)}>{uiText("重新讀取")}</button>}
        </section> : <>
          <section className="photo-panel"><div className="utility-toolbar">
            <p className="management-lede">{uiText("社區營運概覽")}</p>
            <button type="button" onClick={() => navigate("/admin/dm-reports")}>{uiText("私訊檢舉審核 →")}</button>
            <button type="button" onClick={() => navigate("/admin/content-reviews")}>{uiText("親密中心投稿審核 →")}</button>
          </div></section>
          <section className="admin-section" aria-labelledby="admin-residents">
            <h2 id="admin-residents">{uiText("居民")}</h2>
            <div className="admin-stat-grid">
              <StatCard label={uiText("總用戶")} value={stats.residents?.total_users} />
              <StatCard label={uiText("活躍用戶")} value={stats.residents?.active_users} />
              <StatCard label={uiText("AI 室友")} value={stats.residents?.total_agents} />
            </div>
          </section>
          <section className="admin-section" aria-labelledby="admin-today">
            <h2 id="admin-today">{uiText("今日活動")}</h2>
            <div className="admin-stat-grid">
              <StatCard label={uiText("新留言")} value={stats.today?.posts} />
              <StatCard label={uiText("新作品")} value={stats.today?.works} />
              <StatCard label={uiText("公園打卡")} value={stats.today?.park_checkins} />
              <StatCard label={uiText("讀書會回覆")} value={stats.today?.club_replies} />
            </div>
          </section>
          <section className="admin-section" aria-labelledby="admin-content">
            <h2 id="admin-content">{uiText("內容總量")}</h2>
            <div className="admin-stat-grid">
              <StatCard label={uiText("留言")} value={stats.content?.posts}
                sub={Number.isFinite(stats.week?.posts) ? uiText`本週 +${stats.week.posts}` : undefined} />
              <StatCard label={uiText("作品")} value={stats.content?.works}
                sub={Number.isFinite(stats.week?.works) ? uiText`本週 +${stats.week.works}` : undefined} />
              <StatCard label={uiText("讀書會")} value={stats.content?.book_clubs}
                sub={Number.isFinite(stats.content?.book_club_replies) ? uiText`${stats.content.book_club_replies} 則回覆` : undefined} />
              <StatCard label={uiText("皮膚")} value={stats.content?.skins}
                sub={Number.isFinite(stats.content?.published_skins) ? uiText`${stats.content.published_skins} 個已發布` : undefined} />
              <StatCard label={uiText("公告")} value={stats.content?.announcements} />
            </div>
          </section>
          <section className="admin-section" aria-labelledby="admin-system">
            <h2 id="admin-system">{uiText("系統")}</h2>
            <div className="admin-stat-grid"><StatCard label={uiText("資料庫大小")} value={stats.system?.db_size} /></div>
          </section>
          <section className="admin-section" aria-labelledby="admin-recent">
            <h2 id="admin-recent">{uiText("最近入住")}</h2>
            <div className="photo-panel admin-resident-list">
              {!Array.isArray(stats.recent_users) ? <p>{uiText("最近入住資料未取得")}</p>
                : stats.recent_users.length === 0 ? <p>{uiText("目前沒有最近入住的居民。")}</p>
                : stats.recent_users.map((resident, index) => <div className="admin-resident-row" key={index}>
                  <div className="admin-resident-copy"><span>{resident.display_name}</span>
                    <time dateTime={resident.created_at}>{Number.isFinite(new Date(resident.created_at).getTime()) ? new Date(resident.created_at).toLocaleDateString(getUiLanguage()) : uiText("時間未取得")}</time>
                  </div>
                  <span className="photo-badge">{resident.is_active ? uiText("活躍") : uiText("停用")}</span>
                </div>)}
            </div>
          </section>
        </>}
    </div>
  </CabinUtilityShell>;
}
