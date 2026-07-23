import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";

// The highest-value test file for the Reliability Center: proves the exam-
// impact bucketing (auto-recovered / manual-recovery / lost) and the
// incident open→notify→auto-resolve lifecycle are computed from real seeded
// Attempt data, not fabricated — directly answering the project's own
// "Truth & trust fixes" precedent (CHANGELOG v1.3.0).
process.env.PGLITE_DIR = "memory://";
delete process.env.DATABASE_URL;

let db: typeof import("../server/db.ts")["db"];
let recordRequest: typeof import("../server/reliability.ts")["recordRequest"];
let runHealthCheckSweep: typeof import("../server/reliability.ts")["runHealthCheckSweep"];
let computeExamImpact: typeof import("../server/reliability.ts")["computeExamImpact"];
let listIncidents: typeof import("../server/reliability.ts")["listIncidents"];
let manuallyResolveIncident: typeof import("../server/reliability.ts")["manuallyResolveIncident"];
type Attempt = import("../shared/types.ts").Attempt;

beforeAll(async () => {
  const dbMod = await import("../server/db.ts");
  db = dbMod.db;
  await dbMod.initDb();
  const relMod = await import("../server/reliability.ts");
  recordRequest = relMod.recordRequest;
  runHealthCheckSweep = relMod.runHealthCheckSweep;
  computeExamImpact = relMod.computeExamImpact;
  listIncidents = relMod.listIncidents;
  manuallyResolveIncident = relMod.manuallyResolveIncident;
}, 30000);

afterAll(async () => { await db.close(); });

function fakeDeps(deadlines: Record<string, number> = {}) {
  return {
    dispatchWebhook: vi.fn(),
    sendMail: vi.fn().mockResolvedValue(undefined),
    sendSms: vi.fn().mockResolvedValue(undefined),
    attemptDeadlineMs: (a: Attempt) => deadlines[a.id] ?? Infinity, // default: never overdue unless the test says so
  };
}

function mkAttempt(over: Partial<Attempt>): Attempt {
  return {
    id: over.id ?? "a", registrationId: "r1", examId: "exam1", candidateId: over.candidateId ?? "cand1",
    startedAt: "2026-06-01T10:00:00.000Z", submittedAt: null, durationMinutes: 60,
    score: null, rawScore: null, passed: null, status: "in_progress",
    ...over,
  } as Attempt;
}

describe("computeExamImpact — real bucketing from seeded attempts", () => {
  const windowStart = "2026-06-01T10:05:00.000Z";
  const windowEnd = "2026-06-01T10:10:00.000Z";

  beforeEach(() => {
    db.data!.attempts = [];
  });

  it("buckets a cleanly-finished attempt as auto-recovered, not lost or pending", async () => {
    db.data!.attempts.push(mkAttempt({ id: "auto1", candidateId: "s1", status: "submitted", submittedAt: "2026-06-01T10:07:00.000Z" }));
    const impact = await computeExamImpact("examDelivery", windowStart, windowEnd, fakeDeps());
    expect(impact.attemptsInterrupted).toBe(1);
    expect(impact.attemptsAutoRecovered).toBe(1);
    expect(impact.attemptsRequiringManualRecovery).toBe(0);
    expect(impact.attemptsLost).toBe(0);
  });

  it("buckets a force-terminated attempt as lost", async () => {
    db.data!.attempts.push(mkAttempt({ id: "lost1", candidateId: "s2", status: "in_progress", terminated: true, terminationReason: "forced" }));
    const impact = await computeExamImpact("examDelivery", windowStart, windowEnd, fakeDeps());
    expect(impact.attemptsLost).toBe(1);
    expect(impact.attemptsAutoRecovered).toBe(0);
  });

  it("buckets an attempt that ran past its own real deadline as lost, using the injected attemptDeadlineMs", async () => {
    db.data!.attempts.push(mkAttempt({ id: "overdue1", candidateId: "s3", status: "in_progress" }));
    const deps = fakeDeps({ overdue1: new Date(windowEnd).getTime() - 1000 }); // deadline was 1s before the window closed
    const impact = await computeExamImpact("examDelivery", windowStart, windowEnd, deps);
    expect(impact.attemptsLost).toBe(1);
  });

  it("buckets a still-in-progress, not-yet-overdue attempt as requiring manual recovery (pending outcome)", async () => {
    db.data!.attempts.push(mkAttempt({ id: "pending1", candidateId: "s4", status: "in_progress" }));
    const impact = await computeExamImpact("examDelivery", windowStart, windowEnd, fakeDeps()); // deadline defaults to Infinity — never overdue
    expect(impact.attemptsRequiringManualRecovery).toBe(1);
    expect(impact.attemptsLost).toBe(0);
    expect(impact.attemptsAutoRecovered).toBe(0);
  });

  it("excludes attempts that had already submitted before the window started", async () => {
    db.data!.attempts.push(mkAttempt({ id: "before1", candidateId: "s5", status: "submitted", submittedAt: "2026-06-01T09:00:00.000Z" }));
    const impact = await computeExamImpact("examDelivery", windowStart, windowEnd, fakeDeps());
    expect(impact.attemptsOverlapping).toBe(0);
    expect(impact.attemptsInterrupted).toBe(0);
  });

  it("counts every distinct affected exam and student exactly once", async () => {
    db.data!.attempts.push(mkAttempt({ id: "m1", candidateId: "s6", examId: "examA", status: "in_progress" }));
    db.data!.attempts.push(mkAttempt({ id: "m2", candidateId: "s6", examId: "examA", status: "in_progress" })); // same student, same exam
    db.data!.attempts.push(mkAttempt({ id: "m3", candidateId: "s7", examId: "examB", status: "in_progress" }));
    const impact = await computeExamImpact("examDelivery", windowStart, windowEnd, fakeDeps());
    expect(impact.affectedExamIds.sort()).toEqual(["examA", "examB"]);
    expect(impact.studentsAffected).toBe(2);
  });

  it("never marks a subsystem that can't block exam-taking as interrupting any attempt", async () => {
    db.data!.attempts.push(mkAttempt({ id: "notif1", candidateId: "s8", status: "in_progress" }));
    for (const subsystem of ["notifications", "fileStorage", "backgroundJobs"] as const) {
      const impact = await computeExamImpact(subsystem, windowStart, windowEnd, fakeDeps());
      expect(impact.attemptsInterrupted).toBe(0);
      // still reports the exam as technically overlapping, for transparency, just not "interrupted"
      expect(impact.affectedExamIds).toEqual(["exam1"]);
    }
  });

  it("verdict is 'maintained' with no lost attempts and no recovery event", async () => {
    db.data!.attempts.push(mkAttempt({ id: "clean1", candidateId: "s9", status: "submitted", submittedAt: "2026-06-01T10:06:00.000Z" }));
    const impact = await computeExamImpact("examDelivery", windowStart, windowEnd, fakeDeps());
    expect(impact.examIntegrityVerdict).toBe("maintained");
    expect(impact.examIntegrityBasis).toMatch(/no.*lost attempts/i);
  });

  it("verdict is 'review_recommended' with a real basis when an attempt was lost", async () => {
    db.data!.attempts.push(mkAttempt({ id: "lostverdict", candidateId: "s10", status: "in_progress", terminated: true }));
    const impact = await computeExamImpact("examDelivery", windowStart, windowEnd, fakeDeps());
    expect(impact.examIntegrityVerdict).toBe("review_recommended");
    expect(impact.examIntegrityBasis).toContain("1 attempt");
  });

  it("verdict is 'review_recommended' when a real db.recovered_from_backup audit event falls inside the window", async () => {
    const dbMod = await import("../server/db.ts");
    await dbMod.auditStore.add({ id: "recov1", at: "2026-06-01T10:06:00.000Z", actorId: "system", actorName: "System", action: "db.recovered_from_backup", target: "backup-x.json.gz" });
    const impact = await computeExamImpact("database", windowStart, windowEnd, fakeDeps());
    expect(impact.examIntegrityVerdict).toBe("review_recommended");
    expect(impact.examIntegrityBasis).toMatch(/restore-from-backup/i);
  });
});

describe("incident lifecycle — open (debounced), notify, auto-resolve", () => {
  it("does not open an incident on a single bad tick (debounced)", async () => {
    recordRequest("auth", 3000, true); // one slow, erroring request — would be "down" on its own
    const { opened } = await runHealthCheckSweep(fakeDeps());
    expect(opened.map((i) => i.subsystem)).not.toContain("auth");
  });

  it("opens an incident after 2 consecutive bad ticks, with real exam-impact attached, and notifies", async () => {
    db.data!.attempts.push(mkAttempt({ id: "impacted1", candidateId: "cand-x", status: "in_progress" }));
    recordRequest("auth", 3000, true);
    const deps = fakeDeps();
    const { opened } = await runHealthCheckSweep(deps);
    const incident = opened.find((i) => i.subsystem === "auth");
    expect(incident).toBeTruthy();
    expect(incident!.status).toBe("identified");
    expect(incident!.severity).toBe("major"); // auth is not database/api, so "major" not "critical"
    expect(incident!.impact?.attemptsOverlapping).toBeGreaterThanOrEqual(1);
    expect(deps.dispatchWebhook).toHaveBeenCalledWith(expect.anything(), "incident.opened", expect.objectContaining({ subsystem: "auth" }));
  });

  it("does not open a second incident for the same subsystem while one is already open", async () => {
    recordRequest("auth", 3000, true);
    const { opened } = await runHealthCheckSweep(fakeDeps());
    expect(opened.map((i) => i.subsystem)).not.toContain("auth");
    const authIncidents = listIncidents().filter((i) => i.subsystem === "auth" && i.status !== "resolved");
    expect(authIncidents.length).toBe(1);
  });

  it("auto-resolves after 3 consecutive clean ticks and sends a resolution notification", async () => {
    const deps = fakeDeps();
    await runHealthCheckSweep(deps); // tick 1 clean
    await runHealthCheckSweep(deps); // tick 2 clean
    const { resolved } = await runHealthCheckSweep(deps); // tick 3 clean — resolves
    const incident = resolved.find((i) => i.subsystem === "auth");
    expect(incident).toBeTruthy();
    expect(incident!.status).toBe("resolved");
    expect(incident!.autoResolved).toBe(true);
    expect(deps.dispatchWebhook).toHaveBeenCalledWith(expect.anything(), "incident.resolved", expect.objectContaining({ subsystem: "auth" }));
    expect(listIncidents().filter((i) => i.subsystem === "auth" && i.status !== "resolved").length).toBe(0);
  });

  it("can be manually resolved before auto-resolution, recorded as autoResolved: false", async () => {
    recordRequest("fileStorage", 3000, true);
    await runHealthCheckSweep(fakeDeps());
    recordRequest("fileStorage", 3000, true);
    const { opened } = await runHealthCheckSweep(fakeDeps());
    const incident = opened.find((i) => i.subsystem === "fileStorage")!;
    expect(incident).toBeTruthy();

    const deps = fakeDeps();
    const manually = await manuallyResolveIncident(incident.id, deps, "Test Admin");
    expect(manually?.status).toBe("resolved");
    expect(manually?.autoResolved).toBe(false);
    expect(manually?.timeline.some((e) => e.type === "manually_resolved" && e.message.includes("Test Admin"))).toBe(true);
  });
});
