import { describe, it, expect, beforeAll, afterAll } from "vitest";

// Verifies the nightly rollup + raw-purge job against real seeded samples —
// this is what keeps the 365-day timeline view cheap (rollups are ~7
// rows/day forever) without unbounded raw-sample retention.
process.env.PGLITE_DIR = "memory://";
delete process.env.DATABASE_URL;
process.env.RELIABILITY_RAW_RETENTION_DAYS = "7";

let db: typeof import("../server/db.ts")["db"];
let reliabilityStore: typeof import("../server/db.ts")["reliabilityStore"];
let reliabilityRollupStore: typeof import("../server/db.ts")["reliabilityRollupStore"];
let runNightlyRollup: typeof import("../server/reliability.ts")["runNightlyRollup"];

beforeAll(async () => {
  const dbMod = await import("../server/db.ts");
  db = dbMod.db;
  reliabilityStore = dbMod.reliabilityStore;
  reliabilityRollupStore = dbMod.reliabilityRollupStore;
  await dbMod.initDb();
  const relMod = await import("../server/reliability.ts");
  runNightlyRollup = relMod.runNightlyRollup;
}, 30000);

afterAll(async () => { await db.close(); });

function mkSample(id: string, subsystem: string, at: string, status: "operational" | "degraded" | "down") {
  return { id, subsystem, at, status, requestCount: 100, errorCount: status === "down" ? 100 : 0, avgLatencyMs: status === "down" ? 3000 : 100, minLatencyMs: 80, maxLatencyMs: status === "down" ? 4000 : 150, p95LatencyMs: status === "down" ? 3900 : 140, p99LatencyMs: status === "down" ? 3990 : 149 } as Parameters<typeof reliabilityStore.add>[0];
}

function yesterdayDate(): string {
  return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
}

describe("runNightlyRollup", () => {
  it("skips a subsystem with zero samples for the day (no rollup row written)", async () => {
    await runNightlyRollup();
    const date = yesterdayDate();
    const rows = await reliabilityRollupStore.forWindow("notifications", date, date);
    expect(rows.length).toBe(0);
  });

  it("aggregates a real all-down day into a rollup with 0% uptime", async () => {
    const date = yesterdayDate();
    await reliabilityStore.add(mkSample("d1", "database", `${date}T00:10:00.000Z`, "down"));
    await reliabilityStore.add(mkSample("d2", "database", `${date}T00:20:00.000Z`, "down"));
    await reliabilityStore.add(mkSample("d3", "database", `${date}T00:30:00.000Z`, "down"));

    await runNightlyRollup();

    const rows = await reliabilityRollupStore.forWindow("database", date, date);
    expect(rows.length).toBe(1);
    expect(rows[0].uptimePct).toBe(0);
    expect(rows[0].downSamples).toBe(3);
    expect(rows[0].errorCount).toBe(300);
  });

  it("aggregates a mixed day correctly (half-credit for degraded ticks)", async () => {
    const date = yesterdayDate();
    await reliabilityStore.add(mkSample("e1", "auth", `${date}T01:00:00.000Z`, "operational"));
    await reliabilityStore.add(mkSample("e2", "auth", `${date}T01:10:00.000Z`, "degraded"));

    await runNightlyRollup();

    const rows = await reliabilityRollupStore.forWindow("auth", date, date);
    // (1 up + 0.5*1 degraded) / 2 * 100 = 75
    expect(rows[0].uptimePct).toBe(75);
  });

  it("purges raw samples older than the retention window", async () => {
    const stale = new Date(Date.now() - 10 * 86_400_000).toISOString(); // 10 days ago, past the 7-day retention
    await reliabilityStore.add(mkSample("stale1", "api", stale, "operational"));
    const before = await reliabilityStore.forWindow("api", "2020-01-01T00:00:00.000Z", new Date().toISOString());
    expect(before.some((s) => s.id === "stale1")).toBe(true);

    await runNightlyRollup();

    const after = await reliabilityStore.forWindow("api", "2020-01-01T00:00:00.000Z", new Date().toISOString());
    expect(after.some((s) => s.id === "stale1")).toBe(false);
  });

  it("does not purge samples still inside the retention window", async () => {
    const fresh = new Date(Date.now() - 60_000).toISOString(); // 1 minute ago
    await reliabilityStore.add(mkSample("fresh1", "api", fresh, "operational"));
    await runNightlyRollup();
    const after = await reliabilityStore.forWindow("api", "2020-01-01T00:00:00.000Z", new Date().toISOString());
    expect(after.some((s) => s.id === "fresh1")).toBe(true);
  });

  it("is idempotent — running twice for the same day overwrites rather than duplicates", async () => {
    const date = yesterdayDate();
    const before = (await reliabilityRollupStore.forWindow("database", date, date)).length;
    await runNightlyRollup();
    const after = (await reliabilityRollupStore.forWindow("database", date, date)).length;
    expect(after).toBe(before);
  });
});
