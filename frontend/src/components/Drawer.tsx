import { useEffect } from "react";

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  side: "left" | "right";
  title?: string;
  children: React.ReactNode;
}

export function Drawer({ open, onClose, side, title, children }: DrawerProps) {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const translateClosed =
    side === "right" ? "translateX(100%)" : "translateX(-100%)";

  return (
    <div
      className="fixed inset-0 z-50"
      style={{ pointerEvents: open ? "auto" : "none" }}
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="absolute inset-0 transition-opacity duration-200"
        style={{
          background: "rgba(0, 0, 0, 0.4)",
          opacity: open ? 1 : 0,
        }}
      />

      {/* Panel */}
      <div
        className="absolute top-0 bottom-0 flex flex-col overflow-y-auto transition-transform duration-200"
        style={{
          [side]: 0,
          width: "min(85vw, 360px)",
          background: "var(--bg)",
          borderLeft: side === "right" ? "1px solid var(--border)" : undefined,
          borderRight: side === "left" ? "1px solid var(--border)" : undefined,
          transform: open ? "translateX(0)" : translateClosed,
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-7 pb-4">
          <span
            className="text-[13px] font-semibold uppercase tracking-widest"
            style={{ color: "var(--ink-soft)" }}
          >
            {title}
          </span>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-[13px] transition-colors"
            style={{ color: "var(--ink-soft)" }}
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 px-4 pb-8">{children}</div>
      </div>
    </div>
  );
}

interface DrawerItemProps {
  title: string;
  subtitle: string;
  onClick: () => void;
  active?: boolean;
  badge?: number;
}

export function DrawerItem({
  title,
  subtitle,
  onClick,
  active,
  badge,
}: DrawerItemProps) {
  return (
    <button
      onClick={onClick}
      className="mb-1.5 w-full rounded-lg px-4 py-3 text-left transition-colors"
      style={{
        background: active ? "var(--surface-dim)" : "transparent",
      }}
    >
      <div className="flex items-center justify-between">
        <span
          className="text-[14px] font-medium"
          style={{ color: active ? "var(--ink)" : "var(--ink)" }}
        >
          {title}
        </span>
        {badge !== undefined && badge > 0 && (
          <span
            className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold"
            style={{ background: "var(--ink)", color: "var(--bg)" }}
          >
            {badge}
          </span>
        )}
      </div>
      <span
        className="mt-0.5 block text-[12px]"
        style={{ color: "var(--ink-soft)" }}
      >
        {subtitle}
      </span>
    </button>
  );
}
