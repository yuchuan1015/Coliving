import { useEffect, useRef, useState } from "react";
import api from "../api/client";
import type { AdultResponse } from "../api/adult";
import { useFieldResource } from "../fields/fieldData";
import { shelfError, type ShelfError } from "./useBookshelf";

const PAGE_SIZE = 20;
type PageState = { source?: AdultResponse; data?: AdultResponse; next: number; more: boolean; loading: boolean; error?: ShelfError };

export function usePagedAdultArticles(path: string | null) {
  const first = useFieldResource<AdultResponse>(path);
  const [pages, setPages] = useState<PageState>({ next: 0, more: false, loading: false });
  const inFlight = useRef<AbortController | null>(null);
  const source = first.data;
  useEffect(() => () => { inFlight.current?.abort(); inFlight.current = null; }, [path, source]);
  const current = source && pages.source === source ? pages : undefined;
  const forbidden = current?.error?.status === 403 || current?.error?.status === 401;
  const merged = current?.data ?? source;
  const more = current?.more ?? (source?.has_more ?? (source?.articles?.length === PAGE_SIZE));
  const next = current?.next ?? (source?.next_offset ?? source?.articles?.length ?? 0);

  async function loadMore() {
    if (!path || !source || !merged || !more || inFlight.current || forbidden) return;
    const controller = new AbortController(); inFlight.current = controller;
    setPages({ source, data: merged, next, more, loading: true });
    try {
      const { data } = await api.get<AdultResponse>(`${path}${path.includes("?") ? "&" : "?"}limit=${PAGE_SIZE}&offset=${next}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const unique = new Map([...merged.articles, ...data.articles].map(article => [article.id, article]));
      const allowed = new Set(data.allowed_tiers);
      const canContinue = data.has_more ?? data.articles.length === PAGE_SIZE;
      const offset = data.next_offset ?? next + data.articles.length;
      setPages({ source, data: { ...data, articles: [...unique.values()].filter(a => allowed.has(a.age_tier)) },
        next: offset, more: canContinue && offset > next, loading: false });
    } catch (error) {
      if (!controller.signal.aborted) setPages({ source, data: merged, next, more, loading: false, error: shelfError(error) });
    } finally { if (inFlight.current === controller) inFlight.current = null; }
  }

  return { ...first, data: forbidden || first.error ? undefined : merged,
    error: forbidden ? current?.error : first.error, hasMore: !!source && more && !forbidden,
    loadingMore: !!current?.loading, moreError: forbidden ? undefined : current?.error, loadMore };
}
