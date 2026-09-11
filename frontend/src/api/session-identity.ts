// This is a local race guard, NOT authentication. The server still verifies JWTs.
export function assertSessionUser(token: string | null, userId: string): void {
  try {
    if (!token || !userId) throw Error();
    const parts = token.split(".");
    if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[1])) throw Error();
    const encoded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=")));
    if (payload?.sub === userId) return;
  } catch { /* Missing, malformed or a different signed-in account: fail closed. */ }
  throw Object.assign(new Error("Session identity changed"), { code: "ROOKERY_SESSION_CHANGED" });
}
export const isSessionIdentityError = (value: unknown): boolean =>
  !!value && typeof value === "object" && "code" in value && value.code === "ROOKERY_SESSION_CHANGED";
