import { StrictMode, Suspense, lazy, type ComponentType, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import "./index.css";
import "katex/dist/katex.min.css";
import "leaflet/dist/leaflet.css";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ThemeProvider } from "@/lib/theme";
import { I18nProvider } from "@/lib/i18n";
import { IdleLogout } from "@/components/IdleLogout";
import { useMaintenanceMessage } from "@/lib/maintenance";
import { MaintenancePage } from "@/pages/MaintenancePage";
import { Login } from "@/pages/Login";
import { StudentPortalLogin } from "@/pages/StudentPortalLogin";
import { Shell } from "@/components/Shell";
import { AdminShell } from "@/components/AdminShell";
import { ContentSkeleton, skeletonForPath } from "@/components/Skeletons";
import { can, isStaff, landingFor, type Cap } from "@/lib/roles";
// Every page is its own chunk. Only Login (the entry route) and the maintenance
// screen stay in the main bundle; the heavy ones (ExamBuilder, recharts-backed
// dashboards, Monaco, Super Admin) used to ship to every visitor up front.
function page<K extends string>(load: () => Promise<Record<K, ComponentType<any>>>, name: K) {
  return lazy(() => load().then((m) => ({ default: m[name] })));
}
const RequestAccess = page(() => import("@/pages/RequestAccess"), "RequestAccess");
const Dashboard = page(() => import("@/pages/Dashboard"), "Dashboard");
const Exams = page(() => import("@/pages/Exams"), "Exams");
const MyResults = page(() => import("@/pages/MyResults"), "MyResults");
const StudentAttendance = page(() => import("@/pages/StudentAttendance"), "StudentAttendance");
const StudentAnnouncements = page(() => import("@/pages/StudentAnnouncements"), "StudentAnnouncements");
const Profile = page(() => import("@/pages/Profile"), "Profile");
const PracticeTests = page(() => import("@/pages/PracticeTests"), "PracticeTests");
const StudentCalendar = page(() => import("@/pages/Calendar"), "StudentCalendar");
const AdminCalendar = page(() => import("@/pages/Calendar"), "AdminCalendar");
const AdminItemAnalysis = page(() => import("@/pages/AdminItemAnalysis"), "AdminItemAnalysis");
const StudentInbox = page(() => import("@/pages/Inbox"), "StudentInbox");
const AdminInbox = page(() => import("@/pages/Inbox"), "AdminInbox");
const Chat = page(() => import("@/pages/Chat"), "Chat");
const Library = page(() => import("@/pages/Library"), "Library");
const LearningMaterials = page(() => import("@/pages/LearningMaterials"), "LearningMaterials");
const Timetable = page(() => import("@/pages/Timetable"), "Timetable");
const Checkin = page(() => import("@/pages/Checkin"), "Checkin");
const Session = page(() => import("@/pages/Session"), "Session");
const Result = page(() => import("@/pages/Result"), "Result");
const Certificates = page(() => import("@/pages/Certificates"), "Certificates");
const Verify = page(() => import("@/pages/Verify"), "Verify");
const AdminExams = page(() => import("@/pages/AdminExams"), "AdminExams");
const AdminExamLibrary = page(() => import("@/pages/AdminExamLibrary"), "AdminExamLibrary");
const ExamBuilder = page(() => import("@/pages/ExamBuilder"), "ExamBuilder");
const AdminResults = page(() => import("@/pages/AdminResults"), "AdminResults");
const AdminGrading = page(() => import("@/pages/AdminGrading"), "AdminGrading");
const AdminRegrades = page(() => import("@/pages/AdminRegrades"), "AdminRegrades");
const CertificateView = page(() => import("@/pages/CertificateView"), "CertificateView");
const AdminSimilarity = page(() => import("@/pages/AdminSimilarity"), "AdminSimilarity");
const AdminAttemptReview = page(() => import("@/pages/AdminAttemptReview"), "AdminAttemptReview");
const AdminLiveMonitor = page(() => import("@/pages/AdminLiveMonitor"), "AdminLiveMonitor");
const AdminScheduler = page(() => import("@/pages/AdminScheduler"), "AdminScheduler");
const AdminAnalytics = page(() => import("@/pages/AdminAnalytics"), "AdminAnalytics");
const AdminCertificates = page(() => import("@/pages/AdminCertificates"), "AdminCertificates");
const AdminCandidates = page(() => import("@/pages/AdminCandidates"), "AdminCandidates");
const StudentsSIS = page(() => import("@/pages/StudentsSIS"), "StudentsSIS");
const StudentRecord = page(() => import("@/pages/StudentsSIS"), "StudentRecord");
const AdminAttendance = page(() => import("@/pages/AdminAttendance"), "AdminAttendance");
const AdminCommunication = page(() => import("@/pages/AdminCommunication"), "AdminCommunication");
const AdminIntegrity = page(() => import("@/pages/AdminIntegrity"), "AdminIntegrity");
const AdminReports = page(() => import("@/pages/AdminReports"), "AdminReports");
const AdminIntegrations = page(() => import("@/pages/AdminIntegrations"), "AdminIntegrations");
const AdminViolations = page(() => import("@/pages/AdminViolations"), "AdminViolations");
const AdminSystemHealth = page(() => import("@/pages/AdminSystemHealth"), "AdminSystemHealth");
const AdminReliability = page(() => import("@/pages/AdminReliability"), "AdminReliability");
const AdminReliabilityIncident = page(() => import("@/pages/AdminReliabilityIncident"), "AdminReliabilityIncident");
const StatusPage = page(() => import("@/pages/StatusPage"), "StatusPage");
const AdminOrganization = page(() => import("@/pages/AdminOrganization"), "AdminOrganization");
const AdminAuditLogs = page(() => import("@/pages/AdminAuditLogs"), "AdminAuditLogs");
const AdminSupport = page(() => import("@/pages/AdminSupport"), "AdminSupport");
const AdminSettings = page(() => import("@/pages/AdminSettings"), "AdminSettings");
const AdminAccount = page(() => import("@/pages/AdminAccount"), "AdminAccount");
const AdminClasses = page(() => import("@/pages/AdminClasses"), "AdminClasses");
const ClassDetail = page(() => import("@/pages/AdminClasses"), "ClassDetail");
const AdminLibrary = page(() => import("@/pages/AdminLibrary"), "AdminLibrary");
const AdminTeam = page(() => import("@/pages/AdminTeam"), "AdminTeam");
const AdminRoles = page(() => import("@/pages/AdminRoles"), "AdminRoles");
const ForcePasswordChange = page(() => import("@/pages/ForcePasswordChange"), "ForcePasswordChange");
const SetupPassword = page(() => import("@/pages/SetupPassword"), "SetupPassword");
const ResetPassword = page(() => import("@/pages/ResetPassword"), "ResetPassword");
// recharts-heavy dashboard and the whole Super Admin platform (own auth provider,
// routes and shell) - see src/pages/SuperAdminApp.tsx.
const AdminDashboard = page(() => import("@/pages/AdminDashboard"), "AdminDashboard");
const SuperAdminApp = page(() => import("@/pages/SuperAdminApp"), "SuperAdminApp");

// Student pages that sit inside the student Shell (sidebar + header). The live
// exam session, check-in-less public pages and the Super Admin app bring their own frame.
const STUDENT_FRAMED = /^\/(dashboard|exams|results|attendance|announcements|profile|practice|calendar|inbox|chat|library|learning-materials|timetable|certificates|exams\/[^/]+\/checkin|attempts\/[^/]+\/result)\/?$/;

/** Shown while a page's code (or the session) is still loading: the real app
 *  frame for that kind of page, with a skeleton shaped like the page itself —
 *  not a generic full-screen loader. Before we know who is signed in there is no
 *  frame to show yet, so it is just the skeleton. */
function RouteFallback() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const body = <ContentSkeleton variant={skeletonForPath(pathname)} />;
  if (user && pathname.startsWith("/admin")) return <AdminShell>{body}</AdminShell>;
  if (user && STUDENT_FRAMED.test(pathname)) return <Shell>{body}</Shell>;
  return <div className="min-h-screen p-4 sm:p-6">{body}</div>;
}
function Protected({ children, cap, staff }: { children: ReactNode; cap?: Cap; staff?: boolean }) {
  const { user, loading } = useAuth();
  if (loading) return <RouteFallback />;
  // Signed-out visitors go to the right door: staff routes -> /login, student routes -> /portal.
  if (!user) return <Navigate to={cap || staff ? "/login" : "/portal"} replace />;
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
  const location = useLocation();
  const maintenanceMessage = useMaintenanceMessage();
  // Super Admin and the public status page stay reachable during maintenance
  // — both server-side (isMaintenanceExempt, server/security.ts) and here.
  const exempt = location.pathname.startsWith("/super-admin") || location.pathname.startsWith("/status") || location.pathname.startsWith("/request-access");
  if (maintenanceMessage && !exempt) {
    return <MaintenancePage message={maintenanceMessage} />;
  }
  return (
    <AuthProvider>
      <IdleLogout />
      <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/portal" element={<StudentPortalLogin />} />
        <Route path="/request-access" element={<RequestAccess />} />
        <Route path="/force-password-change" element={<ForcePasswordChange />} />
        <Route path="/setup-password" element={<SetupPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
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
        <Route path="/admin/support" element={<Protected cap="org"><AdminSupport /></Protected>} />
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

