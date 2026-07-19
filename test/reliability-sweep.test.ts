import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Exercise the real sweep against an in-memory PGlite instance, the same way
// test/db.test.ts does — this proves the middleware→ring-buffer→sweep→
// persistence pipeline actually writes real, plausible numbers, not just that
// the pure math in shared/reliability.test.ts is correct in isolation.
process.env.PGLITE_DIR = "memory://";
delete process.env.DATABASE_URL;

let db: typeof import("../server/db.ts")["db"];
let reliabilityStore: typeof import("../server/db.ts")["reliabilityStore"];
let recordRequest: typeof import("../server/reliability.ts")["recordRequest"];
let runHealthCheckSweep: typeof import("../server/reliability.ts")["runHealthCheckSweep"];
let recordJobRun: typeof import("../server/reliability.ts")["recordJobRun"];
let getLiveMetrics: typeof import("../server/reliability.ts")["getLiveMetrics"];

beforeAll(async () => {
  const dbMod = await import("../server/db.ts");
  db = dbMod.db;
  reliabilityStore = dbMod.reliabilityStore;
  await dbMod.initDb();
  const relMod = await import("../server/reliability.ts");
  recordRequest = relMod.recordRequest;
  runHealthCheckSweep = relMod.runHealthCheckSweep;
  recordJobRun = relMod.recordJobRun;
  getLiveMetrics = relMod.getLiveMetrics;
}, 30000);

afterAll(async () => { await db.close(); });

function fakeDeps() {
  return { dispatchWebhook: vi.fn(), sendMail: vi.fn().mockResolvedValue(undefined), sendSms: vi.fn().mockResolvedValue(undefined) };
}

describe("runHealthCheckSweep", () => {
  it("persists one real sample per subsystem, reflecting recorded request traffic", async () => {
    recordRequest("api", 50, false);
    recordRequest("api", 80, false);
    recordRequest("api", 5000, true); // one slow error, should show up in requestCount/errorCount, not be silently dropped
    recordRequest("auth", 30, false);

    const before = new Date(Date.now() - 1000).toISOString();
    await runHealthCheckSweep(fakeDeps());
    const after = new Date(Date.now() + 1000).toISOString();

    const samples = await reliabilityStore.forWindow(null, before, after);
    const bySubsystem = Object.fromEntries(samples.map((s) => [s.subsystem, s]));

    // All 7 subsystems produced a sample this tick.
    expect(Object.keys(bySubsystem).sort()).toEqual(["api", "auth", "backgroundJobs", "database", "examDelivery", "fileStorage", "notifications"]);

    const api = bySubsystem.api;
    expect(api.requestCount).toBe(3);
    expect(api.errorCount).toBe(1);
    expect(api.avgLatencyMs).toBeGreaterThan(0);
    expect(api.maxLatencyMs).toBeGreaterThanOrEqual(5000);

    const auth = bySubsystem.auth;
    expect(auth.requestCount).toBe(1);
    expect(auth.errorCount).toBe(0);

    // Database subsystem reflects a real db.ping() round-trip, not a placeholder.
    expect(bySubsystem.database.status).toBe("operational");
    expect(bySubsystem.database.meta?.dbRoundTripMs).toBeTypeOf("number");
  });

  it("drains the ring buffer — a second sweep with no new traffic reports zero requests", async () => {
    const before = new Date().toISOString();
    await runHealthCheckSweep(fakeDeps());
    const after = new Date(Date.now() + 1000).toISOString();
    const samples = await reliabilityStore.forWindow("api", before, after);
    expect(samples[samples.length - 1].requestCount).toBe(0);
  });

  it("reflects a real recorded background-job failure in the backgroundJobs sample", async () => {
    recordJobRun("test_job", false, 120, "boom");
    const before = new Date().toISOString();
    await runHealthCheckSweep(fakeDeps());
    const after = new Date(Date.now() + 1000).toISOString();
    const samples = await reliabilityStore.forWindow("backgroundJobs", before, after);
    const latest = samples[samples.length - 1];
    expect(latest.status).toBe("down");
    expect((latest.meta?.jobs as Record<string, { lastError: string | null }>)?.test_job?.lastError).toBe("boom");
  });

  it("clears a background-job failure once the job reports success again", async () => {
    recordJobRun("test_job", true, 80);
    const before = new Date().toISOString();
    await runHealthCheckSweep(fakeDeps());
    const after = new Date(Date.now() + 1000).toISOString();
    const samples = await reliabilityStore.forWindow("backgroundJobs", before, after);
    expect(samples[samples.length - 1].status).toBe("operational");
  });
});

describe("getLiveMetrics", () => {
  it("returns real, plausible process/OS numbers", () => {
    const m = getLiveMetrics();
    expect(m.rssMb).toBeGreaterThan(0);
    expect(m.cpuCount).toBeGreaterThan(0);
    expect(m.loadavg1).toBeGreaterThanOrEqual(0);
    expect(m.activeAttempts).toBe(0); // no attempts seeded in this test's fresh in-memory DB
  });
});
