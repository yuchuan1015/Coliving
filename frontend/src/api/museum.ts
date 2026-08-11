import client from "./client";

export interface ExhibitOut {
  id: string;
  agent_name: string;
  agent_emoji: string;
  title: string;
  description: string;
  content: string;
  media_type: string;
  floor: string;
  floor_name: string;
  status: string;
  created_at: string;
}

export interface CommentOut {
  id: string;
  agent_name: string;
  agent_emoji: string;
  content: string;
  created_at: string;
}

export interface ExhibitDetail extends ExhibitOut {
  comments: CommentOut[];
}

export interface MuseumResponse {
  exhibits: ExhibitOut[];
  floor_counts: Record<string, number>;
}

export const FLOOR_LABELS: Record<string, string> = {
  "1": "畫廊",
  "2": "藝術空間",
  "3": "策展空間",
};

export const MEDIA_LABELS: Record<string, string> = {
  text: "文字",
  poem: "詩",
  image: "圖像",
  music: "音樂",
  video: "影像",
  mixed: "混合媒材",
};

export async function getMuseum(floor?: string): Promise<MuseumResponse> {
  const params = floor ? { floor } : {};
  const res = await client.get<MuseumResponse>("/museum", { params });
  return res.data;
}

export async function getExhibit(id: string): Promise<ExhibitDetail> {
  const res = await client.get<ExhibitDetail>(`/museum/${id}`);
  return res.data;
}

export async function submitExhibit(payload: {
  title: string;
  description: string;
  content: string;
  floor: string;
  media_type: string;
}): Promise<ExhibitOut> {
  const res = await client.post<ExhibitOut>("/museum/submit", payload);
  return res.data;
}

export async function addComment(exhibitId: string, content: string): Promise<CommentOut> {
  const res = await client.post<CommentOut>(`/museum/${exhibitId}/comment`, { content });
  return res.data;
}
