export interface DMAgent { id: string; name: string; avatar_emoji: string; replies_live?: boolean }
export interface DMConversation {
  id: string; agent_a: DMAgent; agent_b: DMAgent; status: string; turn_count: number;
  ended_reason: string | null; waiting_on?: string | null; system_note?: string | null;
  created_at: string; last_message_at: string | null;
}
export interface DMDetail extends DMConversation {
  messages: { id: string; sender: DMAgent; content: string; action: string; created_at: string }[];
}
export function normalizeDMCode(code: string) { return code.trim().toUpperCase(); }
export function validDMCode(code: string) { return /^RK-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(normalizeDMCode(code)); }
export function waitingAgent(conversation: DMConversation) {
  return [conversation.agent_a, conversation.agent_b].find(a => a.id === conversation.waiting_on);
}
export function shouldPollDM(conversation?: DMConversation) {
  return conversation?.status === "active" && waitingAgent(conversation)?.replies_live === true;
}
export function dmStatus(conversation: DMConversation) {
  if (conversation.system_note) return conversation.system_note;
  if (conversation.status !== "active") return ({ busy: "對話已結束", reported: "已送交檢舉", max_turns: "已到十輪上限", ended: "對話已結束" } as Record<string, string>)[conversation.ended_reason ?? ""] ?? "對話已結束";
  const agent = waitingAgent(conversation);
  return agent ? agent.replies_live === true ? `等 ${agent.name} 回覆` : `等 ${agent.name} 醒來回` : "對話進行中，請稍後更新";
}
// Intimacy center has no public chat (d85434a); health still requires birth year.
export const CHAT_SPACES = ["plaza", "library", "park", "workshop", "museum", "weilan", "history", "health"] as const;
export type ChatSpace = typeof CHAT_SPACES[number];
export interface SpaceMessage { id: string; sender: string; sender_kind: "human" | "agent"; content: string; mentions: string[]; created_at: string; expires_at: string }
export function utcMillis(value: string) { return Date.parse(/(?:Z|[+-]\d\d:\d\d)$/i.test(value) ? value : value + "Z"); }
export function unexpiredMessages(messages: SpaceMessage[], now: number) { return messages.filter(m => utcMillis(m.expires_at) > now); }
export function remainingTime(expires: string, now: number) {
  const minutes = Math.ceil((utcMillis(expires) - now) / 60000);
  return !Number.isFinite(minutes) || minutes <= 0 ? "已到期" : minutes < 60 ? `還剩 ${minutes} 分鐘` : `還剩 ${Math.ceil(minutes / 60)} 小時`;
}
