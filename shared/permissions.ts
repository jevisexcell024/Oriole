// Fine-grained permission catalog for the custom-roles system.
//
// This layer is additive: the 120+ existing requireRole()/requireRoles() checks
// in server/index.ts keep gating on User.role ("admin" | "facilitator" | "proctor")
// exactly as before. A CustomRole (shared/types.ts) is an optional extra bundle of
// permissions a staff member can be assigned on top of their base role, checked only
// by requirePermission() on new role-management endpoints (and whatever future
// endpoints opt in). Nothing here changes what the base 3 roles can already do.

export type PermissionCategory =
  | "exams"
  | "monitor"
  | "grading"
  | "results"
  | "students"
  | "communication"
  | "org"
  | "system"
  | "roles"
  | "library";

export interface PermissionDef {
  key: string;
  category: PermissionCategory;
  label: string;
  description: string;
}

export const PERMISSION_CATEGORY_LABELS: Record<PermissionCategory, string> = {
  exams: "Exams",
  monitor: "Live Monitoring",
  grading: "Grading",
  results: "Results",
  students: "Students",
  communication: "Communication",
  org: "Organization",
  system: "System",
  roles: "Roles & Team",
  library: "Digital Library",
};

export const PERMISSIONS: PermissionDef[] = [
  { key: "exams.view", category: "exams", label: "View exams", description: "See exam definitions, questions, and settings." },
  { key: "exams.create", category: "exams", label: "Create exams", description: "Build new exams and question banks." },
  { key: "exams.edit", category: "exams", label: "Edit exams", description: "Modify existing exam content and settings." },
  { key: "exams.publish", category: "exams", label: "Publish / schedule exams", description: "Make exams available to candidates and set their scheduling windows." },
  { key: "exams.delete", category: "exams", label: "Delete exams", description: "Permanently remove exams." },

  { key: "monitor.view", category: "monitor", label: "View live sessions", description: "See candidates currently taking exams and integrity flags." },
  { key: "monitor.control", category: "monitor", label: "Control live sessions", description: "Pause, message, or terminate an in-progress attempt." },

  { key: "grading.view", category: "grading", label: "View submissions", description: "See candidate answers awaiting grading." },
  { key: "grading.grade", category: "grading", label: "Grade submissions", description: "Score open-ended answers and finalize grades." },
  { key: "grading.regrade", category: "grading", label: "Handle regrade requests", description: "Review and resolve student regrade requests." },
  { key: "grading.manage", category: "grading", label: "Manage rubric library", description: "Create and delete reusable grading rubrics." },

  { key: "results.view", category: "results", label: "View results", description: "See candidate scores and result breakdowns." },
  { key: "results.release", category: "results", label: "Release / hold results", description: "Control when results become visible to candidates." },
  { key: "results.export", category: "results", label: "Export results", description: "Download result data and certificates." },
  { key: "results.manage", category: "results", label: "Recompute & manage results", description: "Re-apply grade scales and perform bulk result maintenance operations." },

  { key: "students.view", category: "students", label: "View students", description: "See the student directory, roster, and class lists." },
  { key: "students.report_view", category: "students", label: "View student reports", description: "View an individual candidate's performance and integrity report." },
  { key: "students.manage", category: "students", label: "Manage students", description: "Create, edit, import, and message students; manage classes and attendance." },
  { key: "students.delete", category: "students", label: "Remove students", description: "Delete student accounts." },

  { key: "communication.send", category: "communication", label: "Send messages", description: "Send announcements and direct messages to students." },
  { key: "communication.view_log", category: "communication", label: "View delivery log", description: "See the email/notification outbox and delivery status." },
  { key: "communication.manage", category: "communication", label: "Manage communication channels", description: "Delete announcements and send test emails/SMS to verify delivery configuration." },

  { key: "org.view", category: "org", label: "View organization structure", description: "See faculties, departments, programs, and campuses." },
  { key: "org.manage", category: "org", label: "Manage organization structure", description: "Create and edit faculties, departments, programs, and campuses." },

  { key: "system.settings", category: "system", label: "Manage system settings", description: "Change platform-wide configuration and integrations." },
  { key: "system.audit_log", category: "system", label: "View audit log", description: "See the full administrative action history." },
  { key: "system.reliability_view", category: "system", label: "View Status & Reliability Center", description: "See subsystem health, uptime, response times, and incident history." },
  { key: "system.reliability_manage", category: "system", label: "Manage reliability alerts & incidents", description: "Configure alert recipients, run a health check on demand, and manually resolve incidents." },

  { key: "roles.view", category: "roles", label: "View roles & team", description: "See staff members and role definitions." },
  { key: "roles.manage", category: "roles", label: "Manage roles", description: "Create, edit, clone, and delete custom roles and permission assignments." },
  { key: "roles.team_manage", category: "roles", label: "Manage team members", description: "Invite, remove, and reassign staff members." },

  { key: "library.view", category: "library", label: "View digital library", description: "Browse the book/resource catalog and version history." },
  { key: "library.manage", category: "library", label: "Manage digital library", description: "Add, edit, delete, and restore versions of library resources." },
];

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);
export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export function isPermissionKey(v: string): v is PermissionKey {
  return (PERMISSION_KEYS as string[]).includes(v);
}

/** Default permission bundles for the 3 built-in system roles — used for role
 *  comparison, as the base a custom role can inherit from, and as the fallback
 *  bundle a candidate-facing UI compares custom-role grants against. These do
 *  NOT drive server authorization for existing endpoints (those still check
 *  User.role directly); they exist so the new UI can show "what does an Admin
 *  already have" without re-deriving it from the old STAFF/GRADERS groupings. */
export const SYSTEM_ROLE_PERMISSIONS: Record<"admin" | "facilitator" | "proctor", PermissionKey[]> = {
  admin: PERMISSION_KEYS as PermissionKey[],
  facilitator: [
    "exams.view",
    "grading.view", "grading.grade", "grading.regrade",
    "results.view", "results.release", "results.export",
    "students.view", "students.report_view",
    "communication.send", "communication.view_log",
    "monitor.view", "monitor.control",
    "org.view",
    "roles.view",
    "library.view", "library.manage",
  ],
  proctor: ["monitor.view", "monitor.control", "students.report_view", "roles.view"],
};

/** A synthetic parent-role id for "inherit from a system role" (as opposed to
 *  inheriting from another CustomRole, which uses that role's real id). */
export function systemParentId(role: "admin" | "facilitator" | "proctor"): string {
  return `system:${role}`;
}
export function parseSystemParentId(id: string | null | undefined): "admin" | "facilitator" | "proctor" | null {
  if (!id || !id.startsWith("system:")) return null;
  const r = id.slice("system:".length);
  return r === "admin" || r === "facilitator" || r === "proctor" ? r : null;
}
