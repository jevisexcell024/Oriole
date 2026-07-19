import { StrictMode, Suspense, lazy, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./index.css";
import "katex/dist/katex.min.css";
import "leaflet/dist/leaflet.css";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ThemeProvider } from "@/lib/theme";
import { I18nProvider } from "@/lib/i18n";
import { IdleLogout } from "@/components/IdleLogout";
import { Login } from "@/pages/Login";
import { Dashboard } from "@/pages/Dashboard";
import { Exams } from "@/pages/Exams";
import { MyResults } from "@/pages/MyResults";
import { StudentAttendance } from "@/pages/StudentAttendance";
import { StudentAnnouncements } from "@/pages/StudentAnnouncements";
import { Profile } from "@/pages/Profile";
import { PracticeTests } from "@/pages/PracticeTests";
import { StudentCalendar, AdminCalendar } from "@/pages/Calendar";
import { AdminItemAnalysis } from "@/pages/AdminItemAnalysis";
import { StudentInbox, AdminInbox } from "@/pages/Inbox";
import { Chat } from "@/pages/Chat";
import { Library } from "@/pages/Library";
import { LearningMaterials } from "@/pages/LearningMaterials";
import { Timetable } from "@/pages/Timetable";
import { Checkin } from "@/pages/Checkin";
import { Session } from "@/pages/Session";
import { Result } from "@/pages/Result";
import { Certificates } from "@/pages/Certificates";
import { Verify } from "@/pages/Verify";
import { AdminExams } from "@/pages/AdminExams";
import { AdminExamLibrary } from "@/pages/AdminExamLibrary";
import { ExamBuilder } from "@/pages/ExamBuilder";
import { AdminResults } from "@/pages/AdminResults";
import { AdminGrading } from "@/pages/AdminGrading";
import { AdminRegrades } from "@/pages/AdminRegrades";
import { CertificateView } from "@/pages/CertificateView";
import { AdminSimilarity } from "@/pages/AdminSimilarity";
import { AdminAttemptReview } from "@/pages/AdminAttemptReview";
import { AdminLiveMonitor } from "@/pages/AdminLiveMonitor";
import { AdminScheduler } from "@/pages/AdminScheduler";
import { AdminAnalytics } from "@/pages/AdminAnalytics";
import { AdminCertificates } from "@/pages/AdminCertificates";
import { AdminCandidates } from "@/pages/AdminCandidates";
import { StudentsSIS, StudentRecord } from "@/pages/StudentsSIS";
import { AdminAttendance } from "@/pages/AdminAttendance";
import { AdminCommunication } from "@/pages/AdminCommunication";
import { AdminIntegrity } from "@/pages/AdminIntegrity";
import { AdminReports } from "@/pages/AdminReports";
import { AdminIntegrations } from "@/pages/AdminIntegrations";
import { AdminViolations } from "@/pages/AdminViolations";
import { AdminSystemHealth } from "@/pages/AdminSystemHealth";
import { AdminReliability } from "@/pages/AdminReliability";
import { AdminReliabilityIncident } from "@/pages/AdminReliabilityIncident";
import { StatusPage } from "@/pages/StatusPage";
import { AdminOrganization } from "@/pages/AdminOrganization";
import { AdminAuditLogs } from "@/pages/AdminAuditLogs";
import { AdminSettings } from "@/pages/AdminSettings";
import { AdminAccount } from "@/pages/AdminAccount";
// Lazy-loaded so recharts (heavy) ships in its own chunk, fetched only when an
// admin opens the dashboard — keeps it out of the main bundle.
const AdminDashboard = lazy(() => import("@/pages/AdminDashboard").then((m) => ({ default: m.AdminDashboard })));
// Entire Super Admin platform — own auth provider, own routes, own shell — is
// one lazy chunk so none of it (or its auth context) ever loads for a tenant
// admin or candidate. See src/pages/SuperAdminApp.tsx for everything else.
const SuperAdminApp = lazy(() => import("@/pages/SuperAdminApp").then((m) => ({ default: m.SuperAdminApp })));
import { AdminClasses, ClassDetail } from "@/pages/AdminClasses";
import { AdminLibrary } from "@/pages/AdminLibrary";
import { AdminTeam } from "@/pages/AdminTeam";
import { AdminRoles } from "@/pages/AdminRoles";
import { ForcePasswordChange } from "@/pages/ForcePasswordChange";
import { SetupPassword } from "@/pages/SetupPassword";
import { can, isStaff, landingFor, type Cap } from "@/lib/roles";

function Protected({ children, cap, staff }: { children: ReactNode; cap?: Cap; staff?: boolean }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[var(--muted)]">
        Loading…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  // Defense in depth: Login.tsx already redirects here on sign-in, but this
  // catches direct navigation to any other URL while a first-time password
  // setup is still outstanding — no route is reachable until it's done.
  if (user.mustChangePassword) return <Navigate to="/force-password-change" replace />;
  if (cap) {
    // Staff route: candidates bounce to their portal; staff lacking the capability go to their landing.
    if (!isStaff(user.role)) return <Navigate to="/dashboard" replace />;
    if (!can(user.role, cap)) return <Navigate to={landingFor(user.role)} replace />;
  } else if (staff) {
    // Staff-only route with no specific capability (e.g. account settings).
    if (!isStaff(user.role)) return <Navigate to="/dashboard" replace />;
  } else if (isStaff(user.role)) {
    // Candidate route accessed by staff → send to the admin console.
    return <Navigate to="/admin/dashboard" replace />;
  }
  return <>{children}</>;
}

function App() {
  return (
    <AuthProvider>
      <IdleLogout />
      <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-[var(--muted)]">Loading…</div>}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/force-password-change" element={<ForcePasswordChange />} />
        <Route path="/setup-password" element={<SetupPassword />} />
        <Route path="/super-admin/*" element={<SuperAdminApp />} />
        <Route path="/verify/:certNumber" element={<Verify />} />
        <Route path="/verify" element={<Verify />} />
        <Route path="/status" element={<StatusPage />} />
        <Route path="/certificate/:certNumber" element={<CertificateView />} />
        <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
        <Route path="/exams" element={<Protected><Exams /></Protected>} />
        <Route path="/results" element={<Protected><MyResults /></Protected>} />
        <Route path="/attendance" element={<Protected><StudentAttendance /></Protected>} />
        <Route path="/announcements" element={<Protected><StudentAnnouncements /></Protected>} />
        <Route path="/profile" element={<Protected><Profile /></Protected>} />
        <Route path="/practice" element={<Protected><PracticeTests /></Protected>} />
        <Route path="/calendar" element={<Protected><StudentCalendar /></Protected>} />
        <Route path="/inbox" element={<Protected><StudentInbox /></Protected>} />
        <Route path="/chat" element={<Protected><Chat /></Protected>} />
        <Route path="/library" element={<Protected><Library /></Protected>} />
        <Route path="/learning-materials" element={<Protected><LearningMaterials /></Protected>} />
        <Route path="/timetable" element={<Protected><Timetable /></Protected>} />
        <Route path="/exams/:registrationId/checkin" element={<Protected><Checkin /></Protected>} />
        <Route path="/attempts/:attemptId/session" element={<Protected><Session /></Protected>} />
        <Route path="/attempts/:attemptId/result" element={<Protected><Result /></Protected>} />
        <Route path="/certificates" element={<Protected><Certificates /></Protected>} />
        <Route path="/admin/dashboard" element={<Protected cap="dashboard"><AdminDashboard /></Protected>} />
        <Route path="/admin/classes" element={<Protected cap="exams"><AdminClasses /></Protected>} />
        <Route path="/admin/library" element={<Protected cap="org"><AdminLibrary /></Protected>} />
        <Route path="/admin/classes/:id" element={<Protected cap="exams"><ClassDetail /></Protected>} />
        <Route path="/admin/exams" element={<Protected cap="exams"><AdminExams /></Protected>} />
        <Route path="/admin/exams-library" element={<Protected cap="exams"><AdminExamLibrary /></Protected>} />
        <Route path="/admin/exams/:examId" element={<Protected cap="exams"><ExamBuilder /></Protected>} />
        <Route path="/admin/exams/:examId/analysis" element={<Protected cap="results"><AdminItemAnalysis /></Protected>} />
        <Route path="/admin/exams/:examId/similarity" element={<Protected cap="results"><AdminSimilarity /></Protected>} />
        <Route path="/admin/question-bank" element={<Navigate to="/admin/exams-library" replace />} />
        <Route path="/admin/scheduler" element={<Protected cap="exams"><AdminScheduler /></Protected>} />
        <Route path="/admin/calendar" element={<Protected cap="exams"><AdminCalendar /></Protected>} />
        <Route path="/admin/inbox" element={<Protected staff><AdminInbox /></Protected>} />
        <Route path="/admin/results" element={<Protected cap="results"><AdminResults /></Protected>} />
        <Route path="/admin/grading" element={<Protected cap="grading"><AdminGrading /></Protected>} />
        <Route path="/admin/regrades" element={<Protected cap="grading"><AdminRegrades /></Protected>} />
        <Route path="/admin/analytics" element={<Protected cap="results"><AdminAnalytics /></Protected>} />
        <Route path="/admin/certificates" element={<Protected cap="results"><AdminCertificates /></Protected>} />
        <Route path="/admin/candidates" element={<Protected cap="students"><AdminCandidates /></Protected>} />
        <Route path="/admin/students" element={<Protected cap="students"><StudentsSIS /></Protected>} />
        <Route path="/admin/students/:id" element={<Protected cap="students"><StudentRecord /></Protected>} />
        <Route path="/admin/attendance" element={<Protected cap="students"><AdminAttendance /></Protected>} />
        <Route path="/admin/communication" element={<Protected cap="communication"><AdminCommunication /></Protected>} />
        <Route path="/admin/integrity" element={<Protected cap="results"><AdminIntegrity /></Protected>} />
        <Route path="/admin/reports" element={<Protected cap="results"><AdminReports /></Protected>} />
        <Route path="/admin/attempts/:attemptId" element={<Protected cap="monitor"><AdminAttemptReview /></Protected>} />
        <Route path="/admin/live" element={<Protected cap="monitor"><AdminLiveMonitor /></Protected>} />
        <Route path="/admin/violations" element={<Protected cap="monitor"><AdminViolations /></Protected>} />
        <Route path="/admin/system-health" element={<Protected cap="system"><AdminSystemHealth /></Protected>} />
        <Route path="/admin/reliability" element={<Protected cap="system"><AdminReliability /></Protected>} />
        <Route path="/admin/reliability/incidents/:id" element={<Protected cap="system"><AdminReliabilityIncident /></Protected>} />
        <Route path="/admin/organization" element={<Protected cap="org"><AdminOrganization /></Protected>} />
        <Route path="/admin/integrations" element={<Protected cap="org"><AdminIntegrations /></Protected>} />
        <Route path="/admin/audit-logs" element={<Protected cap="org"><AdminAuditLogs /></Protected>} />
        <Route path="/admin/settings" element={<Protected cap="org"><AdminSettings /></Protected>} />
        <Route path="/admin/account" element={<Protected staff><AdminAccount /></Protected>} />
        <Route path="/admin/team" element={<Protected cap="org"><AdminTeam /></Protected>} />
        <Route path="/admin/roles" element={<Protected cap="org"><AdminRoles /></Protected>} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
      </Suspense>
    </AuthProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <I18nProvider>
          <App />
        </I18nProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
);

// PWA: register the service worker on the live site only (skipped on localhost so it
// never interferes with the Vite dev server). The worker only caches static assets —
// never the API — so exam delivery and proctoring stay live.
{
  const host = location.hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  if (!isLocal && "serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => { /* non-fatal */ });
    });
  }
}
