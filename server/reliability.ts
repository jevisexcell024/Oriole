// Status & Reliability Center — health-check sweep, request instrumentation,
// and incident lifecycle. Mirrors backup.ts's idiom (module-scoped state, an
// async run function, schedule/stop pair). dispatchWebhook/sendMail/sendSms
// are injected as `deps` rather than imported, since dispatchWebhook lives
// inside server/index.ts (which imports this module) — importing it back
// here would be circular. Keeping this module dependency-free from index.ts
// also means it can be exercised in tests with plain fakes, no Express needed.
//
// Every number this module persists must be a real measurement — no
// simulated/hardcoded values anywhere (see the "Truth & trust fixes" release
// in CHANGELOG.md's v1.3.0 entry, which is exactly the standard this exists
// to uphold for platform-health data specifically).

import os from "node:os";
import { nanoid } from "nanoid";
import { db, reliabilityStore, reliabilityRollupStore, auditStore } from "./db.ts";
import { logger } from "./logger.ts";
import { mailerStatus } from "./mailer.ts";
import { smsStatus, smsEnabled } from "./sms.ts";
import { classifyStatus, aggregateDailyRollup, percentile, DEFAULT_STATUS_THRESHOLDS, type StatusThresholds } from "../shared/reliability.ts";
import type { ReliabilitySubsystemKey, ReliabilitySample, ReliabilityStatus, ReliabilityIncident, ReliabilityIncidentEvent, WebhookEvent, ExamImpactAnalysis, Attempt, OrgSettings } from "../shared/types.ts";
import { RELIABILITY_SUBSYSTEMS } from "../shared/types.ts";

// Mirrors backup.ts's own precedent of duplicating a tiny settings/dir helper
// rather than importing it from server/index.ts, which would be circular
// (index.ts is what imports this module).
function localGetSettings(): OrgSettings {
  return db.data!.settings.find((s) => s.id === "org")!;
}

const SUBSYSTEM_LABELS: Record<ReliabilitySubsystemKey, string> = {
  api: "API", database: "Database", examDelivery: "Exam Delivery", auth: "Authentication",
  notifications: "Notifications", fileStorage: "File Storage", backgroundJobs: "Background Jobs",
};
export function subsystemLabel(s: ReliabilitySubsystemKey): string {
  return SUBSYSTEM_LABELS[s];
}

/** Explicit field whitelist for the unauthenticated public status page — never
 *  spread the full incident object here. Deliberately excludes `impact`
 *  (exam/student counts and identities), latency/error numbers, and timeline
 *  message text (which can embed impact figures) — only the event type and
 *  timestamp survive, matching a standard public incident timeline. */
export interface PublicIncident {
  id: string; title: string; subsystem: string; severity: ReliabilityIncident["severity"];
  status: ReliabilityIncident["status"]; openedAt: string; resolvedAt: string | null;
  timeline: { type: ReliabilityIncidentEvent["type"]; at: string }[];
}
export function toPublicIncident(i: ReliabilityIncident): PublicIncident {
  return {
    id: i.id, title: i.title, subsystem: SUBSYSTEM_LABELS[i.subsystem], severity: i.severity,
    status: i.status, openedAt: i.openedAt, resolvedAt: i.resolvedAt,
    timeline: i.timeline.map((e) => ({ type: e.type, at: e.at })),
  };
}

export type { ReliabilitySubsystemKey };

// ---------------------------------------------------------------------------
// Configurable thresholds / retention — env-overridable, never hardcoded
// magic numbers baked into the trust-critical detection logic.

function resolveThresholds(): StatusThresholds {
  return {
    degradedLatencyMs: Number(process.env.RELIABILITY_DEGRADED_LATENCY_MS ?? DEFAULT_STATUS_THRESHOLDS.degradedLatencyMs),
    downLatencyMs: Number(process.env.RELIABILITY_DOWN_LATENCY_MS ?? DEFAULT_STATUS_THRESHOLDS.downLatencyMs),
    degradedErrorRate: Number(process.env.RELIABILITY_DEGRADED_ERROR_RATE ?? DEFAULT_STATUS_THRESHOLDS.degradedErrorRate),
    downErrorRate: Number(process.env.RELIABILITY_DOWN_ERROR_RATE ?? DEFAULT_STATUS_THRESHOLDS.downErrorRate),
  };
}

export function rawRetentionDays(): number {
  const n = Number(process.env.RELIABILITY_RAW_RETENTION_DAYS ?? 7);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 7;
}

const SWEEP_INTERVAL_MS = 60_000;
const RING_CAP = 2000;

// ---------------------------------------------------------------------------
// Request instrumentation — a bounded in-memory ring buffer per subsystem.
// recordRequest() is called from the Express middleware (mounted in
// index.ts); each sweep tick drains the buffer into real avg/min/max/p95/p99
// numbers and only those five derived numbers are persisted — raw per-request
// timings never touch disk.

const REQUEST_SUBSYSTEMS = ["api", "examDelivery", "auth", "fileStorage"] as const;
type RequestSubsystem = (typeof REQUEST_SUBSYSTEMS)[number];

interface RingBuffer { durations: number[]; total: number; errors: number; }
function emptyRing(): RingBuffer { return { durations: [], total: 0, errors: 0 }; }
const ringBuffers: Record<RequestSubsystem, RingBuffer> = {
  api: emptyRing(), examDelivery: emptyRing(), auth: emptyRing(), fileStorage: emptyRing(),
};

export function recordRequest(subsystem: RequestSubsystem, durationMs: number, isError: boolean) {
  const buf = ringBuffers[subsystem];
  buf.total++;
  if (isError) buf.errors++;
  buf.durations.push(durationMs);
  if (buf.durations.length > RING_CAP) buf.durations.shift();
}

interface DrainedStats { count: number; errors: number; avg: number | null; min: number | null; max: number | null; p95: number | null; p99: number | null; }

function drainBuffer(subsystem: RequestSubsystem): DrainedStats {
  const buf = ringBuffers[subsystem];
  const { durations, total, errors } = buf;
  ringBuffers[subsystem] = emptyRing();
  if (durations.length === 0) return { count: total, errors, avg: null, min: null, max: null, p95: null, p99: null };
  const sorted = [...durations].sort((a, b) => a - b);
  return {
    count: total, errors,
    avg: durations.reduce((a, b) => a + b, 0) / durations.length,
    min: sorted[0], max: sorted[sorted.length - 1],
    p95: percentile(sorted, 95), p99: percentile(sorted, 99),
  };
}

// Path → subsystem bucketing for the Express middleware. `api` counts every
// request; the others are a second, narrower bucket for requests that also
// match a more specific prefix (a request can count toward both).
const PATH_RULES: [RegExp, RequestSubsystem][] = [
  [/^\/api\/auth\b/, "auth"],
  [/^\/api\/(exams|registrations|attempts|code|certificates|my|practice)\b/, "examDelivery"],
  [/^\/api\/(admin\/)?books\b/, "fileStorage"],
];

export function reliabilityMiddleware(req: { path: string }, res: { statusCode: number; on: (ev: string, cb: () => void) => void }, next: () => void) {
  if (!req.path.startsWith("/api")) return next();
  const start = performance.now();
  res.on("finish", () => {
    const durationMs = performance.now() - start;
    const isError = res.statusCode >= 500;
    recordRequest("api", durationMs, isError);
    for (const [re, key] of PATH_RULES) {
      if (re.test(req.path)) { recordRequest(key, durationMs, isError); break; }
    }
  });
  next();
}

// ---------------------------------------------------------------------------
// Database subsystem — a real round-trip timing around db.ping().

async function measureDatabase(t: StatusThresholds): Promise<{ status: ReliabilityStatus; avgLatencyMs: number | null; meta: Record<string, unknown> }> {
  const t0 = performance.now();
  try {
    await db.ping();
    const ms = performance.now() - t0;
    return { status: classifyStatus({ avgLatencyMs: ms, errorRate: 0 }, t), avgLatencyMs: ms, meta: { dbRoundTripMs: Math.round(ms * 10) / 10 } };
  } catch (e) {
    return { status: "down", avgLatencyMs: null, meta: { dbPingError: e instanceof Error ? e.message : String(e) } };
  }
}

// ---------------------------------------------------------------------------
// Background-job status tracking — existing sweep functions in index.ts call
// recordJobRun() (wired in Batch 3); mirrors backup.ts's lastXAt/lastXError
// idiom, generalized across every recurring job by name.

export interface JobStatus { lastAt: string | null; lastError: string | null; lastDurationMs: number | null; }
const jobStatusMap = new Map<string, JobStatus>();

export function recordJobRun(jobName: string, ok: boolean, durationMs: number, error?: string) {
  jobStatusMap.set(jobName, { lastAt: new Date().toISOString(), lastError: ok ? null : (error ?? "unknown error"), lastDurationMs: durationMs });
}

export function jobStatuses(): Record<string, JobStatus> {
  return Object.fromEntries(jobStatusMap);
}

// ---------------------------------------------------------------------------
// Live widgets — cheap, on-demand real measurements (not persisted as
// samples). Backs a 4s-polled endpoint, matching Live Monitor's own cadence.

export function getLiveMetrics() {
  const mem = process.memoryUsage();
  const load = os.loadavg();
  return {
    rssMb: Math.round(mem.rss / 1024 / 1024),
    heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
    loadavg1: load[0], loadavg5: load[1], loadavg15: load[2],
    cpuCount: os.cpus().length,
    activeAttempts: db.data!.attempts.filter((a) => a.status === "in_progress").length,
  };
}

// ---------------------------------------------------------------------------
// The sweep itself.

function mkSample(subsystem: ReliabilitySubsystemKey, at: string, status: ReliabilityStatus, agg: DrainedStats, meta?: Record<string, unknown> | null): ReliabilitySample {
  return {
    id: nanoid(12), subsystem, at, status,
    requestCount: agg.count, errorCount: agg.errors,
    avgLatencyMs: agg.avg, minLatencyMs: agg.min, maxLatencyMs: agg.max, p95LatencyMs: agg.p95, p99LatencyMs: agg.p99,
    meta: meta ?? null,
  };
}

export interface ReliabilityDeps {
  dispatchWebhook: (event: WebhookEvent, data: Record<string, unknown>) => void;
  sendMail: (to: string, subject: string, text: string, html?: string) => Promise<unknown>;
  sendSms: (to: string, body: string) => Promise<unknown>;
  /** The platform's own real overdue-deadline calculation (schedule + duration
   *  + pauses + accommodations) — injected rather than reimplemented here, so
   *  "lost attempt" always means exactly what autoSubmitOverdue() means. */
  attemptDeadlineMs: (attempt: Attempt) => number;
}

/** One health-check tick: measure every subsystem, persist samples, then
 *  evaluate the incident state machine against them. Called every 60s by
 *  scheduleReliability(), and on-demand via the admin "Run health check now"
 *  action — both paths go through this single function. */
export async function runHealthCheckSweep(deps: ReliabilityDeps): Promise<{ opened: ReliabilityIncident[]; resolved: ReliabilityIncident[] }> {
  const at = new Date().toISOString();
  const t = resolveThresholds();
  const samples: ReliabilitySample[] = [];

  for (const subsystem of REQUEST_SUBSYSTEMS) {
    const d = drainBuffer(subsystem);
    const status = classifyStatus({ avgLatencyMs: d.avg, errorRate: d.count ? d.errors / d.count : 0 }, t);
    samples.push(mkSample(subsystem, at, status, d));
  }

  const dbResult = await measureDatabase(t);
  samples.push(mkSample("database", at, dbResult.status,
    { count: 0, errors: dbResult.status === "down" ? 1 : 0, avg: dbResult.avgLatencyMs, min: dbResult.avgLatencyMs, max: dbResult.avgLatencyMs, p95: dbResult.avgLatencyMs, p99: dbResult.avgLatencyMs },
    dbResult.meta));

  // Notifications: no per-message latency instrumentation exists (would need
  // deeper mailer.ts/sms.ts changes not justified for Phase 1) — status is
  // real, though, driven directly by the mailer/SMS providers' own last-error
  // state rather than a fabricated number.
  const mStatus = mailerStatus();
  const sStatus = smsStatus();
  const notifHardDown = !!mStatus.lastError || (smsEnabled() && !!sStatus.lastError);
  samples.push(mkSample("notifications", at, classifyStatus({ avgLatencyMs: null, errorRate: 0, hardDown: notifHardDown }, t),
    { count: 0, errors: notifHardDown ? 1 : 0, avg: null, min: null, max: null, p95: null, p99: null },
    { mailerError: mStatus.lastError, smsError: sStatus.lastError }));

  // Background jobs: real last-run status per job (populated once Batch 3
  // wires recordJobRun() into each sweep function); empty map reads as healthy
  // rather than down, since "no jobs have run yet" isn't itself a failure.
  const jobs = jobStatuses();
  const jobEntries = Object.values(jobs);
  const anyJobError = jobEntries.some((j) => j.lastError);
  const jobDurations = jobEntries.map((j) => j.lastDurationMs).filter((v): v is number => v != null);
  const avgJobDuration = jobDurations.length ? jobDurations.reduce((a, b) => a + b, 0) / jobDurations.length : null;
  samples.push(mkSample("backgroundJobs", at, classifyStatus({ avgLatencyMs: null, errorRate: 0, hardDown: anyJobError }, t),
    { count: 0, errors: anyJobError ? 1 : 0, avg: avgJobDuration, min: null, max: null, p95: null, p99: null },
    { jobs }));

  for (const s of samples) await reliabilityStore.add(s);

  return evaluateIncidents(samples, deps);
}

const CONSECUTIVE_TICKS_TO_OPEN = 2; // avoids opening on a single blip (e.g. one GC pause)
const CONSECUTIVE_TICKS_TO_RESOLVE = 3;

// In-memory debounce counters — reset on restart, which is fine: a restart is
// itself a clean boundary, not a state worth persisting across it.
const consecutiveBad = new Map<ReliabilitySubsystemKey, number>();
const consecutiveGood = new Map<ReliabilitySubsystemKey, number>();

function ev(type: ReliabilityIncidentEvent["type"], message: string): ReliabilityIncidentEvent {
  return { id: nanoid(8), at: new Date().toISOString(), type, message };
}

function impactSummary(impact: ExamImpactAnalysis): string {
  return `${impact.affectedExamIds.length} exam(s), ${impact.studentsAffected} student(s) potentially affected. `
    + `Auto-recovered: ${impact.attemptsAutoRecovered}, manual review needed: ${impact.attemptsRequiringManualRecovery}, lost: ${impact.attemptsLost}. `
    + `Integrity: ${impact.examIntegrityVerdict}.`;
}

/** Real, computed impact of one subsystem's bad window on exam-taking —
 *  every count derived from actual Attempt rows; the integrity verdict is
 *  never asserted without a basis string naming the specific evidence found. */
export async function computeExamImpact(subsystem: ReliabilitySubsystemKey, windowStart: string, windowEnd: string, deps: ReliabilityDeps): Promise<ExamImpactAnalysis> {
  const overlapping = db.data!.attempts.filter((a) => a.startedAt <= windowEnd && (a.submittedAt == null || a.submittedAt >= windowStart));
  const affectedExamIds = [...new Set(overlapping.map((a) => a.examId))];

  // Only subsystems that can actually block exam-taking count as "interrupting"
  // a running attempt — a notifications/fileStorage/backgroundJobs blip doesn't
  // stop a student mid-exam, even though the exams they're in still show up
  // in affectedExamIds for transparency. Every attempt genuinely active during
  // the window on an interruptible subsystem counts as "interrupted" — that
  // includes ones that finished cleanly by the time we check (a.status is
  // already "submitted"), not just ones still mid-attempt right now; outcome
  // is sub-bucketed below rather than filtered out here.
  const interruptible = subsystem === "api" || subsystem === "database" || subsystem === "examDelivery" || subsystem === "auth";
  const interrupted = interruptible ? overlapping : [];

  const windowEndMs = new Date(windowEnd).getTime();
  const lost = interrupted.filter((a) => a.terminated || (a.status === "in_progress" && windowEndMs > deps.attemptDeadlineMs(a)));
  const autoRecovered = interrupted.filter((a) => !lost.includes(a) && a.status === "submitted");
  const manualRecovery = interrupted.filter((a) => !lost.includes(a) && !autoRecovered.includes(a)); // still in_progress, not yet overdue — outcome pending
  const studentsAffected = new Set(interrupted.map((a) => a.candidateId)).size;

  const recoveryEvents = (await auditStore.recent(500)).filter((l) => l.action === "db.recovered_from_backup" && l.at >= windowStart && l.at <= windowEnd);
  const examIntegrityVerdict: ExamImpactAnalysis["examIntegrityVerdict"] = (recoveryEvents.length === 0 && lost.length === 0) ? "maintained" : "review_recommended";
  const examIntegrityBasis = recoveryEvents.length
    ? `A database restore-from-backup occurred during this window (${recoveryEvents[0].at}) — verify no attempts were lost between the last backup and this incident.`
    : lost.length
    ? `${lost.length} attempt(s) could not be completed and were force-closed or ran past their deadline during this window — review before certifying full integrity.`
    : "No database restore-from-backup event and no lost attempts were recorded during this window.";

  return {
    windowStart, windowEnd, affectedExamIds,
    attemptsOverlapping: overlapping.length, attemptsInterrupted: interrupted.length,
    attemptsAutoRecovered: autoRecovered.length, attemptsRequiringManualRecovery: manualRecovery.length, attemptsLost: lost.length,
    studentsAffected, examIntegrityVerdict, examIntegrityBasis,
  };
}

async function notifyIncident(incident: ReliabilityIncident, kind: "opened" | "resolved", deps: ReliabilityDeps, settings: OrgSettings) {
  deps.dispatchWebhook(kind === "opened" ? "incident.opened" : "incident.resolved", {
    incidentId: incident.id, subsystem: incident.subsystem, severity: incident.severity,
    status: incident.status, title: incident.title, openedAt: incident.openedAt, resolvedAt: incident.resolvedAt,
    impact: incident.impact,
  });

  const subject = kind === "opened" ? `[Oriole] Incident opened: ${incident.title}` : `[Oriole] Incident resolved: ${incident.title}`;
  const impactLine = incident.impact ? impactSummary(incident.impact) : "";
  const text = kind === "opened"
    ? `${incident.title}\nSeverity: ${incident.severity}\nOpened: ${incident.openedAt}\n\n${impactLine}`
    : `${incident.title} has been resolved.\nOpened: ${incident.openedAt}\nResolved: ${incident.resolvedAt}\n\n${impactLine}`;

  for (const to of settings.reliabilityAlertEmails ?? []) {
    await deps.sendMail(to, subject, text).catch((e) => logger.error({ err: String(e), to }, "incident alert email failed"));
  }
  for (const to of settings.reliabilityAlertSmsNumbers ?? []) {
    await deps.sendSms(to, `${subject}\n${text.slice(0, 280)}`).catch((e) => logger.error({ err: String(e), to }, "incident alert SMS failed"));
  }
}

/** Incident lifecycle: detect → open (debounced) → identify impact → notify
 *  → monitor → auto-resolve (debounced) → report. One subsystem can have at
 *  most one non-resolved incident open at a time. */
async function evaluateIncidents(samples: ReliabilitySample[], deps: ReliabilityDeps): Promise<{ opened: ReliabilityIncident[]; resolved: ReliabilityIncident[] }> {
  const opened: ReliabilityIncident[] = [];
  const resolved: ReliabilityIncident[] = [];
  const settings = localGetSettings();

  for (const sample of samples) {
    const subsystem = sample.subsystem;
    const existing = db.data!.reliabilityIncidents.find((i) => i.subsystem === subsystem && i.status !== "resolved");

    if (sample.status !== "operational") {
      consecutiveGood.set(subsystem, 0);

      if (existing) {
        // Already open — keep growing the impact window (monitor phase).
        existing.impact = await computeExamImpact(subsystem, existing.openedAt, sample.at, deps);
        if (existing.status === "identified") existing.status = "monitoring";
        await db.upsert("reliabilityIncidents", existing);
        continue;
      }

      const bad = (consecutiveBad.get(subsystem) ?? 0) + 1;
      consecutiveBad.set(subsystem, bad);
      if (bad < CONSECUTIVE_TICKS_TO_OPEN) continue;
      consecutiveBad.set(subsystem, 0);

      const severity: ReliabilityIncident["severity"] =
        sample.status !== "down" ? "minor" : (subsystem === "database" || subsystem === "api") ? "critical" : "major";

      const incident: ReliabilityIncident = {
        id: nanoid(10), subsystem, severity, status: "identified",
        title: `${SUBSYSTEM_LABELS[subsystem]} ${sample.status === "down" ? "outage" : "degraded performance"}`,
        openedAt: sample.at, resolvedAt: null, autoResolved: false,
        timeline: [ev("opened", `Detected ${sample.status} status for ${SUBSYSTEM_LABELS[subsystem]}.`)],
        impact: null,
      };
      incident.impact = await computeExamImpact(subsystem, incident.openedAt, sample.at, deps);
      incident.timeline.push(ev("identified", impactSummary(incident.impact)));

      // "down" always notifies; "degraded" only notifies if explicitly opted
      // in (avoids alert fatigue from a single-tier-above-normal blip).
      if (sample.status === "down" || settings.reliabilityNotifyOnDegraded) {
        await notifyIncident(incident, "opened", deps, settings);
        incident.timeline.push(ev("notified", "Alert notifications sent."));
      }

      db.data!.reliabilityIncidents.push(incident);
      await db.upsert("reliabilityIncidents", incident);
      opened.push(incident);
    } else {
      consecutiveBad.set(subsystem, 0);
      if (!existing) continue;

      const good = (consecutiveGood.get(subsystem) ?? 0) + 1;
      consecutiveGood.set(subsystem, good);
      if (good < CONSECUTIVE_TICKS_TO_RESOLVE) continue;
      consecutiveGood.set(subsystem, 0);

      existing.status = "resolved";
      existing.resolvedAt = sample.at;
      existing.autoResolved = true;
      existing.impact = await computeExamImpact(subsystem, existing.openedAt, existing.resolvedAt, deps);
      existing.timeline.push(ev("auto_resolved", `${SUBSYSTEM_LABELS[subsystem]} returned to operational status for ${CONSECUTIVE_TICKS_TO_RESOLVE} consecutive checks.`));
      await db.upsert("reliabilityIncidents", existing);

      await notifyIncident(existing, "resolved", deps, settings);
      existing.timeline.push(ev("notified", "Resolution notification sent."));
      await db.upsert("reliabilityIncidents", existing);
      resolved.push(existing);
    }
  }

  return { opened, resolved };
}

/** Admin-initiated early resolution (POST /api/admin/reliability/incidents/:id/resolve). */
export async function manuallyResolveIncident(incidentId: string, deps: ReliabilityDeps, resolvedByName: string): Promise<ReliabilityIncident | null> {
  const incident = db.data!.reliabilityIncidents.find((i) => i.id === incidentId);
  if (!incident || incident.status === "resolved") return null;
  const settings = localGetSettings();

  incident.status = "resolved";
  incident.resolvedAt = new Date().toISOString();
  incident.autoResolved = false;
  incident.impact = await computeExamImpact(incident.subsystem, incident.openedAt, incident.resolvedAt, deps);
  incident.timeline.push(ev("manually_resolved", `Manually resolved by ${resolvedByName}.`));
  await db.upsert("reliabilityIncidents", incident);

  await notifyIncident(incident, "resolved", deps, settings);
  incident.timeline.push(ev("notified", "Resolution notification sent."));
  await db.upsert("reliabilityIncidents", incident);
  return incident;
}

export function listIncidents(): ReliabilityIncident[] {
  return [...db.data!.reliabilityIncidents].sort((a, b) => b.openedAt.localeCompare(a.openedAt));
}

export function getIncident(id: string): ReliabilityIncident | null {
  return db.data!.reliabilityIncidents.find((i) => i.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Nightly rollup + raw purge — Batch 5. Exported now so scheduling can be
// wired once; implemented as a real aggregation once Batch 5 lands.
export async function runNightlyRollup(): Promise<void> {
  const cutoff = new Date(Date.now() - rawRetentionDays() * 86_400_000).toISOString();
  for (const subsystem of RELIABILITY_SUBSYSTEMS) {
    const yesterday = new Date(Date.now() - 86_400_000);
    const date = yesterday.toISOString().slice(0, 10);
    const dayStart = `${date}T00:00:00.000Z`;
    const dayEnd = `${date}T23:59:59.999Z`;
    const raw = await reliabilityStore.forWindow(subsystem, dayStart, dayEnd);
    if (raw.length === 0) continue;
    const agg = aggregateDailyRollup(raw);
    await reliabilityRollupStore.upsert({ id: `${subsystem}:${date}`, subsystem, date, ...agg });
  }
  await reliabilityStore.purgeOlderThan(cutoff);
}

// ---------------------------------------------------------------------------
// Scheduling — mirrors backup.ts exactly.

let timer: ReturnType<typeof setInterval> | null = null;
let rollupTimer: ReturnType<typeof setInterval> | null = null;

export function scheduleReliability(deps: ReliabilityDeps) {
  const fire = () => {
    void runHealthCheckSweep(deps).catch((e) => logger.error({ err: String(e) }, "reliability sweep failed"));
  };
  fire();
  timer = setInterval(fire, SWEEP_INTERVAL_MS);
  timer.unref?.();

  const fireRollup = () => {
    void runNightlyRollup().catch((e) => logger.error({ err: String(e) }, "reliability rollup failed"));
  };
  rollupTimer = setInterval(fireRollup, 24 * 60 * 60 * 1000);
  rollupTimer.unref?.();
}

export function stopReliability() {
  if (timer) { clearInterval(timer); timer = null; }
  if (rollupTimer) { clearInterval(rollupTimer); rollupTimer = null; }
}

// Re-exported so callers building the exam-integrity basis string (Batch 4)
// and API endpoints (Batch 7) don't need a second import of the audit store.
export { auditStore };
export type { ExamImpactAnalysis };
