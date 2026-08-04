import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { SafeUser } from "@shared/types";
import { api } from "./api";
import { applyBrandColor } from "./brandColor";

interface AuthState {
  user: SafeUser | null;
  loading: boolean;
  /** This user's tenant's effective Admin console accent color — their own
   *  OrgSettings.brandColor if set, else the current platform default.
   *  Always a real hex value (server resolves the fallback), never null. */
  brandColor: string;
  /** Returns `{ twoFactorRequired: true }` when the account has 2FA on — the caller
   *  then collects a code and calls `verify2fa`. Otherwise the user is signed in. */
  login: (email: string, password: string) => Promise<{ twoFactorRequired?: boolean }>;
  verify2fa: (code: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Re-fetch the current user (e.g. after editing the profile). */
  refresh: () => Promise<void>;
  /** Ends a Super Admin "log in as" session (see user.impersonatedBy) without
   *  revoking the impersonated admin's own other sessions — a real logout(),
   *  above, isn't the right call here since it bumps their tokenVersion. */
  endImpersonation: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const DEFAULT_BRAND_COLOR = "#c6ff34";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SafeUser | null>(null);
  const [brandColor, setBrandColor] = useState(DEFAULT_BRAND_COLOR);
  const [loading, setLoading] = useState(true);

  // One shared effect for every place brandColor can change (initial load,
  // login, logout, impersonation) rather than repeating applyBrandColor at
  // each call site — this fires for candidates too (same tenant, same auth
  // check), which is deliberate: one school's brand color should look
  // consistent everywhere in their app, not just the staff console.
  useEffect(() => { applyBrandColor(brandColor); }, [brandColor]);

  useEffect(() => {
    api
      .get<{ user: SafeUser | null; brandColor?: string }>("/auth/me")
      .then((d) => { setUser(d.user); setBrandColor(d.brandColor ?? DEFAULT_BRAND_COLOR); })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const d = await api.post<{ user?: SafeUser; brandColor?: string; twoFactorRequired?: boolean }>("/auth/login", { email, password });
    if (d.twoFactorRequired) return { twoFactorRequired: true };
    if (d.user) { setUser(d.user); setBrandColor(d.brandColor ?? DEFAULT_BRAND_COLOR); }
    return {};
  };

  const verify2fa = async (code: string) => {
    const d = await api.post<{ user: SafeUser; brandColor?: string }>("/auth/2fa/verify", { code });
    setUser(d.user);
    setBrandColor(d.brandColor ?? DEFAULT_BRAND_COLOR);
  };

  const logout = async () => {
    await api.post("/auth/logout");
    setUser(null);
    setBrandColor(DEFAULT_BRAND_COLOR);
  };

  const refresh = async () => {
    const d = await api.get<{ user: SafeUser | null; brandColor?: string }>("/auth/me");
    setUser(d.user);
    setBrandColor(d.brandColor ?? DEFAULT_BRAND_COLOR);
  };

  const endImpersonation = async () => {
    await api.post("/admin/impersonation/end");
    setUser(null);
    setBrandColor(DEFAULT_BRAND_COLOR);
  };

  return (
    <AuthContext.Provider value={{ user, brandColor, loading, login, verify2fa, logout, refresh, endImpersonation }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
