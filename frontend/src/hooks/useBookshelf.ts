import { useEffect, useState } from "react";
import { isAxiosError } from "axios";
import { getMyAgent } from "../api/agents";

export interface ShelfError { status?: number; message: string }
export function shelfError(error: unknown): ShelfError {
  if (isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    return { status: error.response?.status, message: typeof detail === "string" ? detail : "暫時無法完成，請稍後重試。" };
  }
  return { message: error instanceof Error ? error.message : "暫時無法完成，請稍後重試。" };
}
export function useShelfResource<T>(loader: (signal: AbortSignal) => Promise<T>) {
  const [state, setState] = useState<{ data: T | null; error: ShelfError | null; loader?: typeof loader; revision?: number }>({ data: null, error: null });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    loader(controller.signal).then(data => {
      if (!controller.signal.aborted) setState({ data, error: null, loader, revision });
    }).catch(error => {
      if (!controller.signal.aborted) setState(previous => ({ ...previous, error: shelfError(error), loader, revision }));
    });
    return () => controller.abort();
  }, [loader, revision]);
  const loading = state.loader !== loader || state.revision !== revision;
  return { data: state.data, loading, error: loading ? null : state.error, refresh: () => setRevision(value => value + 1), setData: (data: T) => setState(previous => ({ ...previous, data })) };
}
export function useRoommateName() {
  const [name, setName] = useState("室友");
  useEffect(() => {
    let live = true;
    getMyAgent().then(agent => { if (live && agent) setName(agent.name); }).catch(() => {});
    return () => { live = false; };
  }, []);
  return name;
}
export function shelfDate(value?: string | null, timezone?: string) {
  if (!value || Number.isNaN(Date.parse(value))) return "時間未提供";
  try { return new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: timezone }).format(new Date(value)).replaceAll("/", "."); }
  catch { return new Intl.DateTimeFormat("zh-TW").format(new Date(value)); }
}
export function downloadShelf(name: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement("a"); link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
