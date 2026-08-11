/* Pixel-art style SVG furniture for the room. Santorini palette. */

const BLUE = "#1e4a7a";
const BLUE_LIGHT = "#5a9fd4";
const BLUE_SKY = "#87ceeb";
const WHITE = "#ffffff";
const SAND = "#f5f0e8";
const TERRACOTTA = "#c2613a";
const TERRACOTTA_DARK = "#a04e2e";
const WOOD = "#8b6d4a";
const WOOD_DARK = "#6b4f30";
const WOOD_LIGHT = "#c4a67a";
const LINEN = "#e8ddd0";

export function WindowSvg() {
  return (
    <svg viewBox="0 0 48 40" fill="none" width="100%" height="100%">
      {/* Frame */}
      <rect x="4" y="2" width="40" height="34" rx="2" fill={WHITE} stroke={WOOD} strokeWidth="2" />
      {/* Sky & sea */}
      <rect x="7" y="5" width="34" height="14" fill={BLUE_SKY} />
      <rect x="7" y="19" width="34" height="14" fill={BLUE} />
      {/* Horizon shimmer */}
      <rect x="7" y="18" width="34" height="2" fill={BLUE_LIGHT} opacity="0.5" />
      {/* Cross frame */}
      <rect x="23" y="5" width="2" height="28" fill={WHITE} />
      <rect x="7" y="18" width="34" height="2" fill={WHITE} />
      {/* Sill */}
      <rect x="2" y="34" width="44" height="4" rx="1" fill={WOOD_LIGHT} />
    </svg>
  );
}

export function ClockSvg() {
  const now = new Date();
  const h = now.getHours() % 12;
  const m = now.getMinutes();
  const hAngle = (h + m / 60) * 30 - 90;
  const mAngle = m * 6 - 90;
  return (
    <svg viewBox="0 0 32 36" fill="none" width="100%" height="100%">
      {/* Body */}
      <rect x="8" y="0" width="16" height="28" rx="3" fill={WOOD} />
      <rect x="9" y="1" width="14" height="26" rx="2" fill={WOOD_LIGHT} />
      {/* Face */}
      <circle cx="16" cy="12" r="8" fill={WHITE} stroke={WOOD_DARK} strokeWidth="1.5" />
      {/* Hour hand */}
      <line
        x1="16" y1="12"
        x2={16 + 4 * Math.cos((hAngle * Math.PI) / 180)}
        y2={12 + 4 * Math.sin((hAngle * Math.PI) / 180)}
        stroke={WOOD_DARK} strokeWidth="1.5" strokeLinecap="round"
      />
      {/* Minute hand */}
      <line
        x1="16" y1="12"
        x2={16 + 6 * Math.cos((mAngle * Math.PI) / 180)}
        y2={12 + 6 * Math.sin((mAngle * Math.PI) / 180)}
        stroke={WOOD_DARK} strokeWidth="1" strokeLinecap="round"
      />
      <circle cx="16" cy="12" r="1" fill={TERRACOTTA} />
      {/* Pendulum area */}
      <rect x="13" y="20" width="6" height="6" fill={WOOD} rx="1" />
      <circle cx="16" cy="23" r="2" fill={TERRACOTTA} />
      {/* Base */}
      <rect x="6" y="28" width="20" height="4" rx="1" fill={WOOD} />
    </svg>
  );
}

export function DiarySvg() {
  return (
    <svg viewBox="0 0 32 36" fill="none" width="100%" height="100%">
      {/* Book body */}
      <rect x="4" y="4" width="24" height="28" rx="2" fill={TERRACOTTA} />
      <rect x="4" y="4" width="24" height="28" rx="2" fill={TERRACOTTA_DARK} opacity="0.3" />
      {/* Spine */}
      <rect x="4" y="4" width="4" height="28" fill={TERRACOTTA_DARK} />
      {/* Pages */}
      <rect x="9" y="6" width="17" height="24" rx="1" fill={LINEN} />
      {/* Lines */}
      <line x1="11" y1="12" x2="24" y2="12" stroke={SAND} strokeWidth="0.5" />
      <line x1="11" y1="16" x2="24" y2="16" stroke={SAND} strokeWidth="0.5" />
      <line x1="11" y1="20" x2="24" y2="20" stroke={SAND} strokeWidth="0.5" />
      <line x1="11" y1="24" x2="20" y2="24" stroke={SAND} strokeWidth="0.5" />
      {/* Ribbon */}
      <rect x="22" y="4" width="2" height="10" fill={BLUE} />
      <polygon points="22,14 24,14 23,17" fill={BLUE} />
    </svg>
  );
}

export function DrawerSvg() {
  return (
    <svg viewBox="0 0 36 40" fill="none" width="100%" height="100%">
      {/* Cabinet body */}
      <rect x="2" y="4" width="32" height="32" rx="2" fill={WOOD} />
      <rect x="3" y="5" width="30" height="30" rx="1" fill={WOOD_LIGHT} />
      {/* Top drawer */}
      <rect x="5" y="7" width="26" height="8" rx="1" fill={WOOD} stroke={WOOD_DARK} strokeWidth="0.5" />
      <circle cx="18" cy="11" r="1.5" fill={TERRACOTTA} />
      {/* Middle drawer */}
      <rect x="5" y="17" width="26" height="8" rx="1" fill={WOOD} stroke={WOOD_DARK} strokeWidth="0.5" />
      <circle cx="18" cy="21" r="1.5" fill={TERRACOTTA} />
      {/* Bottom drawer */}
      <rect x="5" y="27" width="26" height="8" rx="1" fill={WOOD} stroke={WOOD_DARK} strokeWidth="0.5" />
      <circle cx="18" cy="31" r="1.5" fill={TERRACOTTA} />
      {/* Legs */}
      <rect x="5" y="36" width="3" height="4" fill={WOOD_DARK} />
      <rect x="28" y="36" width="3" height="4" fill={WOOD_DARK} />
    </svg>
  );
}

export function MirrorSvg() {
  return (
    <svg viewBox="0 0 28 40" fill="none" width="100%" height="100%">
      {/* Frame */}
      <ellipse cx="14" cy="16" rx="11" ry="14" fill={WOOD} />
      {/* Glass */}
      <ellipse cx="14" cy="16" rx="9" ry="12" fill={BLUE_SKY} opacity="0.4" />
      <ellipse cx="14" cy="16" rx="9" ry="12" fill={WHITE} opacity="0.3" />
      {/* Shine */}
      <ellipse cx="10" cy="12" rx="2" ry="4" fill={WHITE} opacity="0.5" transform="rotate(-15 10 12)" />
      {/* Hook */}
      <rect x="13" y="0" width="2" height="4" fill={WOOD_DARK} />
    </svg>
  );
}

export function DoorSvg() {
  return (
    <svg viewBox="0 0 32 48" fill="none" width="100%" height="100%">
      {/* Door frame */}
      <rect x="2" y="0" width="28" height="48" rx="1" fill={WOOD_DARK} />
      {/* Door */}
      <rect x="4" y="2" width="24" height="44" rx="1" fill={BLUE} />
      {/* Arch top (Santorini style) */}
      <path d="M4 16 Q16 -2 28 16" fill={BLUE} />
      <path d="M4 16 Q16 -2 28 16" fill="none" stroke={WHITE} strokeWidth="1" />
      {/* Panels */}
      <rect x="7" y="18" width="18" height="10" rx="1" fill={BLUE} stroke={WHITE} strokeWidth="0.5" opacity="0.8" />
      <rect x="7" y="32" width="18" height="10" rx="1" fill={BLUE} stroke={WHITE} strokeWidth="0.5" opacity="0.8" />
      {/* Handle */}
      <circle cx="23" cy="28" r="2" fill={TERRACOTTA} />
      <circle cx="23" cy="28" r="1" fill={TERRACOTTA_DARK} />
    </svg>
  );
}

export function BedSvg() {
  return (
    <svg viewBox="0 0 56 36" fill="none" width="100%" height="100%">
      {/* Frame */}
      <rect x="0" y="10" width="56" height="22" rx="2" fill={WOOD} />
      {/* Mattress */}
      <rect x="2" y="8" width="52" height="18" rx="3" fill={WHITE} />
      {/* Sheet */}
      <rect x="2" y="12" width="52" height="14" rx="2" fill={BLUE_LIGHT} opacity="0.3" />
      <rect x="2" y="12" width="52" height="14" rx="2" fill={LINEN} />
      {/* Blanket (folded) */}
      <rect x="18" y="12" width="36" height="14" rx="2" fill={BLUE} opacity="0.7" />
      {/* Pillow */}
      <rect x="4" y="10" width="16" height="10" rx="4" fill={WHITE} />
      <rect x="4" y="10" width="16" height="10" rx="4" stroke={SAND} strokeWidth="0.5" />
      {/* Headboard */}
      <rect x="0" y="4" width="4" height="28" rx="1" fill={WOOD_DARK} />
      {/* Legs */}
      <rect x="0" y="30" width="4" height="6" fill={WOOD_DARK} />
      <rect x="52" y="30" width="4" height="6" fill={WOOD_DARK} />
    </svg>
  );
}

export function MailboxSvg() {
  return (
    <svg viewBox="0 0 28 40" fill="none" width="100%" height="100%">
      {/* Post */}
      <rect x="12" y="20" width="4" height="20" fill={WOOD} />
      {/* Box body */}
      <rect x="2" y="4" width="24" height="18" rx="2" fill={BLUE} />
      {/* Rounded top */}
      <path d="M2 10 Q14 -2 26 10" fill={BLUE} />
      {/* Slot */}
      <rect x="6" y="13" width="16" height="2" rx="1" fill={BLUE_LIGHT} opacity="0.5" />
      <rect x="8" y="13.5" width="12" height="1" fill={WHITE} opacity="0.3" />
      {/* Flag */}
      <rect x="24" y="6" width="2" height="12" fill={TERRACOTTA} />
      <polygon points="26,6 34,9 26,12" fill={TERRACOTTA} />
    </svg>
  );
}

export function BookshelfSvg() {
  return (
    <svg viewBox="0 0 40 44" fill="none" width="100%" height="100%">
      {/* Frame */}
      <rect x="2" y="2" width="36" height="40" rx="1" fill={WOOD} />
      <rect x="3" y="3" width="34" height="38" rx="1" fill={WOOD_LIGHT} />
      {/* Shelves */}
      <rect x="2" y="14" width="36" height="2" fill={WOOD} />
      <rect x="2" y="28" width="36" height="2" fill={WOOD} />
      {/* Top shelf books */}
      <rect x="5" y="4" width="4" height="10" rx="0.5" fill={BLUE} />
      <rect x="10" y="5" width="3" height="9" rx="0.5" fill={TERRACOTTA} />
      <rect x="14" y="4" width="5" height="10" rx="0.5" fill={WOOD_DARK} />
      <rect x="20" y="6" width="3" height="8" rx="0.5" fill={BLUE_LIGHT} />
      <rect x="24" y="4" width="4" height="10" rx="0.5" fill={TERRACOTTA_DARK} />
      <rect x="29" y="5" width="5" height="9" rx="0.5" fill={BLUE} />
      {/* Middle shelf books */}
      <rect x="5" y="17" width="5" height="11" rx="0.5" fill={TERRACOTTA} />
      <rect x="11" y="18" width="3" height="10" rx="0.5" fill={BLUE} />
      <rect x="15" y="17" width="4" height="11" rx="0.5" fill={WOOD_DARK} />
      <rect x="22" y="19" width="6" height="9" rx="0.5" fill={LINEN} />
      <rect x="29" y="17" width="4" height="11" rx="0.5" fill={BLUE_LIGHT} />
      {/* Bottom shelf — pot + books */}
      <rect x="5" y="31" width="4" height="9" rx="0.5" fill={BLUE} />
      <rect x="10" y="32" width="3" height="8" rx="0.5" fill={TERRACOTTA} />
      <circle cx="28" cy="36" r="4" fill={TERRACOTTA} />
      <line x1="28" y1="30" x2="28" y2="33" stroke="#5a8a3a" strokeWidth="1.5" />
      <circle cx="28" cy="30" r="2" fill="#5a8a3a" />
    </svg>
  );
}

export function PhotoFrameSvg() {
  return (
    <svg viewBox="0 0 24 28" fill="none" width="100%" height="100%">
      {/* Frame */}
      <rect x="1" y="1" width="22" height="26" rx="1" fill={WOOD} />
      {/* Mat */}
      <rect x="3" y="3" width="18" height="22" rx="0.5" fill={WHITE} />
      {/* "Photo" — abstract Santorini scene */}
      <rect x="4" y="4" width="16" height="20" fill={BLUE_SKY} />
      <rect x="4" y="14" width="16" height="10" fill={BLUE} opacity="0.5" />
      {/* Little buildings */}
      <rect x="6" y="10" width="4" height="8" fill={WHITE} />
      <rect x="11" y="8" width="3" height="10" fill={WHITE} />
      <rect x="15" y="11" width="4" height="7" fill={WHITE} />
      {/* Rooftops */}
      <rect x="6" y="9" width="4" height="2" rx="0.5" fill={BLUE} />
      <rect x="15" y="10" width="4" height="2" rx="0.5" fill={TERRACOTTA} />
    </svg>
  );
}

export function FloorTile() {
  return (
    <svg viewBox="0 0 40 40" width="40" height="40" fill="none" style={{ position: "absolute", inset: 0 }}>
      <rect width="20" height="20" fill="var(--surface-dim)" />
      <rect x="20" y="0" width="20" height="20" fill="var(--border-light)" />
      <rect x="0" y="20" width="20" height="20" fill="var(--border-light)" />
      <rect x="20" y="20" width="20" height="20" fill="var(--surface-dim)" />
    </svg>
  );
}
