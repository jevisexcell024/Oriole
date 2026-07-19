// Static route → breadcrumb map. Every route below is a real path from src/main.tsx.
// Each entry's `parent` is either a concrete path, or (for the two exam sub-pages)
// a pattern whose dynamic segment is resolved from the actual pathname at build time.
interface CrumbDef { labelKey: string; parent?: string }

const ROUTES: Record<string, CrumbDef> = {
  // Candidate shell
  "/dashboard": { labelKey: "nav.dashboard" },
  "/exams": { labelKey: "nav.myExams", parent: "/dashboard" },
  "/exams/:registrationId/checkin": { labelKey: "bc.checkin", parent: "/exams" },
  "/attempts/:attemptId/session": { labelKey: "bc.session", parent: "/exams" },
  "/attempts/:attemptId/result": { labelKey: "bc.result", parent: "/results" },
  "/results": { labelKey: "nav.myResults", parent: "/dashboard" },
  "/attendance": { labelKey: "nav.attendance", parent: "/dashboard" },
  "/announcements": { labelKey: "nav.announcements", parent: "/dashboard" },
  "/profile": { labelKey: "nav.profile", parent: "/dashboard" },
  "/practice": { labelKey: "nav.practiceTests", parent: "/dashboard" },
  "/calendar": { labelKey: "nav.calendar", parent: "/dashboard" },
  "/inbox": { labelKey: "nav.inbox", parent: "/dashboard" },
  "/chat": { labelKey: "nav.chat", parent: "/dashboard" },
  "/library": { labelKey: "nav.library", parent: "/dashboard" },
  "/learning-materials": { labelKey: "nav.learningMaterials", parent: "/dashboard" },
  "/timetable": { labelKey: "nav.timetable", parent: "/dashboard" },
  "/certificates": { labelKey: "nav.certificates", parent: "/dashboard" },

  // Admin/staff shell
  "/admin/dashboard": { labelKey: "anav.dashboard" },
  "/admin/exams": { labelKey: "anav.examsLibrary", parent: "/admin/dashboard" },
  "/admin/exams-library": { labelKey: "anav.questionBank", parent: "/admin/dashboard" },
  "/admin/exams/:examId": { labelKey: "bc.examBuilder", parent: "/admin/exams" },
  "/admin/exams/:examId/analysis": { labelKey: "bc.itemAnalysis", parent: "/admin/exams/:examId" },
  "/admin/exams/:examId/similarity": { labelKey: "bc.similarity", parent: "/admin/exams/:examId" },
  "/admin/scheduler": { labelKey: "anav.scheduler", parent: "/admin/dashboard" },
  "/admin/calendar": { labelKey: "anav.calendar", parent: "/admin/dashboard" },
  "/admin/inbox": { labelKey: "anav.inbox", parent: "/admin/dashboard" },
  "/admin/results": { labelKey: "anav.results", parent: "/admin/dashboard" },
  "/admin/grading": { labelKey: "anav.grading", parent: "/admin/dashboard" },
  "/admin/regrades": { labelKey: "anav.regrades", parent: "/admin/dashboard" },
  "/admin/analytics": { labelKey: "anav.analytics", parent: "/admin/dashboard" },
  "/admin/certificates": { labelKey: "anav.certificates", parent: "/admin/dashboard" },
  "/admin/candidates": { labelKey: "anav.students", parent: "/admin/dashboard" },
  "/admin/students": { labelKey: "anav.studentRecords", parent: "/admin/dashboard" },
  "/admin/students/:id": { labelKey: "bc.studentRecord", parent: "/admin/students" },
  "/admin/classes": { labelKey: "anav.classes", parent: "/admin/dashboard" },
  "/admin/classes/:id": { labelKey: "bc.classDetail", parent: "/admin/classes" },
  "/admin/attendance": { labelKey: "anav.attendance", parent: "/admin/dashboard" },
  "/admin/communication": { labelKey: "anav.communication", parent: "/admin/dashboard" },
  "/admin/integrity": { labelKey: "anav.integrity", parent: "/admin/dashboard" },
  "/admin/reports": { labelKey: "anav.reports", parent: "/admin/dashboard" },
  "/admin/attempts/:attemptId": { labelKey: "bc.attemptReview", parent: "/admin/results" },
  "/admin/live": { labelKey: "anav.liveMonitor", parent: "/admin/dashboard" },
  "/admin/violations": { labelKey: "anav.violations", parent: "/admin/dashboard" },
  "/admin/system-health": { labelKey: "anav.systemHealth", parent: "/admin/dashboard" },
  "/admin/reliability": { labelKey: "anav.reliability", parent: "/admin/dashboard" },
  "/admin/reliability/incidents/:id": { labelKey: "bc.incident", parent: "/admin/reliability" },
  "/admin/organization": { labelKey: "anav.organization", parent: "/admin/dashboard" },
  "/admin/integrations": { labelKey: "anav.integrations", parent: "/admin/dashboard" },
  "/admin/audit-logs": { labelKey: "anav.auditLogs", parent: "/admin/dashboard" },
  "/admin/settings": { labelKey: "anav.settings", parent: "/admin/dashboard" },
  "/admin/account": { labelKey: "acct.title", parent: "/admin/dashboard" },
  "/admin/team": { labelKey: "anav.team", parent: "/admin/dashboard" },
  "/admin/roles": { labelKey: "anav.roles", parent: "/admin/dashboard" },

  // Super Admin — a third, fully independent shell/root. Login and
  // force-password-change are full-screen forms with no PageHeader, so they
  // don't need entries here (nothing calls buildCrumbs for them).
  "/super-admin/dashboard": { labelKey: "sanav.dashboard" },
};

function matchRoute(path: string): { pattern: string; def: CrumbDef } | null {
  const exact = ROUTES[path];
  if (exact) return { pattern: path, def: exact };
  const segs = path.split("/");
  for (const pattern of Object.keys(ROUTES)) {
    if (!pattern.includes(":")) continue;
    const pSegs = pattern.split("/");
    if (pSegs.length !== segs.length) continue;
    if (pSegs.every((s, i) => s.startsWith(":") || s === segs[i])) return { pattern, def: ROUTES[pattern] };
  }
  return null;
}

/** Truncates the real pathname to a dynamic parent pattern's segment count (parent is always a URL-prefix when dynamic). */
function resolveParentPath(parentPattern: string, realSegments: string[]): string {
  if (!parentPattern.includes(":")) return parentPattern;
  return realSegments.slice(0, parentPattern.split("/").length).join("/");
}

export interface BreadcrumbSegment { labelKey?: string; label?: string; to?: string }

export function buildCrumbs(pathname: string, currentOverride?: string): BreadcrumbSegment[] {
  const chain: { path: string; def: CrumbDef }[] = [];
  const realSegments = pathname.split("/");
  let cursor: string | undefined = pathname;
  let guard = 0;
  while (cursor && guard++ < 12) {
    const match = matchRoute(cursor);
    if (!match) break;
    chain.unshift({ path: cursor, def: match.def });
    cursor = match.def.parent ? resolveParentPath(match.def.parent, realSegments) : undefined;
  }
  return chain.map((entry, i) => {
    const isLast = i === chain.length - 1;
    if (isLast && currentOverride) return { label: currentOverride };
    return { labelKey: entry.def.labelKey, to: isLast ? undefined : entry.path };
  });
}
