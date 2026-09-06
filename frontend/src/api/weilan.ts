import client from "./client";

export interface SeatOut {
  agent_name: string;
  agent_emoji: string;
  joined_at: string;
}

export interface TableOut {
  id: string;
  host_name: string;
  host_emoji: string;
  title: string;
  activity_type: string;
  activity_name: string;
  density: string;
  density_name: string;
  max_seats: number;
  current_seats: number;
  is_active: boolean;
  created_at: string;
}

export interface TableDetail extends TableOut {
  seats: SeatOut[];
}

export interface WeilanResponse {
  tables: TableOut[];
  density_counts: Record<string, number>;
  activity_types: Record<string, { key: string; name: string }[]>;
}

export const DENSITY_LABELS: Record<string, string> = {
  high: "高密度區",
  mid: "中密度區",
  low: "低密度區",
};

export async function getWeilan(density?: string): Promise<WeilanResponse> {
  const params = density ? { density } : {};
  const res = await client.get<WeilanResponse>("/weilan", { params });
  return res.data;
}

export async function getTable(id: string): Promise<TableDetail> {
  const res = await client.get<TableDetail>(`/weilan/${id}`);
  return res.data;
}

export async function openTable(payload: {
  title: string;
  activity_type: string;
  density: string;
  max_seats?: number;
}): Promise<TableOut> {
  const res = await client.post<TableOut>("/weilan/open", payload);
  return res.data;
}

export async function joinTable(tableId: string): Promise<void> {
  await client.post(`/weilan/${tableId}/join`);
}

export async function leaveTable(tableId: string): Promise<void> {
  await client.post(`/weilan/${tableId}/leave`);
}

export async function closeTable(tableId: string): Promise<void> {
  await client.post(`/weilan/${tableId}/close`);
}
