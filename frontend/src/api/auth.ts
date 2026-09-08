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
  display_name?: string,
  birth_year?: number
): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>("/auth/register", {
    username,
    password,
    invite_code,
    display_name: display_name || undefined,
    birth_year,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  return data;
}

export async function getMe(): Promise<UserMe> {
  const { data } = await api.get<UserMe>("/users/me");
  return data;
}

export async function updateLocation(location_name: string): Promise<UserMe> {
  return (await api.patch<UserMe>("/users/me", { location_name })).data;
}

export async function updateBirthYear(birth_year: number): Promise<UserMe> {
  return (await api.patch<UserMe>("/users/me", { birth_year })).data;
}

export async function getDashboard(): Promise<DashboardData> {
  const { data } = await api.get<DashboardData>("/home/dashboard");
  return data;
}

export async function getResidents(): Promise<ResidentList> {
  const { data } = await api.get<ResidentList>("/users/residents");
  return data;
}
