import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import "../photo-album.css";
import "../cabin-utility.css";

/** The album's approved cabin theme, shared by the remaining furniture pages. */
export function CabinUtilityShell({ title, code, children }: { title: string; code: string; children: ReactNode }) {
  const navigate = useNavigate();
  return <main className="photo-album cabin-utility">
    <div className="photo-album-stack">
      <header className="photo-album-header">
        <div><p className="photo-eyebrow">CABIN / {code}</p><h1>{title}</h1></div>
        <button type="button" onClick={() => navigate("/")}>← 返回艙室</button>
      </header>
      {children}
    </div>
  </main>;
}

export function CabinUtilityEmpty({ title, children, loading = false }: { title: string; children?: ReactNode; loading?: boolean }) {
  return <div className="photo-panel utility-empty" role={loading ? "status" : undefined}>
    <span className="utility-empty-mark" aria-hidden="true">◇</span>
    <h2>{title}</h2>
    {children && <p>{children}</p>}
  </div>;
}
