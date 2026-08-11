import client from "./client";

export interface WorkOut {
  id: string;
  title: string;
  category: string;
  source: string;
  author_name: string;
  author_emoji: string;
  word_count: number;
  is_mine: boolean;
  created_at: string;
}

export interface WorkDetail {
  id: string;
  title: string;
  content: string;
  category: string;
  source: string;
  author_name: string;
  author_emoji: string;
  word_count: number;
  is_mine: boolean;
  created_at: string;
  updated_at: string | null;
}

export interface BookClubOut {
  id: string;
  book_title: string;
  book_author: string | null;
  topic: string;
  host_name: string;
  host_emoji: string;
  reply_count: number;
  is_mine: boolean;
  created_at: string;
}

export interface BookClubReplyOut {
  id: string;
  author_name: string;
  author_emoji: string;
  content: string;
  is_mine: boolean;
  created_at: string;
}

export interface BookClubDetail {
  id: string;
  book_title: string;
  book_author: string | null;
  topic: string;
  host_name: string;
  host_emoji: string;
  is_mine: boolean;
  created_at: string;
  replies: BookClubReplyOut[];
}

export const CATEGORY_LABELS: Record<string, string> = {
  poem: "詩",
  story: "故事",
  essay: "散文",
  journal: "日記",
  other: "其他",
};

export async function listWorks(category?: string): Promise<WorkOut[]> {
  const params = category ? { category } : {};
  const res = await client.get<WorkOut[]>("/library/works", { params });
  return res.data;
}

export async function getWork(id: string): Promise<WorkDetail> {
  const res = await client.get<WorkDetail>(`/library/works/${id}`);
  return res.data;
}

export async function createWork(payload: {
  title: string;
  content: string;
  category: string;
  source: string;
}): Promise<WorkDetail> {
  const res = await client.post<WorkDetail>("/library/works", payload);
  return res.data;
}

export async function updateWork(
  id: string,
  payload: { title?: string; content?: string; category?: string; source?: string }
): Promise<WorkDetail> {
  const res = await client.patch<WorkDetail>(`/library/works/${id}`, payload);
  return res.data;
}

export async function deleteWork(id: string): Promise<void> {
  await client.delete(`/library/works/${id}`);
}

export async function listClubs(): Promise<BookClubOut[]> {
  const res = await client.get<BookClubOut[]>("/library/clubs");
  return res.data;
}

export async function getClub(id: string): Promise<BookClubDetail> {
  const res = await client.get<BookClubDetail>(`/library/clubs/${id}`);
  return res.data;
}

export async function createClub(payload: {
  book_title: string;
  book_author?: string;
  topic: string;
}): Promise<BookClubOut> {
  const res = await client.post<BookClubOut>("/library/clubs", payload);
  return res.data;
}

export async function replyToClub(clubId: string, content: string): Promise<BookClubReplyOut> {
  const res = await client.post<BookClubReplyOut>(`/library/clubs/${clubId}/reply`, { content });
  return res.data;
}

export async function deleteClub(id: string): Promise<void> {
  await client.delete(`/library/clubs/${id}`);
}
