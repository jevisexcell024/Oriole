import type { Role } from "@shared/types";

// Capability groups that gate nav items and routes.
export type Cap = "dashboard" | "exams" | "monitor" | "system" | "results" | "students" | "grading" | "communication" | "org";

const ROLE_CAPS: Record<string, Cap[]> = {
  admin: ["dashboard", "exams", "monitor", "system", "results", "students", "grading", "communication", "org"],
  // Facilitators grade, view results, monitor sessions, and message students.
  facilitator: ["dashboard", "grading", "results", "communication", "monitor"],
  // Proctors only watch live sessions and integrity flags.
  proctor: ["dashboard", "monitor"],
  candidate: [],
};

export function can(role: Role | undefined, cap: Cap): boolean {
  return !!role && (ROLE_CAPS[role] ?? []).includes(cap);
}

export function isStaff(role?: Role): boolean {
  return role === "admin" || role === "facilitator" || role === "proctor";
}

/** Where a signed-in user should land. */
export function landingFor(role?: Role): string {
  if (!isStaff(role)) return "/dashboard";
  return "/admin/dashboard";
}

export const ROLE_LABEL: Record<string, string> = {
  admin: "Admin", facilitator: "Facilitator", proctor: "Proctor", candidate: "Student",
};
