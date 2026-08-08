import client from "./client";
import type { AgentPublic, CreateAgentPayload } from "../types";

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

export async function generateMcpToken(): Promise<string> {
  const res = await client.post<{ mcp_token: string }>("/agents/mine/mcp-token");
  return res.data.mcp_token;
}

export async function updateAgent(
  id: string,
  payload: Partial<CreateAgentPayload>,
): Promise<AgentPublic> {
  const res = await client.patch<AgentPublic>(`/agents/${id}`, payload);
  return res.data;
}
