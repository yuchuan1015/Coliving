import api from "./client";

export interface FurnitureSummary {
  weather: { description: string; temperature: number; icon: string } | null;
  clock: { utc: string; taipei: string };
  diary_count: number;
  drawer_count: number;
  photo_frame_count: number;
  mirror: { name: string; avatar_emoji: string; persona: string } | null;
  door: { current_location: string | null };
  bed: { schedule_count: number };
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
  return api.get<FurnitureSummary>("/home/furniture").then((r) => r.data);
}

export function getDiaryEntries(params?: { keyword?: string }) {
  return api.get<DiaryEntry[]>("/diary", { params }).then((r) => r.data);
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
  return api.get<DrawerItem[]>("/home/furniture/drawer").then((r) => r.data);
}

export function storeDrawerItem(data: { label: string; content: string; category?: string }) {
  return api.post<DrawerItem>("/home/furniture/drawer", data).then((r) => r.data);
}

export function deleteDrawerItem(id: string) {
  return api.delete(`/home/furniture/drawer/${id}`);
}

export function getPhotoFrames() {
  return api.get<PhotoFrame[]>("/home/furniture/photo-frame").then((r) => r.data);
}

export function createPhotoFrame(data: { category: PhotoFrame["category"]; title: string; content: string }) {
  return api.post<PhotoFrame>("/home/furniture/photo-frame", data).then((r) => r.data);
}

export function updatePhotoFrame(id: string, data: { title?: string; content?: string }) {
  return api.put<PhotoFrame>(`/home/furniture/photo-frame/${id}`, data).then((r) => r.data);
}

export function deletePhotoFrame(id: string) {
  return api.delete(`/home/furniture/photo-frame/${id}`);
}
