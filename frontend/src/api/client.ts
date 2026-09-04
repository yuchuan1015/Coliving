import axios from "axios";

const TOKEN_KEY = "coliving_access_token";
const REFRESH_KEY = "coliving_refresh_token";

const api = axios.create({ baseURL: "/api" });

let isRefreshing = false;
let pendingQueue: Array<{
  resolve: (token: string) => void;
  reject: (err: unknown) => void;
}> = [];

function processQueue(token: string | null, error?: unknown) {
  pendingQueue.forEach(({ resolve, reject }) => {
    if (token) resolve(token);
    else reject(error);
  });
  pendingQueue = [];
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status !== 401 || original._retry) {
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        pendingQueue.push({
          resolve: (token: string) => {
            original.headers.Authorization = `Bearer ${token}`;
            resolve(api(original));
          },
          reject,
        });
      });
    }

    original._retry = true;
    isRefreshing = true;

    try {
      const refreshToken = localStorage.getItem(REFRESH_KEY);
      if (!refreshToken) throw new Error("No refresh token");

      const { data } = await axios.post("/api/auth/refresh", {
        refresh_token: refreshToken,
      });

      localStorage.setItem(TOKEN_KEY, data.access_token);
      localStorage.setItem(REFRESH_KEY, data.refresh_token);

      processQueue(data.access_token);
      original.headers.Authorization = `Bearer ${data.access_token}`;
      return api(original);
    } catch (err) {
      processQueue(null, err);
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(REFRESH_KEY);
      window.location.href = "/login";
      return Promise.reject(err);
    } finally {
      isRefreshing = false;
    }
  }
);

export function setTokens(access: string, refresh: string) {
  localStorage.setItem(TOKEN_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}

export function clearTokens() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export function getAccessToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export default api;
