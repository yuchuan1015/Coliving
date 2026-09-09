import client from "./client";
import type { MessageHistoryResponse, SendMessageResponse } from "../types";

export interface UsageTotals {
  calls: number;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  missing_usage: number;
  usage_partial: boolean;
  cost_usd: number | null;
  cost_partial: boolean;
}

export interface ChatUsage {
  model: string;
  provider: string;
  prices_as_of: string;
  price_known: boolean;
  current_context_tokens: number | null;
  this_reply: UsageTotals;
  conversation_total: UsageTotals | null;
  this_month: UsageTotals;
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const optionalCount = (value: unknown) => value === null || count(value);
function validTotals(value: unknown): value is UsageTotals {
  return record(value) && count(value.calls) && count(value.missing_usage)
    && [value.input_tokens, value.output_tokens, value.total_tokens].every(optionalCount)
    && typeof value.usage_partial === "boolean" && typeof value.cost_partial === "boolean"
    && (value.cost_usd === null || (typeof value.cost_usd === "number" && Number.isFinite(value.cost_usd) && value.cost_usd >= 0));
}

export async function getChatUsage(agentId: string, signal?: AbortSignal): Promise<ChatUsage> {
  const { data } = await client.get<unknown>(`/chat/${encodeURIComponent(agentId)}/usage`, { signal });
  // Incomplete/old response shapes must never silently become zero or a full estimate.
  if (!record(data) || ![data.model, data.provider, data.prices_as_of].every(value => typeof value === "string")
    || typeof data.price_known !== "boolean" || !optionalCount(data.current_context_tokens)
    || !validTotals(data.this_reply) || !validTotals(data.this_month)
    || !(data.conversation_total === null || validTotals(data.conversation_total))) {
    throw new Error("用量資料格式尚未同步，請稍後重新讀取。");
  }
  return data as unknown as ChatUsage;
}

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
