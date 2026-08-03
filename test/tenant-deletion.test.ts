import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Tenant, User, Exam, Attempt, Answer } from "../shared/types.ts";

// Same in-memory PGlite pattern as tenant-isolation.test.ts — exportTenantData/
// deleteTenantData read and write real tables (mirrored + off-mirror), so a
// real (if empty) store is needed, not just an in-memory array.
process.env.PGLITE_DIR = "memory://";
delete process.env.DATABASE_URL;

let db: typeof import("../server/db.ts")["db"];
let exportTenantData: typeof import("../server/db.ts")["exportTenantData"];
let deleteTenantData: typeof import("../server/db.ts")["deleteTenantData"];
let answerStore: typeof import("../server/db.ts")["answerStore"];

beforeAll(async () => {
  const dbMod = await import("../server/db.ts");
  db = dbMod.db;
  await dbMod.initDb();
  exportTenantData = dbMod.exportTenantData;
  deleteTenantData = dbMod.deleteTenantData;
  answerStore = dbMod.answerStore;
}, 30000);

afterAll(async () => { await db.close(); });

function makeTenant(): Tenant {
  return { id: "t_" + Math.random().toString(36).slice(2), name: "Export/Delete Test School", status: "active", createdAt: new Date().toISOString() };
}
function makeUser(tenantId: string): User {
  return {
    id: "u_" + Math.random().toString(36).slice(2), tenantId, email: "admin@export-test.dev", name: "Test Admin",
    passwordHash: "super-secret-hash", role: "admin", twoFactorSecret: "TOTP_SECRET_SHOULD_NEVER_LEAVE",
  } as User;
}
function makeExam(tenantId: string): Exam {
  return {
    id: "ex_" + Math.random().toString(36).slice(2), tenantId, title: "A Test Exam", code: "TEST-EXAM",
    description: "", durationMinutes: 60, passingScore: 60, proctored: false, status: "published",
    enrollment: "open", lockdown: {} as Exam["lockdown"], createdAt: new Date().toISOString(),
  } as Exam;
}
function makeAttempt(tenantId: string, examId: string): Attempt {
  return {
    id: "at_" + Math.random().toString(36).slice(2), tenantId, registrationId: "reg_x", examId,
    candidateId: "cand_x", startedAt: new Date().toISOString(), submittedAt: null, durationMinutes: 60,
    score: null, passed: null, status: "in_progress",
  } as Attempt;
}

describe("Tenant export/delete (server/db.ts) — the compliance/offboarding tools", () => {
  it("exportTenantData includes only this tenant's rows, and strips password/2FA secrets", async () => {
    const tenantA = makeTenant();
    const tenantB = makeTenant();
    const userA = makeUser(tenantA.id);
    const userB = makeUser(tenantB.id);
    db.data!.tenants.push(tenantA, tenantB);
    db.data!.users.push(userA, userB);

    const bundle = await exportTenantData(tenantA.id);
    const exportedUsers = bundle.users as Record<string, unknown>[];
    expect(exportedUsers.map((u) => u.id)).toEqual([userA.id]);
    expect(exportedUsers[0].passwordHash).toBeUndefined();
    expect(exportedUsers[0].twoFactorSecret).toBeUndefined();
    expect((bundle.tenant as Tenant[])[0].id).toBe(tenantA.id);
  });

  it("deleteTenantData removes every row this tenant owns, leaves every other tenant untouched, and removes the tenant itself", async () => {
    const tenantA = makeTenant();
    const tenantB = makeTenant();
    const userA = makeUser(tenantA.id);
    const userB = makeUser(tenantB.id);
    const examA = makeExam(tenantA.id);
    const examB = makeExam(tenantB.id);
    db.data!.tenants.push(tenantA, tenantB);
    db.data!.users.push(userA, userB);
    db.data!.exams.push(examA, examB);

    const counts = await deleteTenantData(tenantA.id);
    expect(counts.users).toBe(1);
    expect(counts.exams).toBe(1);

    expect(db.data!.tenants.some((t) => t.id === tenantA.id)).toBe(false);
    expect(db.data!.users.some((u) => u.id === userA.id)).toBe(false);
    expect(db.data!.exams.some((e) => e.id === examA.id)).toBe(false);

    // The other tenant's data must survive completely intact — a cascade
    // delete scoped to the wrong tenant would be a platform-wide incident,
    // not a contained mistake.
    expect(db.data!.tenants.some((t) => t.id === tenantB.id)).toBe(true);
    expect(db.data!.users.some((u) => u.id === userB.id)).toBe(true);
    expect(db.data!.exams.some((e) => e.id === examB.id)).toBe(true);
  });

  it("is a safe no-op (all-zero counts) for a tenant id that owns nothing", async () => {
    const counts = await deleteTenantData("no_such_tenant_" + Math.random().toString(36).slice(2));
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
  });

  // Regression test for a real bug: answerStore.upsert() (and the other 4
  // off-mirror stores) never wrote a tenant_id, so a second tenant's answers
  // never got tagged and exportTenantData silently missed them. tenant_id is
  // now resolved from the owning attempt at insert time.
  it("off-mirror rows (e.g. answers) are correctly tenant-scoped for a SECOND tenant, not just the first", async () => {
    const tenantA = makeTenant();
    const tenantB = makeTenant();
    const examA = makeExam(tenantA.id);
    const examB = makeExam(tenantB.id);
    const attemptA = makeAttempt(tenantA.id, examA.id);
    const attemptB = makeAttempt(tenantB.id, examB.id);
    db.data!.tenants.push(tenantA, tenantB);
    db.data!.exams.push(examA, examB);
    db.data!.attempts.push(attemptA, attemptB);

    const answerA: Answer = { id: "ans_" + Math.random().toString(36).slice(2), attemptId: attemptA.id, questionId: "q1", value: "42", correct: true };
    const answerB: Answer = { id: "ans_" + Math.random().toString(36).slice(2), attemptId: attemptB.id, questionId: "q1", value: "7", correct: false };
    await answerStore.upsert(answerA);
    await answerStore.upsert(answerB);

    const bundleA = await exportTenantData(tenantA.id);
    const bundleB = await exportTenantData(tenantB.id);
    expect((bundleA.answers as Answer[]).map((a) => a.id)).toEqual([answerA.id]);
    expect((bundleB.answers as Answer[]).map((a) => a.id)).toEqual([answerB.id]);
  });
});
