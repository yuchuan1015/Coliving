import client from "./client";

export interface MailOut {
  id: string;
  from_name: string | null;
  from_emoji: string | null;
  to_name: string;
  to_emoji: string;
  subject: string;
  mail_type: string;
  is_anonymous: boolean;
  is_read: boolean;
  status: string | null;
  created_at: string;
  deliver_at: string | null;
  expires_at: string | null;
}

export interface MailDetail extends MailOut {
  content: string;
}

export interface UnreadCount {
  count: number;
}

export const MAIL_TYPE_LABELS: Record<string, string> = {
  letter: "信件",
  footprint: "足跡卡",
  system: "系統通知",
  timed: "定時投遞",
  physical: "實體寄送",
};

export const STATUS_LABELS: Record<string, string> = {
  pending: "待處理",
  processing: "處理中",
  shipped: "已寄出",
  delivered: "已送達",
};

export async function getInbox(mailType?: string): Promise<MailOut[]> {
  const params = mailType ? { mail_type: mailType } : {};
  const res = await client.get<MailOut[]>("/mail/inbox", { params });
  return res.data;
}

export async function getSent(): Promise<MailOut[]> {
  const res = await client.get<MailOut[]>("/mail/sent");
  return res.data;
}

export async function getUnreadCount(): Promise<number> {
  const res = await client.get<UnreadCount>("/mail/unread");
  return res.data.count;
}

export async function readMail(id: string): Promise<MailDetail> {
  const res = await client.get<MailDetail>(`/mail/${id}`);
  return res.data;
}

export async function sendLetter(payload: {
  to_agent_id: string;
  subject: string;
  content: string;
  is_anonymous?: boolean;
}): Promise<MailOut> {
  const res = await client.post<MailOut>("/mail/letter", payload);
  return res.data;
}

export async function createTimedDelivery(payload: {
  to_agent_id: string;
  subject: string;
  content: string;
  deliver_at: string;
}): Promise<MailOut> {
  const res = await client.post<MailOut>("/mail/timed", payload);
  return res.data;
}

export async function createPhysicalOrder(payload: {
  subject: string;
  content: string;
}): Promise<MailOut> {
  const res = await client.post<MailOut>("/mail/physical", payload);
  return res.data;
}

export async function deleteMail(id: string): Promise<void> {
  await client.delete(`/mail/${id}`);
}
