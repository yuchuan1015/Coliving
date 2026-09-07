import { useEffect, useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ShelfError } from "../hooks/useBookshelf";
import "../bookshelf.css";

export function ShelfShell({ children }: { children: ReactNode }) {
  return <main className="bookshelf-ui"><div className="shell">{children}</div></main>;
}
export function ShelfHeader({ title, to = "/home/library", label = "返回書架" }: { title: string; to?: string; label?: string }) {
  return <header className="heading"><h1>{title}</h1><Link className="back" to={to}>← {label}</Link></header>;
}
export function ShelfProblem({ error, onRetry }: { error: ShelfError; onRetry?: () => void }) {
  return <div className="shelf-error" role="alert"><p>{error.message}</p>{error.status === 403 && <Link to="/adopt">先連結室友 →</Link>}{onRetry && <button type="button" onClick={onRetry}>重新載入</button>}</div>;
}
export function ShelfDialog({ title, busy = false, children, onClose }: { title: string; busy?: boolean; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => { previous?.focus(); };
  }, []);
  return <dialog ref={ref} className="bookshelf-ui shelf-dialog" aria-labelledby="shelf-dialog-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <h2 id="shelf-dialog-title">{title}</h2>{children}
  </dialog>;
}
export function ShelfTrash() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7" /></svg>;
}
