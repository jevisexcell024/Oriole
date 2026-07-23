import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Exam } from "../shared/types.ts";

// Same in-memory PGlite pattern as the other server-module tests — tenantExams()
// reads db.data.exams directly, so a real (if empty) store is needed.
process.env.PGLITE_DIR = "memory://";
delete process.env.DATABASE_URL;

let db: typeof import("../server/db.ts")["db"];
let tenantExams: typeof import("../server/tenant.ts")["tenantExams"];

beforeAll(async () => {
  const dbMod = await import("../server/db.ts");
  db = dbMod.db;
  await dbMod.initDb();
  const tenantMod = await import("../server/tenant.ts");
  tenantExams = tenantMod.tenantExams;
}, 30000);

afterAll(async () => { await db.close(); });

function exam(tenantId: string, title: string): Exam {
  return {
    id: "ex_" + Math.random().toString(36).slice(2),
    tenantId,
    title,
    code: title.toUpperCase().replace(/\s+/g, "-"),
    description: "",
    durationMinutes: 60,
    passingScore: 60,
    proctored: false,
    status: "published",
    enrollment: "open",
    lockdown: {} as Exam["lockdown"],
    createdAt: new Date().toISOString(),
  } as Exam;
}

describe("tenantExams (server/tenant.ts) — the first proven tenant-isolation route", () => {
  it("only returns exams belonging to the requested tenant, never another tenant's", () => {
    const tenantA = "tenant_a_" + Math.random().toString(36).slice(2);
    const tenantB = "tenant_b_" + Math.random().toString(36).slice(2);

    const examA1 = exam(tenantA, "Tenant A — Biology 101");
    const examA2 = exam(tenantA, "Tenant A — Chemistry 201");
    const examB1 = exam(tenantB, "Tenant B — History 101");
    db.data!.exams.push(examA1, examA2, examB1);

    const resultsForA = tenantExams(tenantA);
    expect(resultsForA.map((e) => e.id).sort()).toEqual([examA1.id, examA2.id].sort());
    expect(resultsForA.some((e) => e.id === examB1.id)).toBe(false);

    const resultsForB = tenantExams(tenantB);
    expect(resultsForB.map((e) => e.id)).toEqual([examB1.id]);
    expect(resultsForB.some((e) => e.id === examA1.id || e.id === examA2.id)).toBe(false);
  });

  it("returns nothing for a tenant id that matches no exam", () => {
    expect(tenantExams("no_such_tenant_" + Math.random().toString(36).slice(2))).toEqual([]);
  });

  it("returns nothing for a null tenant id (unauthenticated) rather than every exam", () => {
    // A genuine unauthenticated caller must never fall through to seeing
    // everything — this pins that currentTenantId's null case can't leak
    // cross-tenant data via a permissive filter (e.g. `=== null` matching
    // an exam whose tenantId also happens to be undefined/null).
    const orphan = exam("some_real_tenant", "Orphan check");
    db.data!.exams.push(orphan);
    expect(tenantExams(null)).toEqual([]);
  });
});
