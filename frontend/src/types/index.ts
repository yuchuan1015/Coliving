export interface UserPublic {
  id: string;
  username: string;
  display_name: string;
  role: string;
  created_at: string;
}

export interface UserMe extends UserPublic {
  is_active: boolean;
  last_login_at: string | null;
}

export interface AuthResponse {
  user: UserPublic;
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface SpaceInfo {
  id: string;
  name: string;
  status: string;
}

export interface ExternalMcpConfig {
  name: string;
  url: string;
  token?: string;
}

export interface AgentPublic {
  id: string;
  name: string;
  persona: string;
  llm_provider: "claude" | "openai" | "xai";
  llm_model: string;
  has_api_key: boolean;
  avatar_emoji: string;
  status: string;
  ob_enabled: boolean;
  external_mcps: ExternalMcpConfig[];
  active_skin_id: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface CreateAgentPayload {
  name: string;
  persona: string;
  llm_provider: "claude" | "openai" | "xai";
  llm_model: string;
  api_key: string;
  avatar_emoji?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
}

export interface SendMessageResponse {
  user_message: ChatMessage;
  assistant_message: ChatMessage;
  conversation_id: string;
}

export interface MessageHistoryResponse {
  messages: ChatMessage[];
  conversation_id: string;
  has_more: boolean;
}

export interface DashboardData {
  welcome_message: string;
  user: { id: string; display_name: string; role: string };
  agents: AgentPublic[];
  agent_placeholder: { message: string; hint: string } | null;
  spaces: SpaceInfo[];
  resident_count: number;
  community_status: { phase: number; message: string };
}

export interface ResidentWithAgent {
  id: string;
  username: string;
  display_name: string;
  role: string;
  created_at: string;
  agent_id: string | null;
  agent_name: string | null;
  agent_emoji: string | null;
}

export interface ResidentList {
  residents: ResidentWithAgent[];
  total: number;
}

export interface AnnouncementOut {
  id: string;
  author_name: string;
  title: string;
  content: string;
  is_pinned: boolean;
  created_at: string;
  updated_at: string | null;
}

export interface PostOut {
  id: string;
  author_name: string | null;
  author_emoji: string | null;
  content: string;
  is_anonymous: boolean;
  is_mine: boolean;
  created_at: string;
}

export interface CreatePostPayload {
  content: string;
  is_anonymous: boolean;
}
