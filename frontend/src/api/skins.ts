import client from "./client";

export interface SkinOut {
  id: string;
  name: string;
  is_active: boolean;
  is_published: boolean;
  created_at: string;
  updated_at: string | null;
}

export interface SkinContent {
  id: string;
  name: string;
  html_content: string;
}

export interface ResidentInfo {
  agent_id: string;
  agent_name: string;
  agent_emoji: string;
  agent_persona: string;
  resident_name: string;
  has_skin: boolean;
}

export async function listMySkins(): Promise<SkinOut[]> {
  const res = await client.get<SkinOut[]>("/skins/mine");
  return res.data;
}

export async function createSkin(name: string, html_content: string): Promise<SkinOut> {
  const res = await client.post<SkinOut>("/skins", { name, html_content });
  return res.data;
}

export async function getSkinContent(id: string): Promise<SkinContent> {
  const res = await client.get<SkinContent>(`/skins/${id}/content`);
  return res.data;
}

export async function updateSkin(id: string, payload: { name?: string; html_content?: string }): Promise<SkinOut> {
  const res = await client.patch<SkinOut>(`/skins/${id}`, payload);
  return res.data;
}

export async function deleteSkin(id: string): Promise<void> {
  await client.delete(`/skins/${id}`);
}

export async function activateSkin(id: string): Promise<SkinOut> {
  const res = await client.post<SkinOut>(`/skins/${id}/activate`);
  return res.data;
}

export async function deactivateSkin(): Promise<void> {
  await client.post("/skins/deactivate");
}

export async function getResidentInfo(agentId: string): Promise<ResidentInfo> {
  const res = await client.get<ResidentInfo>(`/skins/resident/${agentId}`);
  return res.data;
}

export interface StoreSkinOut {
  id: string;
  name: string;
  author_name: string;
  author_emoji: string;
  created_at: string;
}

export async function getStoreSkins(): Promise<StoreSkinOut[]> {
  const res = await client.get<StoreSkinOut[]>("/skins/store");
  return res.data;
}

export async function publishSkin(id: string): Promise<SkinOut> {
  const res = await client.post<SkinOut>(`/skins/${id}/publish`);
  return res.data;
}

export async function unpublishSkin(id: string): Promise<SkinOut> {
  const res = await client.post<SkinOut>(`/skins/${id}/unpublish`);
  return res.data;
}

export async function applySkin(id: string): Promise<SkinOut> {
  const res = await client.post<SkinOut>(`/skins/${id}/apply`);
  return res.data;
}
