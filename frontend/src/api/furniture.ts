import api from "./client";

export interface CabinWeather {
  description: string; temperature: number; emoji?: string; weather?: string;
  location?: string; source?: "local" | "community"; is_day?: boolean; wind_kmh?: number;
}

export function weatherIcon(weather?: CabinWeather | null) {
  if (!weather) return "◌";
  if (weather.weather === "sunny" && weather.is_day === false) return "☾";
  return weather.emoji || ({ sunny: "☼", cloudy: "☁", rainy: "☂", stormy: "ϟ", windy: "≋", foggy: "≋" }[weather.weather ?? ""] ?? "◌");
}

export interface FurnitureSummary {
  weather: CabinWeather | null;
  community_weather?: CabinWeather & { activities?: unknown[] };
  clock: { utc: string; taipei?: string; timezone?: string; local_time?: string; community_timezone?: string; community_time?: string };
  diary: { count: number };
  drawer: { count: number };
  photo_frame: { count?: number; photo?: CabinPhoto | null; photo_count?: number };
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

export interface LockedDrawer {
  locked: true;
  count: number;
  message: string;
}

export interface CabinPhoto {
  id: string;
  caption: string;
  is_displayed: boolean;
  width: number;
  height: number;
  bytes: number;
  url: string;
  created_at: string;
}

export interface PhotoAlbum { photos: CabinPhoto[]; max: number; displayed_id: string | null }
export const PHOTO_ACCEPT = "image/jpeg,image/jpg,image/png,image/webp,image/gif,image/heic,image/heif,.heic,.heif";
export function validatePhotoFile(file: File): string | null {
  if (!file.size) return "這個檔案是空的，請重新選擇。";
  if (file.size > 12 * 1024 * 1024) return "照片上限 12MB，請選擇小一點的檔案。";
  const supported = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"];
  // Some iOS pickers leave HEIC's MIME empty; the backend still validates bytes.
  if (!supported.includes(file.type.toLowerCase()) && !(file.type === "" && /\.hei[cf]$/i.test(file.name))) return "請選擇 JPG、PNG、WebP、GIF 或 HEIC／HEIF 照片。";
  return null;
}

export function getFurniture() {
  return api.get<FurnitureSummary & { window?: FurnitureSummary["weather"] }>("/home/furniture").then(({ data }) => ({ ...data, weather: "window" in data ? data.window ?? null : data.weather ?? null }));
}

export function getDiaryEntries(params?: { keyword?: string }) {
  return api.get<DiaryEntry[] | { entries: DiaryEntry[] }>("/diary", { params }).then(({ data }) => Array.isArray(data) ? data : data.entries);
}

export async function getDrawerSummary(): Promise<LockedDrawer> {
  const { data } = await api.get<LockedDrawer>("/home/furniture/drawer");
  if (!data || data.locked !== true || !Number.isSafeInteger(data.count) || data.count < 0 || typeof data.message !== "string") throw new Error("Invalid locked drawer summary");
  // Discard items even if an older or unexpected response includes private data.
  return { locked: true, count: data.count, message: data.message };
}

export async function getPhotos(): Promise<PhotoAlbum> {
  const { data } = await api.get<PhotoAlbum>("/home/furniture/photos");
  if (!Array.isArray(data.photos) || !Number.isInteger(data.max) || data.max < 1 || !(data.displayed_id === null || typeof data.displayed_id === "string")) throw new Error("Invalid photo album");
  return data;
}

export async function uploadPhoto(file: File, caption: string) {
  const error = validatePhotoFile(file);
  if (error) throw new Error(error);
  if (Array.from(caption.trim()).length > 200) throw new Error("照片說明上限 200 字。");
  const form = new FormData();
  const typedFile = !file.type ? new File([file], file.name, { type: /\.heif$/i.test(file.name) ? "image/heif" : "image/heic" }) : file;
  form.append("file", typedFile);
  form.append("caption", caption.trim());
  return (await api.post<CabinPhoto>("/home/furniture/photos", form)).data;
}

export async function updatePhoto(id: string, data: { caption?: string; display?: boolean }) {
  if (data.caption !== undefined && Array.from(data.caption.trim()).length > 200) throw new Error("照片說明上限 200 字。");
  return (await api.patch<CabinPhoto>(`/home/furniture/photos/${encodeURIComponent(id)}`, data)).data;
}

export function deletePhoto(id: string) {
  return api.delete(`/home/furniture/photos/${encodeURIComponent(id)}`);
}
