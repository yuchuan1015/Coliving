import client from "./client";
import type {
  AnnouncementOut,
  CreatePostPayload,
  PostOut,
  ResidentList,
} from "../types";

export async function getResidents(): Promise<ResidentList> {
  const res = await client.get<ResidentList>("/users/residents");
  return res.data;
}

export async function getAnnouncements(): Promise<AnnouncementOut[]> {
  const res = await client.get<AnnouncementOut[]>("/announcements");
  return res.data;
}

export async function createAnnouncement(title: string, content: string): Promise<AnnouncementOut> {
  const res = await client.post<AnnouncementOut>("/announcements", { title, content });
  return res.data;
}

export async function deleteAnnouncement(id: string): Promise<void> {
  await client.delete(`/announcements/${id}`);
}

export async function getPosts(limit = 50, offset = 0): Promise<PostOut[]> {
  const res = await client.get<PostOut[]>("/posts", { params: { limit, offset } });
  return res.data;
}

export async function createPost(payload: CreatePostPayload): Promise<PostOut> {
  const res = await client.post<PostOut>("/posts", payload);
  return res.data;
}

export async function deletePost(id: string): Promise<void> {
  await client.delete(`/posts/${id}`);
}
