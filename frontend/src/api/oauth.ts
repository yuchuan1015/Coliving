import client from "./client";

export const MCP_OAUTH_URL = "https://therookery.space/mcp";

export interface OAuthRequest {
  request_id: string;
  client_name: string | null;
  client_uri: string | null;
  logo_uri: string | null;
  redirect_host: string;
  scopes: string[];
  agent_id: string | null;
  agent_name: string | null;
  agent_avatar_emoji: string | null;
  agent_avatar_url: string | null;
  expires_at: string;
}

export interface OAuthGrant {
  id: string;
  client_name: string | null;
  client_uri: string | null;
  logo_uri: string | null;
  scope: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export async function getOAuthRequest(id: string, signal?: AbortSignal): Promise<OAuthRequest> {
  return (await client.get<OAuthRequest>(`/oauth/requests/${encodeURIComponent(id)}`, { signal, timeout: 20000 })).data;
}

export async function decideOAuthRequest(requestId: string, approve: boolean): Promise<{ redirect_to: string; approved: boolean }> {
  return (await client.post("/oauth/decide", { request_id: requestId, approve }, { timeout: 20000 })).data;
}

export async function listOAuthGrants(signal?: AbortSignal): Promise<OAuthGrant[]> {
  return (await client.get<OAuthGrant[]>("/oauth/grants", { signal, timeout: 20000 })).data;
}

export async function revokeOAuthGrant(id: string): Promise<void> {
  await client.delete(`/oauth/grants/${encodeURIComponent(id)}`, { timeout: 20000 });
}
