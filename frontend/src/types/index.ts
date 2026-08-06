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

export interface DashboardData {
  welcome_message: string;
  user: { id: string; display_name: string; role: string };
  agents: unknown[];
  agent_placeholder: { message: string; hint: string };
  spaces: SpaceInfo[];
  resident_count: number;
  community_status: { phase: number; message: string };
}

export interface ResidentList {
  residents: UserPublic[];
  total: number;
}
