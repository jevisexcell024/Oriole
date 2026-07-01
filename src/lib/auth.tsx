import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { SafeUser } from "@shared/types";
import { api } from "./api";

interface AuthState {
  user: SafeUser | null;
  loading: boolean;
  /** Returns `{ twoFactorRequired: true }` when the account has 2FA on — the caller
   *  then collects a code and calls `verify2fa`. Otherwise the user is signed in. */
  login: (email: string, password: string) => Promise<{ twoFactorRequired?: boolean }>;
  verify2fa: (code: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Re-fetch the current user (e.g. after editing the profile). */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SafeUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ user: SafeUser | null }>("/auth/me")
      .then((d) => setUser(d.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const d = await api.post<{ user?: SafeUser; twoFactorRequired?: boolean }>("/auth/login", { email, password });
    if (d.twoFactorRequired) return { twoFactorRequired: true };
    if (d.user) setUser(d.user);
    return {};
  };

  const verify2fa = async (code: string) => {
    const d = await api.post<{ user: SafeUser }>("/auth/2fa/verify", { code });
    setUser(d.user);
  };

  const logout = async () => {
    await api.post("/auth/logout");
    setUser(null);
  };

  const refresh = async () => {
    const d = await api.get<{ user: SafeUser | null }>("/auth/me");
    setUser(d.user);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, verify2fa, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
