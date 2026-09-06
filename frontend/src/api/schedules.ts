import client from "./client";

export interface ScheduleOut {
  id: string;
  name: string;
  cron_expr: string;
  message: string;
  callback_url: string | null;
  enabled: boolean;
  last_run: string | null;
  next_run: string | null;
  created_at: string;
}

export interface CreateSchedulePayload {
  name: string;
  cron_expr: string;
  message: string;
  callback_url?: string;
}

export async function listSchedules(): Promise<ScheduleOut[]> {
  const res = await client.get<ScheduleOut[]>("/schedules");
  return res.data;
}

export async function createSchedule(payload: CreateSchedulePayload): Promise<ScheduleOut> {
  const res = await client.post<ScheduleOut>("/schedules", payload);
  return res.data;
}

export async function updateSchedule(id: string, payload: Record<string, unknown>): Promise<ScheduleOut> {
  const res = await client.patch<ScheduleOut>(`/schedules/${id}`, payload);
  return res.data;
}

export async function deleteSchedule(id: string): Promise<void> {
  await client.delete(`/schedules/${id}`);
}
