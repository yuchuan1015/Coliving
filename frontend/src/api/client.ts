import axios, { type InternalAxiosRequestConfig } from "axios";
import { loginPathFor } from "../oauth-navigation";

const TOKEN_KEY = "coliving_access_token";
const REFRESH_KEY = "coliving_refresh_token";

const api = axios.create({ baseURL: "/api" });

let sessionVersion = 0;
let refreshingVersion: number | null = null;
type SessionRequestConfig = InternalAxiosRequestConfig & { _sessionVersion?: number; _retry?: boolean };
let pendingQueue: Array<{
  version: number;
  resolve: (token: string) => void;
  reject: (err: unknown) => void;
}> = [];

function processQueue(version: number, token: string | null, error?: unknown) {
  const pending = pendingQueue.filter(item => item.version === version);
  pendingQueue = pendingQueue.filter(item => item.version !== version);
  pending.forEach(({ resolve, reject }) => {
    if (token) resolve(token);
    else reject(error);
  });
}

api.interceptors.request.use((config) => {
  const request = config as SessionRequestConfig;
  request._sessionVersion ??= sessionVersion;
  if (request._sessionVersion !== sessionVersion) throw new Error("Session changed");
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (!original || error.response?.status !== 401 || original._retry || (original._sessionVersion ?? sessionVersion) !== sessionVersion || /^\/auth\/(login|register|refresh)$/.test(original.url ?? "")) {
      return Promise.reject(error);
    }

    const version = sessionVersion;
    original._retry = true;
    if (refreshingVersion === version) {
      return new Promise((resolve, reject) => {
        pendingQueue.push({
          version,
          resolve: (token: string) => {
            if (version !== sessionVersion) { reject(new Error("Session changed")); return; }
            original.headers.Authorization = `Bearer ${token}`;
            resolve(api(original));
          },
          reject,
        });
      });
    }

    refreshingVersion = version;
    const refreshToken = localStorage.getItem(REFRESH_KEY);
    const isCurrentSession = () => version === sessionVersion && refreshToken === localStorage.getItem(REFRESH_KEY);

    try {
      if (!refreshToken) throw new Error("No refresh token");

      const { data } = await axios.post("/api/auth/refresh", {
        refresh_token: refreshToken,
      });

      if (!isCurrentSession()) throw new Error("Session changed");
      localStorage.setItem(TOKEN_KEY, data.access_token);
      localStorage.setItem(REFRESH_KEY, data.refresh_token);

      processQueue(version, data.access_token);
      original.headers.Authorization = `Bearer ${data.access_token}`;
      return api(original);
    } catch (err) {
      processQueue(version, null, err);
      if (isCurrentSession()) {
        clearTokens();
        window.location.href = loginPathFor(window.location.pathname, window.location.search);
      }
      return Promise.reject(err);
    } finally {
      if (refreshingVersion === version) refreshingVersion = null;
    }
  }
);

export function setTokens(access: string, refresh: string) {
  sessionVersion++;
  localStorage.setItem(TOKEN_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}

export function clearTokens() {
  sessionVersion++;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export function getAccessToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export default api;
