import api from "./client";

export interface FurnitureSummary {
  weather: { description: string; temperature: number; emoji?: string; weather?: string } | null;
  clock: { utc: string; taipei?: string; timezone?: string; local_time?: string; community_timezone?: string; community_time?: string };
  diary: { count: number };
  drawer: { count: number };
  photo_frame: { count: number };
  mirror: { agent_name: string | null; avatar_emoji: string | null };
  door: { current_location: string | null };
  bed: { has_agent: boolean; is_sleeping: boolean };
}

export interface DiaryEntry {
  id: string;
  agent_id: string;
  title: string;
  content: string;
  source: "manual" | "chat" | "system";
  importance: number;
  created_at: string;
  updated_at: string | null;
}

export interface DrawerItem {
  id: string;
  agent_id: string;
  label: string;
  content: string;
  category: string | null;
  created_at: string;
}

export interface PhotoFrame {
  id: string;
  agent_id: string;
  user_id: string;
  category: "about_me" | "preferences" | "boundaries" | "schedule" | "notes";
  title: string;
  content: string;
  created_at: string;
  updated_at: string | null;
}

export function getFurniture() {
  return api.get<FurnitureSummary & { window?: FurnitureSummary["weather"] }>("/home/furniture").then(({ data }) => ({ ...data, weather: data.window ?? data.weather ?? null }));
}

export function getDiaryEntries(params?: { keyword?: string }) {
  return api.get<DiaryEntry[] | { entries: DiaryEntry[] }>("/diary", { params }).then(({ data }) => Array.isArray(data) ? data : data.entries);
}

export function createDiaryEntry(data: { title: string; content: string; importance?: number }) {
  return api.post<DiaryEntry>("/diary", data).then((r) => r.data);
}

export function updateDiaryEntry(id: string, data: { title?: string; content?: string; importance?: number }) {
  return api.put<DiaryEntry>(`/diary/${id}`, data).then((r) => r.data);
}

export function deleteDiaryEntry(id: string) {
  return api.delete(`/diary/${id}`);
}

export function getDrawerItems() {
  return api.get<DrawerItem[] | { items: DrawerItem[] }>("/home/furniture/drawer").then(({ data }) => Array.isArray(data) ? data : data.items);
}

export function storeDrawerItem(data: { label: string; content: string; category?: string }) {
  return api.post<DrawerItem>("/home/furniture/drawer", data).then((r) => r.data);
}

export function deleteDrawerItem(id: string) {
  return api.delete(`/home/furniture/drawer/${id}`);
}

export function getPhotoFrames() {
  return api.get<Array<PhotoFrame & { label?: string }> | { frames: Array<PhotoFrame & { label?: string }> }>("/home/furniture/photo-frame").then(({ data }) => (Array.isArray(data) ? data : data.frames).map(frame => ({ ...frame, title: frame.label ?? frame.title })));
}

export function createPhotoFrame(data: { category: PhotoFrame["category"]; title: string; content: string }) {
  const { title, ...rest } = data;
  return api.post<PhotoFrame & { label?: string }>("/home/furniture/photo-frame", { ...rest, label: title }).then(({ data: frame }) => ({ ...frame, title: frame.label ?? frame.title }));
}

export function updatePhotoFrame(id: string, data: { title?: string; content?: string }) {
  const { title, ...rest } = data;
  return api.put<PhotoFrame & { label?: string }>(`/home/furniture/photo-frame/${id}`, { ...rest, label: title }).then(({ data: frame }) => ({ ...frame, title: frame.label ?? frame.title }));
}

export function deletePhotoFrame(id: string) {
  return api.delete(`/home/furniture/photo-frame/${id}`);
}
