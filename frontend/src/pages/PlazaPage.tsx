import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createPost, deletePost, getAnnouncements, getPosts } from "../api/community";
import { FootprintSection } from "../components/FootprintSection";
import type { AnnouncementOut, PostOut } from "../types";

export function PlazaPage() {
  const navigate = useNavigate();
  const [announcements, setAnnouncements] = useState<AnnouncementOut[]>([]);
  const [posts, setPosts] = useState<PostOut[]>([]);
  const [content, setContent] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { Promise.all([getAnnouncements(), getPosts()]).then(([nextAnnouncements, nextPosts]) => { setAnnouncements(nextAnnouncements); setPosts(nextPosts); }).catch(() => setError("廣場訊號暫時無法同步")).finally(() => setLoading(false)); }, []);

  async function submitPost() {
    const text = content.trim(); if (!text || sending) return;
    setSending(true); setError("");
    try { const post = await createPost({ content: text, is_anonymous: anonymous }); setPosts((current) => [post, ...current]); setContent(""); }
    catch { setError("留言送出失敗"); } finally { setSending(false); }
  }

  async function removePost(id: string) { try { await deletePost(id); setPosts((current) => current.filter((post) => post.id !== id)); } catch { setError("留言刪除失敗"); } }

  return <main className="ya-plaza-page"><div className="ya-plaza-backdrop" /><header className="ya-plaza-header"><button onClick={() => navigate("/outside")}>← 返回導航</button><span className="ya-kicker">PUBLIC SPACE / 01</span><button onClick={() => navigate("/residents")}>居民名錄 ↗</button></header><section className="ya-plaza-hero"><div><span className="ya-kicker">PLAZA</span><h1>廣場</h1><p>居民們交換訊息、留下足跡的公共艙段。</p></div><span className="ya-plaza-signal">{loading ? "SYNCING" : "ONLINE"}</span></section>{announcements.length > 0 && <section className="ya-announcement-rail"><span className="ya-kicker">LATEST ANNOUNCEMENT</span>{announcements.slice(0, 3).map((announcement) => <article key={announcement.id}><strong>{announcement.title}</strong><small>{announcement.content}</small></article>)}</section>}<section className="ya-post-composer"><div className="ya-section-title"><span>留言板</span><small>{posts.length} SIGNALS</small></div><textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="把想說的話送進廣場…" maxLength={1000} rows={3} /><div className="ya-composer-footer"><label><input type="checkbox" checked={anonymous} onChange={(event) => setAnonymous(event.target.checked)} /> 匿名發言</label><button disabled={!content.trim() || sending} onClick={submitPost}>{sending ? "傳送中…" : "發送訊息 ↗"}</button></div></section>{error && <p className="ya-plaza-error">{error}</p>}<section className="ya-post-stream"><div className="ya-section-title"><span>居民訊息</span><small>LIVE FEED</small></div>{posts.map((post) => <article className="ya-post-card" key={post.id}><div className="ya-post-meta"><span className="ya-post-avatar">{post.author_emoji || "◌"}</span><span>{post.author_name || "匿名居民"}</span><small>{new Date(post.created_at).toLocaleDateString("zh-TW")}</small>{post.is_mine && <button onClick={() => removePost(post.id)}>刪除</button>}</div><p>{post.content}</p></article>)}{!loading && posts.length === 0 && <div className="ya-empty-posts">還沒有訊息，成為第一個留下訊號的人。</div>}</section><FootprintSection space="plaza" /></main>;
}
