import { describe, it, expect, beforeAll, afterAll } from "vitest";

// Exercise the real storage layer against an in-memory PGlite instance — the
// same code path (CREATE TABLE, jsonb upsert/read/remove) that runs on managed
// Postgres in production.
process.env.PGLITE_DIR = "memory://";
delete process.env.DATABASE_URL;

let db: typeof import("../server/db.ts")["db"];
let snapshotStore: typeof import("../server/db.ts")["snapshotStore"];
let auditStore: typeof import("../server/db.ts")["auditStore"];
let emailStore: typeof import("../server/db.ts")["emailStore"];
let proctorStore: typeof import("../server/db.ts")["proctorStore"];
let answerStore: typeof import("../server/db.ts")["answerStore"];
let reliabilityStore: typeof import("../server/db.ts")["reliabilityStore"];
let reliabilityRollupStore: typeof import("../server/db.ts")["reliabilityRollupStore"];
let dumpAll: typeof import("../server/db.ts")["dumpAll"];

// PGlite's WASM cold-start + the full CREATE TABLE/INDEX migration in initDb()
// genuinely takes ~11-12s on some machines, past vitest's default 10s hook timeout.
beforeAll(async () => {
  const mod = await import("../server/db.ts");
  db = mod.db;
  snapshotStore = mod.snapshotStore;
  auditStore = mod.auditStore;
  emailStore = mod.emailStore;
  proctorStore = mod.proctorStore;
  answerStore = mod.answerStore;
  reliabilityStore = mod.reliabilityStore;
  reliabilityRollupStore = mod.reliabilityRollupStore;
  dumpAll = mod.dumpAll;
  await mod.initDb();
}, 30000);

afterAll(async () => { await db.close(); });

describe("storage layer", () => {
  it("initializes the embedded backend", () => {
    expect(db.backendKind()).toBe("pglite");
  });

  it("answers a readiness ping", async () => {
    await expect(db.ping()).resolves.toBeUndefined();
  });

  it("ensures the singleton org-settings row exists after init", () => {
    expect(db.data.settings.find((s) => s.id === "org")).toBeTruthy();
  });

  it("persists and reads back a row via upsert + read", async () => {
    const user = { id: "test_u1", email: "t@x.com", name: "Test User", role: "candidate", passwordHash: "x" } as unknown as typeof db.data.users[number];
    await db.upsert("users", user);
    // Wipe the in-memory mirror and reload from storage to prove durability.
    db.data.users = [];
    await db.read();
    expect(db.data.users.find((u) => u.id === "test_u1")?.email).toBe("t@x.com");
  });

  it("removes a row", async () => {
    await db.remove("users", "test_u1");
    db.data.users = [];
    await db.read();
    expect(db.data.users.find((u) => u.id === "test_u1")).toBeUndefined();
  });
});

describe("snapshotStore (off-mirror, indexed by attempt)", () => {
  const mk = (n: number, at: string) => ({ id: `s${n}`, attemptId: "att1", at, dataUrl: `frame${n}` });

  it("adds frames and lists them oldest-first", async () => {
    await snapshotStore.add(mk(1, "2026-01-01T00:00:01Z"));
    await snapshotStore.add(mk(2, "2026-01-01T00:00:02Z"));
    const list = await snapshotStore.forAttempt("att1");
    expect(list.map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  it("returns the latest frame", async () => {
    expect((await snapshotStore.latest("att1"))?.id).toBe("s2");
  });

  it("trims to the most recent N", async () => {
    await snapshotStore.add(mk(3, "2026-01-01T00:00:03Z"));
    await snapshotStore.trim("att1", 2);
    const list = await snapshotStore.forAttempt("att1");
    expect(list.map((s) => s.id)).toEqual(["s2", "s3"]);
  });

  it("purges frames older than a cutoff", async () => {
    const removed = await snapshotStore.purgeOlderThan("2026-01-01T00:00:03Z");
    expect(removed).toBe(1); // s2 dropped, s3 kept
    expect((await snapshotStore.forAttempt("att1")).map((s) => s.id)).toEqual(["s3"]);
  });

  it("removes all frames for given attempts", async () => {
    await snapshotStore.removeForAttempts(["att1"]);
    expect(await snapshotStore.forAttempt("att1")).toEqual([]);
  });

  it("is never held in the in-memory mirror", () => {
    expect((db.data as Record<string, unknown>).snapshots).toBeUndefined();
  });
});

describe("auditStore & emailStore (off-mirror append-only logs)", () => {
  it("records audit entries and returns them newest-first", async () => {
    await auditStore.add({ id: "a1", at: "2026-02-01T00:00:01Z", actorId: "u", actorName: "U", action: "x", target: "t1" });
    await auditStore.add({ id: "a2", at: "2026-02-01T00:00:02Z", actorId: "u", actorName: "U", action: "x", target: "t2" });
    const recent = await auditStore.recent(10);
    expect(recent[0].id).toBe("a2"); // newest first
    expect(recent.map((l) => l.id)).toContain("a1");
  });

  it("respects the audit recent() limit", async () => {
    expect((await auditStore.recent(1)).length).toBe(1);
    expect(await auditStore.count()).toBeGreaterThanOrEqual(2);
  });

  it("logs emails newest-first by send time", async () => {
    await emailStore.add({ id: "e1", to: "a@x.com", subject: "s1", body: "b", sentAt: "2026-02-01T00:00:01Z", delivery: "logged", provider: "mock" } as Parameters<typeof emailStore.add>[0]);
    await emailStore.add({ id: "e2", to: "b@x.com", subject: "s2", body: "b", sentAt: "2026-02-01T00:00:02Z", delivery: "logged", provider: "mock" } as Parameters<typeof emailStore.add>[0]);
    const recent = await emailStore.recent(10);
    expect(recent[0].id).toBe("e2");
    expect(await emailStore.count()).toBeGreaterThanOrEqual(2);
  });

  it("keeps neither log in the in-memory mirror", () => {
    const mirror = db.data as Record<string, unknown>;
    expect(mirror.auditLogs).toBeUndefined();
    expect(mirror.emails).toBeUndefined();
  });
});

describe("proctorStore (off-mirror, batched by attempt)", () => {
  const ev = (id: string, attemptId: string, severity: string, at: string, type = "tab_switch") =>
    ({ id, attemptId, type, severity, message: "", at } as Parameters<typeof proctorStore.add>[0]);

  it("adds events and lists them per attempt oldest-first", async () => {
    await proctorStore.add(ev("p1", "ax1", "info", "2026-03-01T00:00:01Z"));
    await proctorStore.add(ev("p2", "ax1", "high", "2026-03-01T00:00:02Z"));
    await proctorStore.add(ev("p3", "ax2", "warning", "2026-03-01T00:00:03Z"));
    expect((await proctorStore.forAttempt("ax1")).map((e) => e.id)).toEqual(["p1", "p2"]);
  });

  it("batches many attempts in one query into a Map", async () => {
    const map = await proctorStore.forAttempts(["ax1", "ax2"]);
    expect(map.get("ax1")?.length).toBe(2);
    expect(map.get("ax2")?.length).toBe(1);
  });

  it("allFlagged excludes info-severity events", async () => {
    const flagged = await proctorStore.allFlagged();
    const ids = flagged.map((e) => e.id);
    expect(ids).toContain("p2");
    expect(ids).toContain("p3");
    expect(ids).not.toContain("p1");
  });

  it("removes events for given attempts", async () => {
    await proctorStore.removeForAttempts(["ax1", "ax2"]);
    expect(await proctorStore.forAttempt("ax1")).toEqual([]);
  });

  it("is not held in the in-memory mirror", () => {
    expect((db.data as Record<string, unknown>).proctorEvents).toBeUndefined();
  });
});

describe("answerStore (off-mirror, indexed by attempt)", () => {
  const mk = (id: string, attemptId: string, questionId: string, value: string) =>
    ({ id, attemptId, questionId, value, correct: null } as Parameters<typeof answerStore.upsert>[0]);

  it("upserts and reads answers per attempt", async () => {
    await answerStore.upsert(mk("an1", "att9", "q1", "A"));
    await answerStore.upsert(mk("an2", "att9", "q2", "B"));
    expect((await answerStore.forAttempt("att9")).map((a) => a.id).sort()).toEqual(["an1", "an2"]);
  });

  it("updates an existing answer in place (same id)", async () => {
    await answerStore.upsert({ ...mk("an1", "att9", "q1", "CHANGED"), awardedPoints: 5 } as Parameters<typeof answerStore.upsert>[0]);
    const a = await answerStore.byId("an1");
    expect(a?.value).toBe("CHANGED");
    expect(a?.awardedPoints).toBe(5);
    expect((await answerStore.forAttempt("att9")).length).toBe(2); // not duplicated
  });

  it("finds a single answer by attempt + question", async () => {
    expect((await answerStore.forAttemptQuestion("att9", "q2"))?.id).toBe("an2");
  });

  it("batches answers for many attempts", async () => {
    await answerStore.upsert(mk("an3", "att10", "q1", "C"));
    const map = await answerStore.forAttempts(["att9", "att10"]);
    expect(map.get("att9")?.length).toBe(2);
    expect(map.get("att10")?.length).toBe(1);
  });

  it("removes answers for given attempts", async () => {
    await answerStore.removeForAttempts(["att9", "att10"]);
    expect(await answerStore.forAttempt("att9")).toEqual([]);
  });

  it("is not held in the in-memory mirror", () => {
    expect((db.data as Record<string, unknown>).answers).toBeUndefined();
  });
});

describe("reliabilityStore (off-mirror raw samples, indexed by subsystem + time)", () => {
  const mk = (id: string, subsystem: string, at: string, status = "operational") =>
    ({ id, subsystem, at, status, requestCount: 10, errorCount: 0, avgLatencyMs: 100, minLatencyMs: 80, maxLatencyMs: 150, p95LatencyMs: 140, p99LatencyMs: 149 } as Parameters<typeof reliabilityStore.add>[0]);

  it("adds samples and reads them back within a time window, oldest-first", async () => {
    await reliabilityStore.add(mk("rs1", "database", "2026-05-01T00:00:00Z"));
    await reliabilityStore.add(mk("rs2", "database", "2026-05-01T00:01:00Z"));
    await reliabilityStore.add(mk("rs3", "examDelivery", "2026-05-01T00:02:00Z"));
    const dbOnly = await reliabilityStore.forWindow("database", "2026-05-01T00:00:00Z", "2026-05-01T23:59:59Z");
    expect(dbOnly.map((s) => s.id)).toEqual(["rs1", "rs2"]);
  });

  it("returns every subsystem when none is specified", async () => {
    const all = await reliabilityStore.forWindow(null, "2026-05-01T00:00:00Z", "2026-05-01T23:59:59Z");
    expect(all.map((s) => s.id).sort()).toEqual(["rs1", "rs2", "rs3"]);
  });

  it("excludes samples outside the window", async () => {
    const none = await reliabilityStore.forWindow("database", "2026-06-01T00:00:00Z", "2026-06-02T00:00:00Z");
    expect(none).toEqual([]);
  });

  it("purges samples older than a cutoff", async () => {
    const removed = await reliabilityStore.purgeOlderThan("2026-05-01T00:01:30Z");
    expect(removed).toBe(2); // rs1, rs2 dropped (rs3 kept — after cutoff)
    const remaining = await reliabilityStore.forWindow(null, "2026-05-01T00:00:00Z", "2026-05-01T23:59:59Z");
    expect(remaining.map((s) => s.id)).toEqual(["rs3"]);
  });

  it("is never held in the in-memory mirror", () => {
    expect((db.data as Record<string, unknown>).reliabilitySamples).toBeUndefined();
  });
});

describe("reliabilityRollupStore (off-mirror daily aggregates)", () => {
  const mk = (subsystem: string, date: string, uptimePct: number) =>
    ({ id: `${subsystem}:${date}`, subsystem, date, sampleCount: 1440, upSamples: 1440, degradedSamples: 0, downSamples: 0, uptimePct, avgLatencyMs: 100, minLatencyMs: 80, maxLatencyMs: 150, p95LatencyMs: 140, p99LatencyMs: 149, requestCount: 1000, errorCount: 0 } as Parameters<typeof reliabilityRollupStore.upsert>[0]);

  it("upserts a rollup and reads it back within a date window", async () => {
    await reliabilityRollupStore.upsert(mk("database", "2026-05-01", 100));
    await reliabilityRollupStore.upsert(mk("database", "2026-05-02", 99.9));
    const rows = await reliabilityRollupStore.forWindow("database", "2026-05-01", "2026-05-02");
    expect(rows.map((r) => r.date)).toEqual(["2026-05-01", "2026-05-02"]);
  });

  it("updates an existing rollup in place (same id) rather than duplicating", async () => {
    await reliabilityRollupStore.upsert(mk("database", "2026-05-01", 95));
    const rows = await reliabilityRollupStore.forWindow("database", "2026-05-01", "2026-05-01");
    expect(rows.length).toBe(1);
    expect(rows[0].uptimePct).toBe(95);
  });

  it("is never held in the in-memory mirror", () => {
    expect((db.data as Record<string, unknown>).reliabilityDailyRollups).toBeUndefined();
  });
});

describe("reliabilityIncidents (mirrored collection)", () => {
  it("is part of the in-memory mirror and survives a re-read", async () => {
    await db.upsert("reliabilityIncidents", {
      id: "inc1", subsystem: "database", severity: "major", status: "resolved",
      title: "Elevated database latency", openedAt: "2026-05-01T00:00:00Z", resolvedAt: "2026-05-01T00:05:00Z",
      autoResolved: true, timeline: [], impact: null,
    } as unknown as typeof db.data.reliabilityIncidents[number]);
    db.data.reliabilityIncidents = [];
    await db.read();
    expect(db.data.reliabilityIncidents.find((i) => i.id === "inc1")?.title).toBe("Elevated database latency");
  });
});

describe("dumpAll includes the new reliability tables", () => {
  it("includes reliability_samples, reliability_daily_rollups, and reliabilityIncidents in a full backup dump", async () => {
    const dump = await dumpAll();
    expect(Array.isArray(dump.reliability_samples)).toBe(true);
    expect(Array.isArray(dump.reliability_daily_rollups)).toBe(true);
    expect(Array.isArray(dump.reliabilityIncidents)).toBe(true);
    expect((dump.reliability_samples as { id: string }[]).some((s) => s.id === "rs3")).toBe(true);
    expect((dump.reliability_daily_rollups as { id: string }[]).some((r) => r.id === "database:2026-05-01")).toBe(true);
    expect((dump.reliabilityIncidents as { id: string }[]).some((i) => i.id === "inc1")).toBe(true);
  });
});
