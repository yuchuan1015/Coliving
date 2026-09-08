import { useCallback, useEffect, useState } from "react";
import api from "../api/client";
import { shelfError, type ShelfError } from "../hooks/useBookshelf";

export const FIELDS = [
  ["ai-chat", "Proxima", "AI 私訊", 313.9, -1.9, 4.24, "home-cabin-realistic.png"],
  ["plaza", "Sirius", "廣場", 227.2, -8.9, 8.6, "orbital-lounge.png"],
  ["mail", "Altair", "郵驛", 47.7, -8.9, 16.7, "mail-station-realistic.png"],
  ["workshop", "Vega", "工坊", 67.4, 19.2, 25, "workbench-realistic.png"],
  ["library", "Arcturus", "圖書館", 15.1, 69.1, 36.7, "archive-realistic.png"],
  ["museum", "Capella", "美術館", 162.6, 4.6, 42.9, "orbital-gallery.png"],
  ["weilan", "Achernar", "微瀾", 290.8, -58.8, 139, "orbital-lounge.png"],
  ["health", "Spica", "女性健康中心", 316.1, 50.8, 250, "orbital-garden.png"],
  ["park", "Mira", "公園", 167.8, -58, 299, "orbital-garden.png"],
  ["history", "Thuban", "歷史館", 111, 51.4, 303, "archive-realistic.png"],
  ["adult", "Antares", "成人區", 351.9, 15.1, 550, "sleep-capsule-realistic.png"],
] as const;
export type FieldId = typeof FIELDS[number][0];
export function fieldTime(value?: string | null) {
  if (!value) return "時間未提供";
  // The API contract is UTC; older SQLite rows may lose their explicit offset.
  const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value) ? value + "Z" : value;
  return Number.isNaN(Date.parse(timestamp)) ? "時間未提供" : new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei" }).format(new Date(timestamp));
}
export const fieldQuery = (base: string, params: Record<string, string>) => { const q = new URLSearchParams(Object.entries(params).filter(([, value]) => value)); return base + (q.size ? `?${q}` : ""); };
export function safeLink(value: string | null | undefined) {
  if (!value || !/^(https?:\/\/|\/(?!\/))/i.test(value.trim())) return undefined;
  try { const url = new URL(value, window.location.origin); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined; } catch { return undefined; }
}
export function useFieldResource<T>(path: string | null) {
  const [revision, setRevision] = useState(0);
  const key = `${path}:${revision}`;
  const [state, setState] = useState<{ key: string; data?: T; error?: ShelfError }>({ key: "" });
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    api.get<T>(path, { signal: controller.signal }).then(({ data }) => { if (!controller.signal.aborted) setState({ key, data }); }).catch(error => { if (!controller.signal.aborted) setState({ key, error: shelfError(error) }); });
    return () => controller.abort();
  }, [path, key]);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  return { data: path && state.key === key ? state.data : undefined, error: path && state.key === key ? state.error : undefined, loading: !!path && state.key !== key, refresh };
}
export const formText = (data: FormData, key: string) => String(data.get(key) ?? "").trim();
