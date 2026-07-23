import { type ReactNode } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { SuperAdminAuthProvider, useSuperAdminAuth } from "@/lib/superAdminAuth";
import { SuperAdminLogin } from "@/pages/SuperAdminLogin";
import { SuperAdminForcePasswordChange } from "@/pages/SuperAdminForcePasswordChange";
import { SuperAdminDashboard } from "@/pages/SuperAdminDashboard";
import { SuperAdminSecurityCenter } from "@/pages/SuperAdminSecurityCenter";
import { SuperAdminPlatformSettings } from "@/pages/SuperAdminPlatformSettings";
import { SuperAdminTeam } from "@/pages/SuperAdminTeam";
import { SuperAdminProfile } from "@/pages/SuperAdminProfile";
import { SuperAdminSystemInfo } from "@/pages/SuperAdminSystemInfo";
import { SuperAdminMaintenance } from "@/pages/SuperAdminMaintenance";
import { SuperAdminEmailTemplates } from "@/pages/SuperAdminEmailTemplates";
import { SuperAdminTickets } from "@/pages/SuperAdminTickets";
import { SuperAdminInstitutions } from "@/pages/SuperAdminInstitutions";

/** Entire Super Admin subtree in one file, lazy-loaded as a single unit from
 *  main.tsx (one route: <Route path="/super-admin/*" element={<SuperAdminApp/>}/>).
 *  Its own provider, its own nested <Routes>, its own guard — nothing here
 *  reads the tenant AuthContext or src/lib/roles.ts, and nothing in the
 *  tenant app reads this. Adding a real page to a future workstream means
 *  adding one <Route> here; main.tsx never changes again after this. */
function SuperAdminProtected({ children }: { children: ReactNode }) {
  const { superAdmin, loading } = useSuperAdminAuth();
  if (loading) return <div className="flex min-h-screen items-center justify-center text-[var(--muted)]">Loading…</div>;
  if (!superAdmin) return <Navigate to="/super-admin/login" replace />;
  if (superAdmin.mustChangePassword) return <Navigate to="/super-admin/force-password-change" replace />;
  return <>{children}</>;
}

function SuperAdminRoutes() {
  return (
    <Routes>
      <Route path="login" element={<SuperAdminLogin />} />
      <Route path="force-password-change" element={<SuperAdminForcePasswordChange />} />
      <Route path="dashboard" element={<SuperAdminProtected><SuperAdminDashboard /></SuperAdminProtected>} />
      <Route path="security" element={<SuperAdminProtected><SuperAdminSecurityCenter /></SuperAdminProtected>} />
      <Route path="settings" element={<SuperAdminProtected><SuperAdminPlatformSettings /></SuperAdminProtected>} />
      <Route path="team" element={<SuperAdminProtected><SuperAdminTeam /></SuperAdminProtected>} />
      <Route path="profile" element={<SuperAdminProtected><SuperAdminProfile /></SuperAdminProtected>} />
      <Route path="system-info" element={<SuperAdminProtected><SuperAdminSystemInfo /></SuperAdminProtected>} />
      <Route path="maintenance" element={<SuperAdminProtected><SuperAdminMaintenance /></SuperAdminProtected>} />
      <Route path="email-templates" element={<SuperAdminProtected><SuperAdminEmailTemplates /></SuperAdminProtected>} />
      <Route path="tickets" element={<SuperAdminProtected><SuperAdminTickets /></SuperAdminProtected>} />
      <Route path="institutions" element={<SuperAdminProtected><SuperAdminInstitutions /></SuperAdminProtected>} />
      <Route path="*" element={<Navigate to="dashboard" replace />} />
    </Routes>
  );
}

export function SuperAdminApp() {
  return (
    <SuperAdminAuthProvider>
      <SuperAdminRoutes />
    </SuperAdminAuthProvider>
  );
}
