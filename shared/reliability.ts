// Pure Status & Reliability Center math — status classification, percentiles,
// daily rollup aggregation, and the reliability score formula. No I/O, no
// Express, no db — directly unit-testable, same role shared/geo.ts plays for
// geofencing. server/reliability.ts is the only caller that touches real data.

import type { ReliabilityStatus } from "./types.ts";

export interface StatusThresholds {
  degradedLatencyMs: number;
  downLatencyMs: number;
  degradedErrorRate: number; // 0-1
  downErrorRate: number; // 0-1
}

export const DEFAULT_STATUS_THRESHOLDS: StatusThresholds = {
  degradedLatencyMs: 500,
  downLatencyMs: 2000,
  degradedErrorRate: 0.02,
  downErrorRate: 0.15,
};

/** Classifies one subsystem's tick reading. `hardDown` (e.g. a thrown DB ping)
 *  always wins regardless of latency/error numbers. */
export function classifyStatus(
  input: { avgLatencyMs: number | null; errorRate: number; hardDown?: boolean },
  t: StatusThresholds = DEFAULT_STATUS_THRESHOLDS,
): ReliabilityStatus {
  if (input.hardDown) return "down";
  const lat = input.avgLatencyMs ?? 0;
  if (lat >= t.downLatencyMs || input.errorRate >= t.downErrorRate) return "down";
  if (lat >= t.degradedLatencyMs || input.errorRate >= t.degradedErrorRate) return "degraded";
  return "operational";
}

/** Nearest-rank percentile over an already-ascending-sorted array. Returns
 *  null for an empty input rather than 0 (0 would misleadingly read as "fast"). */
export function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  if (p <= 0) return sortedAsc[0];
  if (p >= 100) return sortedAsc[sortedAsc.length - 1];
  const rank = Math.ceil((p / 100) * sortedAsc.length) - 1;
  return sortedAsc[Math.max(0, Math.min(sortedAsc.length - 1, rank))];
}

export interface DailyRollupInput {
  status: ReliabilityStatus;
  avgLatencyMs: number | null;
  requestCount: number;
  errorCount: number;
}

export interface DailyRollupAggregate {
  sampleCount: number;
  upSamples: number;
  degradedSamples: number;
  downSamples: number;
  uptimePct: number;
  avgLatencyMs: number | null;
  minLatencyMs: number | null;
  maxLatencyMs: number | null;
  p95LatencyMs: number | null;
  p99LatencyMs: number | null;
  requestCount: number;
  errorCount: number;
}

/** Aggregates a day's raw ticks for one subsystem into one rollup row.
 *  `uptimePct` counts a degraded tick as half-up (matches real status-page
 *  convention: a degraded subsystem was still partially serving traffic). */
export function aggregateDailyRollup(samples: DailyRollupInput[]): DailyRollupAggregate {
  const sampleCount = samples.length;
  if (sampleCount === 0) {
    return { sampleCount: 0, upSamples: 0, degradedSamples: 0, downSamples: 0, uptimePct: 100, avgLatencyMs: null, minLatencyMs: null, maxLatencyMs: null, p95LatencyMs: null, p99LatencyMs: null, requestCount: 0, errorCount: 0 };
  }
  const upSamples = samples.filter((s) => s.status === "operational").length;
  const degradedSamples = samples.filter((s) => s.status === "degraded").length;
  const downSamples = samples.filter((s) => s.status === "down").length;
  const uptimePct = ((upSamples + 0.5 * degradedSamples) / sampleCount) * 100;
  const latencies = samples.map((s) => s.avgLatencyMs).filter((v): v is number => v != null);
  const sortedLatencies = [...latencies].sort((a, b) => a - b);
  const requestCount = samples.reduce((sum, s) => sum + s.requestCount, 0);
  const errorCount = samples.reduce((sum, s) => sum + s.errorCount, 0);
  return {
    sampleCount, upSamples, degradedSamples, downSamples, uptimePct,
    avgLatencyMs: latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null,
    minLatencyMs: sortedLatencies.length ? sortedLatencies[0] : null,
    maxLatencyMs: sortedLatencies.length ? sortedLatencies[sortedLatencies.length - 1] : null,
    p95LatencyMs: percentile(sortedLatencies, 95),
    p99LatencyMs: percentile(sortedLatencies, 99),
    requestCount, errorCount,
  };
}

export interface ReliabilityScoreInputs {
  /** Trailing-30d average uptimePct across the 6 named (non-`api`) subsystems. */
  uptimePct30d: number;
  p95LatencyMs: number | null;
  targetP95Ms: number;
  avgResolutionMinutes: number | null;
  targetResolutionMinutes: number;
  lostAttempts30d: number;
}

export interface ReliabilityScoreBreakdown {
  uptimeComponent: number;
  latencyComponent: number;
  incidentComponent: number;
  examImpactComponent: number;
}

export interface ReliabilityScoreResult {
  score: number;
  breakdown: ReliabilityScoreBreakdown;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Real, explainable weighted formula — never a black-box number. Every input
 *  must come from actually-measured/computed data (see server/reliability.ts). */
export function computeReliabilityScore(i: ReliabilityScoreInputs): ReliabilityScoreResult {
  const uptimeComponent = clamp(i.uptimePct30d, 0, 100);

  const latencyComponent = i.p95LatencyMs == null
    ? 100
    : clamp(100 - Math.max(0, ((i.p95LatencyMs - i.targetP95Ms) / i.targetP95Ms) * 100), 0, 100);

  const incidentComponent = i.avgResolutionMinutes == null
    ? 100
    : clamp(100 - (i.avgResolutionMinutes / i.targetResolutionMinutes) * 50, 0, 100);

  const examImpactComponent = clamp(100 - i.lostAttempts30d * 5, 0, 100);

  const score = 0.5 * uptimeComponent + 0.2 * latencyComponent + 0.2 * incidentComponent + 0.1 * examImpactComponent;

  return {
    score: Math.round(score * 10) / 10,
    breakdown: { uptimeComponent, latencyComponent, incidentComponent, examImpactComponent },
  };
}
