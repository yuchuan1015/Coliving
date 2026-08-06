import { createContext, useCallback, useEffect, useState, type ReactNode } from "react";
import { getMe, login as apiLogin, register as apiRegister } from "../api/auth";
import { clearTokens, getAccessToken, setTokens } from "../api/client";
import type { UserMe } from "../types";

interface AuthContextType {
  user: UserMe | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, invite_code: string, display_name?: string) => Promise<void>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextType>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserMe | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      setIsLoading(false);
      return;
    }
    getMe()
      .then(setUser)
      .catch(() => clearTokens())
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await apiLogin(username, password);
    setTokens(res.access_token, res.refresh_token);
    setUser(res.user as UserMe);
  }, []);

  const register = useCallback(
    async (username: string, password: string, invite_code: string, display_name?: string) => {
      const res = await apiRegister(username, password, invite_code, display_name);
      setTokens(res.access_token, res.refresh_token);
      setUser(res.user as UserMe);
    },
    []
  );

  const logout = useCallback(() => {
    clearTokens();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
