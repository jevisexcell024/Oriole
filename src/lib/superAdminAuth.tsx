import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { SafeSuperAdmin } from "@shared/types";
import { api } from "./api";

// Mirrors src/lib/auth.tsx's shape exactly, but talks to /super-admin/auth/*
// and holds a completely separate SafeSuperAdmin — no shared state, no shared
// cookie, no shared context object with the tenant AuthProvider. The two can
// coexist mounted at the same time (see src/pages/SuperAdminApp.tsx) with zero
// interference.
interface SuperAdminAuthState {
  superAdmin: SafeSuperAdmin | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const SuperAdminAuthContext = createContext<SuperAdminAuthState | null>(null);

export function SuperAdminAuthProvider({ children }: { children: ReactNode }) {
  const [superAdmin, setSuperAdmin] = useState<SafeSuperAdmin | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ superAdmin: SafeSuperAdmin | null }>("/super-admin/auth/me")
      .then((d) => setSuperAdmin(d.superAdmin))
      .catch(() => setSuperAdmin(null))
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const d = await api.post<{ superAdmin: SafeSuperAdmin }>("/super-admin/auth/login", { email, password });
    setSuperAdmin(d.superAdmin);
  };

  const logout = async () => {
    await api.post("/super-admin/auth/logout");
    setSuperAdmin(null);
  };

  const refresh = async () => {
    const d = await api.get<{ superAdmin: SafeSuperAdmin | null }>("/super-admin/auth/me");
    setSuperAdmin(d.superAdmin);
  };

  return (
    <SuperAdminAuthContext.Provider value={{ superAdmin, loading, login, logout, refresh }}>
      {children}
    </SuperAdminAuthContext.Provider>
  );
}

export function useSuperAdminAuth() {
  const ctx = useContext(SuperAdminAuthContext);
  if (!ctx) throw new Error("useSuperAdminAuth must be used within SuperAdminAuthProvider");
  return ctx;
}
