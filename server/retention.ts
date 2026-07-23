import { db, snapshotStore, auditStore } from "./db.ts";
import { env } from "./env.ts";
import { logger } from "./logger.ts";
import { recordJobRun } from "./reliability.ts";

// Not yet tenant-aware — safe today because exactly one tenant exists; see
// server/tenant.ts's getOrgSettings.
function auditRetentionDays(): number {
  const v = db.data?.settings.find((s) => s.id === db.data?.tenants[0]?.id)?.auditRetentionDays;
  return Number.isFinite(v) && (v as number) > 0 ? Math.floor(v as number) : 0;
}

// Purge data past its retention window: proctoring webcam frames (the most
// sensitive data we hold, gated by the RETENTION_DAYS env var) and audit logs
// (gated by the org's auditRetentionDays setting).
export async function runRetentionSweep(): Promise<{ removed: number; auditRemoved: number }> {
  let removed = 0;
  if (env.retentionDays && env.retentionDays > 0) {
    const cutoff = new Date(Date.now() - env.retentionDays * 86_400_000).toISOString();
    removed = await snapshotStore.purgeOlderThan(cutoff);
    if (removed) logger.info({ removed, cutoff }, "proctoring retention sweep");
  }
  let auditRemoved = 0;
  const auditDays = auditRetentionDays();
  if (auditDays > 0) {
    const cutoff = new Date(Date.now() - auditDays * 86_400_000).toISOString();
    auditRemoved = await auditStore.purgeOlderThan(cutoff);
    if (auditRemoved) logger.info({ removed: auditRemoved, cutoff }, "audit-log retention sweep");
  }
  return { removed, auditRemoved };
}

function trackedSweep() {
  const t0 = performance.now();
  return runRetentionSweep()
    .then(() => recordJobRun("retention", true, performance.now() - t0))
    .catch((e) => {
      recordJobRun("retention", false, performance.now() - t0, e instanceof Error ? e.message : String(e));
      logger.error({ err: e }, "retention sweep failed");
    });
}

let timer: ReturnType<typeof setInterval> | null = null;

export function scheduleRetention() {
  // Always schedule — the sweep itself decides what (if anything) to purge based
  // on the env var and the org setting, either of which may change at runtime.
  void trackedSweep();
  timer = setInterval(() => void trackedSweep(), 6 * 60 * 60 * 1000);
  timer.unref?.();
}

export function stopRetention() { if (timer) { clearInterval(timer); timer = null; } }
