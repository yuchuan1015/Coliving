import client from "./client";
import type { MessageHistoryResponse, SendMessageResponse } from "../types";

export async function sendMessage(
  agentId: string,
  content: string,
): Promise<SendMessageResponse> {
  const res = await client.post<SendMessageResponse>(
    `/chat/${agentId}/messages`,
    { content },
  );
  return res.data;
}

export async function getMessages(
  agentId: string,
  limit = 50,
  before?: string,
): Promise<MessageHistoryResponse> {
  const params: Record<string, string | number> = { limit };
  if (before) params.before = before;
  const res = await client.get<MessageHistoryResponse>(
    `/chat/${agentId}/messages`,
    { params },
  );
  return res.data;
}
