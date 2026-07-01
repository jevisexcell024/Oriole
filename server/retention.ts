import { db, snapshotStore, auditStore } from "./db.ts";
import { env } from "./env.ts";
import { logger } from "./logger.ts";

function auditRetentionDays(): number {
  const v = db.data?.settings.find((s) => s.id === "org")?.auditRetentionDays;
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

let timer: ReturnType<typeof setInterval> | null = null;

export function scheduleRetention() {
  // Always schedule — the sweep itself decides what (if anything) to purge based
  // on the env var and the org setting, either of which may change at runtime.
  void runRetentionSweep().catch((e) => logger.error({ err: e }, "retention sweep failed"));
  timer = setInterval(() => void runRetentionSweep().catch((e) => logger.error({ err: e }, "retention sweep failed")), 6 * 60 * 60 * 1000);
  timer.unref?.();
}

export function stopRetention() { if (timer) { clearInterval(timer); timer = null; } }
