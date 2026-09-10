import { createContext, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { getMe, login as apiLogin, register as apiRegister, updateLocation as apiUpdateLocation, updateBirthYear as apiUpdateBirthYear, updateDisplayName as apiUpdateDisplayName } from "../api/auth";
import { clearTokens, getAccessToken, setTokens } from "../api/client";
import type { UserMe } from "../types";

interface AuthContextType {
  user: UserMe | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, invite_code: string, display_name?: string, birth_year?: number) => Promise<void>;
  logout: () => void;
  updateLocation: (city: string) => Promise<UserMe>;
  updateBirthYear: (year: number) => Promise<UserMe>;
  refreshUser: () => Promise<UserMe>;
  updateDisplayName: (name: string) => Promise<UserMe>;
}

export const AuthContext = createContext<AuthContextType>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserMe | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const sessionVersion = useRef(0);

  useEffect(() => {
    const version = sessionVersion.current;
    let active = true;
    const token = getAccessToken();
    if (!token) {
      setIsLoading(false);
      return;
    }
    getMe()
      .then(saved => { if (active && version === sessionVersion.current) setUser(saved); })
      .catch(() => { if (active && version === sessionVersion.current) clearTokens(); })
      .finally(() => { if (active && version === sessionVersion.current) setIsLoading(false); });
    return () => { active = false; };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const version = ++sessionVersion.current;
    const res = await apiLogin(username, password);
    if (version !== sessionVersion.current) return;
    setTokens(res.access_token, res.refresh_token);
    // Authentication has already succeeded. A profile refresh must not turn it
    // into an apparent login failure (or make registration consume an invite twice).
    const saved = await getMe().catch(() => res.user as UserMe);
    if (version === sessionVersion.current) { setUser(saved); setIsLoading(false); }
  }, []);

  const register = useCallback(
    async (username: string, password: string, invite_code: string, display_name?: string, birth_year?: number) => {
      const version = ++sessionVersion.current;
      const res = await apiRegister(username, password, invite_code, display_name, birth_year);
      if (version !== sessionVersion.current) return;
      setTokens(res.access_token, res.refresh_token);
      const saved = await getMe().catch(() => res.user as UserMe);
      if (version === sessionVersion.current) { setUser(saved); setIsLoading(false); }
    },
    []
  );

  const logout = useCallback(() => {
    sessionVersion.current++;
    clearTokens();
    setUser(null);
    setIsLoading(false);
  }, []);

  const updateLocation = useCallback(async (city: string) => {
    const version = sessionVersion.current;
    const saved = await apiUpdateLocation(city);
    if (version === sessionVersion.current) setUser(saved);
    return saved;
  }, []);

  const updateBirthYear = useCallback(async (year: number) => {
    const version = sessionVersion.current;
    const saved = await apiUpdateBirthYear(year); if (version === sessionVersion.current) setUser(saved); return saved;
  }, []);
  const refreshUser = useCallback(async () => {
    const version = sessionVersion.current;
    const saved = await getMe(); if (version === sessionVersion.current) setUser(saved); return saved;
  }, []);
  const updateDisplayName = useCallback(async (name: string) => {
    const version = sessionVersion.current;
    const saved = await apiUpdateDisplayName(name); if (version === sessionVersion.current) setUser(saved); return saved;
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, logout, updateLocation, updateBirthYear, refreshUser, updateDisplayName }}>
      {children}
    </AuthContext.Provider>
  );
}
