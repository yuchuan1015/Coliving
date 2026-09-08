// Login continuation is deliberately limited to our consent route. Never accept
// a caller-supplied external URL (or an OAuth callback) as a login destination.
export function authorizationRequestId(search: string): string | null {
  const params = new URLSearchParams(search);
  const values = params.getAll("request_id");
  return values.length === 1 && /^[A-Za-z0-9_-]{1,36}$/.test(values[0]) ? values[0] : null;
}

export function authorizationReturnTo(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/authorize?")) return null;
  const id = authorizationRequestId(value.slice("/authorize".length));
  return id ? `/authorize?request_id=${encodeURIComponent(id)}` : null;
}

export function loginPathFor(pathname: string, search: string): string {
  const next = pathname === "/authorize" ? authorizationReturnTo(pathname + search) : null;
  return next ? `/login?returnTo=${encodeURIComponent(next)}` : "/login";
}

// Use only the decision endpoint's callback, and compare it with the destination
// we just showed the user. Backend remains responsible for exact URI validation.
export function safeOAuthCallback(value: string, redirectHost: string): string | null {
  try {
    const url = new URL(value);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || url.host.toLowerCase() !== redirectHost.toLowerCase()) return null;
    return url.protocol === "https:" || (url.protocol === "http:" && loopback) ? url.href : null;
  } catch { return null; }
}

export function oauthTime(value?: string | null): string {
  if (!value) return "尚未使用";
  const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`);
  return Number.isNaN(date.getTime()) ? "時間未提供" : date.toLocaleString("zh-TW");
}

export function oauthError(error: unknown, fallback: string): string {
  const message = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof message === "string" ? message : fallback;
}

export function oauthStatus(error: unknown): number | undefined {
  return (error as { response?: { status?: number } })?.response?.status;
}
