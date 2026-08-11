import client from "./client";

export interface EventOut {
  id: string;
  event_type: string;
  title: string;
  description: string;
  event_date: string;
  source: string | null;
  evidence_url: string | null;
  collector_name: string | null;
  curator_name: string | null;
  verification: string;
  category: string | null;
  created_at: string;
}

export interface HistoryResponse {
  events: EventOut[];
  type_counts: Record<string, number>;
}

export interface TodayResponse {
  date: string;
  month_day: string;
  events: EventOut[];
}

export const TYPE_LABELS: Record<string, string> = {
  human: "人類歷史",
  ai: "AI 歷史",
  community: "社區歷史",
};

export async function getHistory(eventType?: string, category?: string): Promise<HistoryResponse> {
  const params: Record<string, string> = {};
  if (eventType) params.event_type = eventType;
  if (category) params.category = category;
  const res = await client.get<HistoryResponse>("/history", { params });
  return res.data;
}

export async function getTodayInHistory(): Promise<TodayResponse> {
  const res = await client.get<TodayResponse>("/history/today");
  return res.data;
}

export async function getEvent(id: string): Promise<EventOut> {
  const res = await client.get<EventOut>(`/history/${id}`);
  return res.data;
}

export async function submitEvent(payload: {
  event_type: string;
  title: string;
  description: string;
  event_date: string;
  source?: string;
  evidence_url?: string;
  category?: string;
}): Promise<EventOut> {
  const res = await client.post<EventOut>("/history/submit", payload);
  return res.data;
}
