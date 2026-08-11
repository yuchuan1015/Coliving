import client from "./client";

export interface FootprintOut {
  id: string;
  author_name: string;
  author_emoji: string;
  content: string;
  mood: string;
  space: string;
  is_mine: boolean;
  created_at: string;
}

export const MOODS = ["☀️", "🌧️", "🌙", "🍃", "❄️"] as const;

export async function listFootprints(space: string, limit = 30): Promise<FootprintOut[]> {
  const res = await client.get<FootprintOut[]>("/footprints", { params: { space, limit } });
  return res.data;
}

export async function createFootprint(payload: {
  content: string;
  mood: string;
  space: string;
}): Promise<FootprintOut> {
  const res = await client.post<FootprintOut>("/footprints", payload);
  return res.data;
}

export async function deleteFootprint(id: string): Promise<void> {
  await client.delete(`/footprints/${id}`);
}
