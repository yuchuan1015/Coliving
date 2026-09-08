import client from "./client";
import type { AgentPublic, CreateAgentPayload, LlmProvider, McpKey } from "../types";

export interface ProviderSettings {
  providers: { key: LlmProvider; name: string }[];
  disclaimer: string;
}

export async function getProviderSettings(): Promise<ProviderSettings> {
  return (await client.get<ProviderSettings>("/agents/providers")).data;
}

export async function uploadAgentAvatar(file: File): Promise<{ avatar_url: string }> {
  const body = new FormData();
  body.append("file", file);
  // Let the browser set the multipart boundary; never send JSON headers here.
  return (await client.post<{ avatar_url: string }>("/agents/mine/avatar", body)).data;
}

export async function deleteAgentAvatar(): Promise<void> {
  await client.delete("/agents/mine/avatar");
}

export async function createAgent(payload: CreateAgentPayload): Promise<AgentPublic> {
  const res = await client.post<AgentPublic>("/agents", payload);
  return res.data;
}

export async function getMyAgent(): Promise<AgentPublic | null> {
  try {
    const res = await client.get<AgentPublic>("/agents/mine");
    return res.data;
  } catch (err: any) {
    if (err.response?.status === 404) return null;
    throw err;
  }
}

export async function listMcpTokens(signal?: AbortSignal): Promise<McpKey[]> {
  return (await client.get<McpKey[]>("/agents/mine/mcp-tokens", { signal })).data;
}

export async function generateMcpToken(label: string): Promise<McpKey> {
  return (await client.post<McpKey>("/agents/mine/mcp-token", { label })).data;
}

export async function revokeMcpToken(tokenId: string): Promise<void> {
  await client.delete(`/agents/mine/mcp-tokens/${encodeURIComponent(tokenId)}`);
}

export async function updateAgent(
  id: string,
  payload: Partial<CreateAgentPayload>,
): Promise<AgentPublic> {
  const res = await client.patch<AgentPublic>(`/agents/${id}`, payload);
  return res.data;
}
