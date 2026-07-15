import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { User, CustomRole } from "../shared/types.ts";

// Same in-memory PGlite pattern as db.test.ts — resolvePermissions() reads
// custom roles straight out of db.data.customRoles, so a real (if empty)
// store is needed rather than mocking it.
process.env.PGLITE_DIR = "memory://";
delete process.env.DATABASE_URL;

let db: typeof import("../server/db.ts")["db"];
let resolvePermissions: typeof import("../server/auth.ts")["resolvePermissions"];
let hasPermission: typeof import("../server/auth.ts")["hasPermission"];

beforeAll(async () => {
  const dbMod = await import("../server/db.ts");
  db = dbMod.db;
  await dbMod.initDb();
  const authMod = await import("../server/auth.ts");
  resolvePermissions = authMod.resolvePermissions;
  hasPermission = authMod.hasPermission;
}, 30000);

afterAll(async () => { await db.close(); });

function user(role: User["role"], extra: Partial<User> = {}): User {
  return { id: "u_" + Math.random().toString(36).slice(2), email: "x@x.com", passwordHash: "x", name: "Test", role, ...extra } as User;
}

describe("permission resolution (server/auth.ts)", () => {
  // These pin down exactly what each system role can and can't do — the same
  // mapping the Phase 2 endpoint migration (Organization/Settings batch) now
  // relies on. If a default bundle ever changes, this is the test that should
  // fail first, before a production access-control regression does.
  it("gives admin every permission, including org.manage and system.settings", () => {
    const perms = resolvePermissions(user("admin"));
    expect(perms).toContain("org.manage");
    expect(perms).toContain("system.settings");
    expect(perms).toContain("org.view");
  });

  it("gives facilitator org.view (matches today's GRADERS-gated institution read) but not org.manage or system.settings", () => {
    const perms = resolvePermissions(user("facilitator"));
    expect(perms).toContain("org.view");
    expect(perms).not.toContain("org.manage");
    expect(perms).not.toContain("system.settings");
  });

  it("gives proctor neither org.view nor org.manage (matches today's admin/facilitator-only institution read)", () => {
    const perms = resolvePermissions(user("proctor"));
    expect(perms).not.toContain("org.view");
    expect(perms).not.toContain("org.manage");
    expect(hasPermission(user("proctor"), "system.settings")).toBe(false);
  });

  // Batch 2 (Communication + Audit Logs) pins the same "no default behavior
  // change" guarantee: communication.send/view_log match the old GRADERS gate,
  // communication.manage and system.audit_log match the old admin-only gate.
  it("gives facilitator communication.send and communication.view_log (matches GRADERS) but not communication.manage or system.audit_log (were admin-only)", () => {
    const perms = resolvePermissions(user("facilitator"));
    expect(perms).toContain("communication.send");
    expect(perms).toContain("communication.view_log");
    expect(perms).not.toContain("communication.manage");
    expect(perms).not.toContain("system.audit_log");
  });

  it("gives proctor none of the communication permissions (matches today's admin/facilitator-only gates)", () => {
    const perms = resolvePermissions(user("proctor"));
    expect(perms).not.toContain("communication.send");
    expect(perms).not.toContain("communication.view_log");
    expect(perms).not.toContain("communication.manage");
  });

  it("gives admin communication.manage and system.audit_log", () => {
    const perms = resolvePermissions(user("admin"));
    expect(perms).toContain("communication.manage");
    expect(perms).toContain("system.audit_log");
  });

  // Batch 3 (Students + Classes) uncovered a real split in the existing code:
  // the candidate directory list is GRADERS-gated (admin+facilitator only),
  // while the individual student report is STAFF-gated (admin+facilitator+
  // proctor). One "students.view" key can't represent both without widening
  // one of them, so students.report_view exists specifically for the STAFF
  // group, and students.view stays GRADERS-only. students.manage/.delete
  // cover every write, all of which were requireRole("admin") alone.
  it("gives facilitator students.view and students.report_view (matches candidate-list GRADERS + report STAFF gates) but not students.manage or students.delete (were admin-only)", () => {
    const perms = resolvePermissions(user("facilitator"));
    expect(perms).toContain("students.view");
    expect(perms).toContain("students.report_view");
    expect(perms).not.toContain("students.manage");
    expect(perms).not.toContain("students.delete");
  });

  it("gives proctor students.report_view only (matches the STAFF-gated report endpoint) but not students.view (candidate list is GRADERS-only, excludes proctor)", () => {
    const perms = resolvePermissions(user("proctor"));
    expect(perms).toContain("students.report_view");
    expect(perms).not.toContain("students.view");
    expect(perms).not.toContain("students.manage");
  });

  it("gives admin students.manage and students.delete", () => {
    const perms = resolvePermissions(user("admin"));
    expect(perms).toContain("students.manage");
    expect(perms).toContain("students.delete");
  });

  // Batch 4 (Results/Certificates/Regrades): results.view/release/export and
  // grading.regrade already matched GRADERS in the original catalog, so the
  // only gap was the admin-only exam-wide recompute action, which needed its
  // own key (results.manage) rather than widening facilitator's existing
  // results.release/export access.
  it("gives facilitator results.view/release/export and grading.regrade (matches GRADERS) but not results.manage (was admin-only)", () => {
    const perms = resolvePermissions(user("facilitator"));
    expect(perms).toContain("results.view");
    expect(perms).toContain("results.release");
    expect(perms).toContain("results.export");
    expect(perms).toContain("grading.regrade");
    expect(perms).not.toContain("results.manage");
  });

  it("gives proctor none of the results/regrade permissions (matches today's admin/facilitator-only GRADERS gates)", () => {
    const perms = resolvePermissions(user("proctor"));
    expect(perms).not.toContain("results.view");
    expect(perms).not.toContain("results.release");
    expect(perms).not.toContain("grading.regrade");
  });

  it("gives admin results.manage", () => {
    expect(resolvePermissions(user("admin"))).toContain("results.manage");
  });

  it("gives candidates no staff permissions", () => {
    expect(resolvePermissions(user("candidate"))).toEqual([]);
  });

  // Batch 5 (Exams + Question Bank): every exam/question mutation in the app
  // is requireRole("admin") alone — facilitator can only ever GET the exam
  // list/overview (GRADERS). Unlike Batches 3-4, the original catalog already
  // had this right (facilitator's bundle only ever listed exams.view), so
  // this batch is a pure confirmation, not a correction.
  it("gives facilitator only exams.view — no create/edit/publish/delete (all were admin-only)", () => {
    const perms = resolvePermissions(user("facilitator"));
    expect(perms).toContain("exams.view");
    expect(perms).not.toContain("exams.create");
    expect(perms).not.toContain("exams.edit");
    expect(perms).not.toContain("exams.publish");
    expect(perms).not.toContain("exams.delete");
  });

  it("gives proctor no exams permissions at all", () => {
    const perms = resolvePermissions(user("proctor"));
    expect(perms).not.toContain("exams.view");
    expect(perms).not.toContain("exams.edit");
  });

  it("gives admin every exams permission", () => {
    const perms = resolvePermissions(user("admin"));
    for (const k of ["exams.view", "exams.create", "exams.edit", "exams.publish", "exams.delete"]) expect(perms).toContain(k);
  });

  // Batch 6 (Grading): the grading queue and both grade/second-mark write
  // routes were already GRADERS-gated, and facilitator's bundle already had
  // grading.view + grading.grade — another pure confirmation, no correction.
  it("gives facilitator grading.view and grading.grade (matches GRADERS)", () => {
    const perms = resolvePermissions(user("facilitator"));
    expect(perms).toContain("grading.view");
    expect(perms).toContain("grading.grade");
  });

  it("gives proctor no grading permissions (matches today's admin/facilitator-only GRADERS gate)", () => {
    const perms = resolvePermissions(user("proctor"));
    expect(perms).not.toContain("grading.view");
    expect(perms).not.toContain("grading.grade");
  });

  // Batch 7 (Live Monitoring / Attempt Control) uncovered the opposite kind of
  // gap from Batch 3: pause/terminate/message/geofence-override/verify-id are
  // STAFF-gated (admin+facilitator+proctor — any staff member on duty may need
  // to intervene in a live session), but the original catalog only gave
  // facilitator monitor.view, not monitor.control. Corrected by WIDENING
  // facilitator's bundle to match reality, not narrowing it. The aggregate
  // /admin/integrity dashboard is GRADERS-only (excludes proctor) though, so
  // it maps to results.view rather than monitor.view.
  it("gives facilitator monitor.view AND monitor.control (matches STAFF-gated pause/terminate/message)", () => {
    const perms = resolvePermissions(user("facilitator"));
    expect(perms).toContain("monitor.view");
    expect(perms).toContain("monitor.control");
  });

  it("gives proctor monitor.view and monitor.control (matches STAFF)", () => {
    const perms = resolvePermissions(user("proctor"));
    expect(perms).toContain("monitor.view");
    expect(perms).toContain("monitor.control");
  });

  it("gives facilitator results.view for the integrity dashboard (GRADERS-gated, excludes proctor) but proctor lacks it", () => {
    expect(resolvePermissions(user("facilitator"))).toContain("results.view");
    expect(resolvePermissions(user("proctor"))).not.toContain("results.view");
  });

  // Batch 8 (Dashboard/Analytics/Reports): every mapping here reuses an
  // existing key against its already-established default bundle — no new
  // corrections needed. /admin/dashboard is STAFF-gated (all 3 roles), and
  // monitor.view already happens to be held by all three (admin fully,
  // facilitator and proctor via their existing bundles), so it doubles as
  // the "any staff member" gate without a dedicated new key.
  it("gives both facilitator and proctor monitor.view for the shared /admin/dashboard STAFF gate", () => {
    expect(resolvePermissions(user("facilitator"))).toContain("monitor.view");
    expect(resolvePermissions(user("proctor"))).toContain("monitor.view");
  });

  it("gives facilitator results.view/export and communication.view_log (matches GRADERS on analytics/reports/emails)", () => {
    const perms = resolvePermissions(user("facilitator"));
    expect(perms).toContain("results.view");
    expect(perms).toContain("results.export");
    expect(perms).toContain("communication.view_log");
  });

  it("gives proctor none of results.view/export or communication.view_log (matches admin/facilitator-only GRADERS gates)", () => {
    const perms = resolvePermissions(user("proctor"));
    expect(perms).not.toContain("results.export");
    expect(perms).not.toContain("communication.view_log");
  });

  it("gives facilitator neither students.manage nor system.settings (registrations/candidate-stats/report-scheduling were admin-only)", () => {
    const perms = resolvePermissions(user("facilitator"));
    expect(perms).not.toContain("students.manage");
    expect(perms).not.toContain("system.settings");
  });

  // Batch 11 (Rubric Library): the read was already GRADERS-gated
  // (grading.view). The two writes were admin-only with no existing grading.*
  // key that facilitator lacked, so grading.manage covers them.
  it("gives facilitator grading.view but not grading.manage (rubric writes were admin-only)", () => {
    const perms = resolvePermissions(user("facilitator"));
    expect(perms).toContain("grading.view");
    expect(perms).not.toContain("grading.manage");
  });

  it("gives admin grading.manage", () => {
    expect(resolvePermissions(user("admin"))).toContain("grading.manage");
  });

  // Batch 12 (Digital Library/Books): a brand-new "library" category, added
  // because no existing category fit and every one of the 7 book/library
  // endpoints is GRADERS-gated uniformly (view and manage are not split in
  // the real code) — so unlike most batches, facilitator gets BOTH keys.
  it("gives facilitator both library.view and library.manage (all 7 book endpoints are uniformly GRADERS-gated)", () => {
    const perms = resolvePermissions(user("facilitator"));
    expect(perms).toContain("library.view");
    expect(perms).toContain("library.manage");
  });

  it("gives proctor no library permissions (matches admin/facilitator-only GRADERS gate)", () => {
    const perms = resolvePermissions(user("proctor"));
    expect(perms).not.toContain("library.view");
    expect(perms).not.toContain("library.manage");
  });

  it("resolves a custom role's own permissions plus its parent's", async () => {
    const role: CustomRole = {
      id: "role_test1", name: "Test Coordinator", permissions: ["exams.delete"],
      parentRoleId: "system:facilitator", createdAt: "", updatedAt: "",
    };
    db.data.customRoles.push(role);
    const u = user("facilitator", { customRoleId: role.id });
    const perms = resolvePermissions(u);
    expect(perms).toContain("exams.delete");   // granted directly by the custom role
    expect(perms).toContain("org.view");        // inherited from the facilitator base bundle
    expect(perms).not.toContain("org.manage");  // not granted anywhere in the chain
  });

  it("chains inheritance through multiple custom roles", async () => {
    const parent: CustomRole = { id: "role_test2", name: "Parent", permissions: ["students.delete"], parentRoleId: "system:proctor", createdAt: "", updatedAt: "" };
    const child: CustomRole = { id: "role_test3", name: "Child", permissions: ["monitor.control"], parentRoleId: "role_test2", createdAt: "", updatedAt: "" };
    db.data.customRoles.push(parent, child);
    const u = user("proctor", { customRoleId: "role_test3" });
    const perms = resolvePermissions(u);
    expect(perms).toContain("monitor.control"); // own
    expect(perms).toContain("students.delete");  // parent
    expect(perms).toContain("monitor.view");     // grandparent (system:proctor base)
  });

  it("ignores an expired custom role assignment, falling back to the base role only", () => {
    const role: CustomRole = { id: "role_test4", name: "Expired", permissions: ["system.settings"], parentRoleId: null, createdAt: "", updatedAt: "" };
    db.data.customRoles.push(role);
    const u = user("facilitator", { customRoleId: role.id, roleExpiresAt: "2020-01-01T00:00:00.000Z" });
    expect(hasPermission(u, "system.settings")).toBe(false);
    expect(resolvePermissions(u)).toEqual(resolvePermissions(user("facilitator")));
  });

  it("does not infinite-loop on a cyclic parentRoleId chain", () => {
    const a: CustomRole = { id: "role_cycle_a", name: "A", permissions: ["org.view"], parentRoleId: "role_cycle_b", createdAt: "", updatedAt: "" };
    const b: CustomRole = { id: "role_cycle_b", name: "B", permissions: ["org.manage"], parentRoleId: "role_cycle_a", createdAt: "", updatedAt: "" };
    db.data.customRoles.push(a, b);
    const u = user("candidate", { customRoleId: "role_cycle_a" });
    expect(() => resolvePermissions(u)).not.toThrow();
  });
});
