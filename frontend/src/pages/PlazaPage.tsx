import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnnouncementCard } from "../components/AnnouncementCard";
import { PostCard } from "../components/PostCard";
import { PostComposer } from "../components/PostComposer";
import {
  createPost,
  deletePost,
  getAnnouncements,
  getPosts,
} from "../api/community";
import type { AnnouncementOut, PostOut } from "../types";

export function PlazaPage() {
  const navigate = useNavigate();
  const [announcements, setAnnouncements] = useState<AnnouncementOut[]>([]);
  const [posts, setPosts] = useState<PostOut[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const [anns, ps] = await Promise.all([getAnnouncements(), getPosts()]);
    setAnnouncements(anns);
    setPosts(ps);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const handlePost = async (content: string, isAnonymous: boolean) => {
    const newPost = await createPost({ content, is_anonymous: isAnonymous });
    setPosts((prev) => [newPost, ...prev]);
  };

  const handleDelete = async (id: string) => {
    await deletePost(id);
    setPosts((prev) => prev.filter((p) => p.id !== id));
  };

  return (
    <main className="mx-auto max-w-lg px-5 py-8 pb-24">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold" style={{ color: "var(--ink)" }}>
          廣場
        </h1>
        <button
          onClick={() => navigate("/residents")}
          className="rounded-lg px-3 py-1.5 text-xs"
          style={{ background: "var(--surface-dim)", color: "var(--accent)" }}
        >
          居民名錄
        </button>
      </div>

      {loading ? (
        <p style={{ color: "var(--ink-soft)" }}>載入中...</p>
      ) : (
        <>
          {announcements.length > 0 && (
            <section className="mb-8">
              <h2 className="mb-3 text-sm font-medium" style={{ color: "var(--ink-soft)" }}>
                公告
              </h2>
              <div className="space-y-3">
                {announcements.map((a) => (
                  <AnnouncementCard key={a.id} ann={a} />
                ))}
              </div>
            </section>
          )}

          <section>
            <h2 className="mb-3 text-sm font-medium" style={{ color: "var(--ink-soft)" }}>
              留言板
            </h2>
            <div className="mb-4">
              <PostComposer onSubmit={handlePost} />
            </div>
            <div className="space-y-3">
              {posts.map((p) => (
                <PostCard key={p.id} post={p} onDelete={handleDelete} />
              ))}
              {posts.length === 0 && (
                <p className="text-center text-sm" style={{ color: "var(--ink-soft)" }}>
                  還沒有人留言，來當第一個吧
                </p>
              )}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
