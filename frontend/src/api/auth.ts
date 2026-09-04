import type { AuthResponse, DashboardData, ResidentList, UserMe } from "../types";
import api from "./client";

export async function login(username: string, password: string): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>("/auth/login", { username, password });
  return data;
}

export async function register(
  username: string,
  password: string,
  invite_code: string,
  display_name?: string
): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>("/auth/register", {
    username,
    password,
    invite_code,
    display_name: display_name || undefined,
  });
  return data;
}

export async function getMe(): Promise<UserMe> {
  const { data } = await api.get<UserMe>("/users/me");
  return data;
}

export async function getDashboard(): Promise<DashboardData> {
  const { data } = await api.get<DashboardData>("/home/dashboard");
  return data;
}

export async function getResidents(): Promise<ResidentList> {
  const { data } = await api.get<ResidentList>("/users/residents");
  return data;
}
