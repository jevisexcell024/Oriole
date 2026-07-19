import { describe, it, expect } from "vitest";
import { classifyStatus, percentile, aggregateDailyRollup, computeReliabilityScore, DEFAULT_STATUS_THRESHOLDS } from "../shared/reliability.ts";

describe("classifyStatus", () => {
  it("reports operational when latency and error rate are both low", () => {
    expect(classifyStatus({ avgLatencyMs: 100, errorRate: 0 })).toBe("operational");
  });

  it("reports degraded when latency crosses the degraded threshold", () => {
    expect(classifyStatus({ avgLatencyMs: 600, errorRate: 0 })).toBe("degraded");
  });

  it("reports degraded when error rate crosses the degraded threshold", () => {
    expect(classifyStatus({ avgLatencyMs: 100, errorRate: 0.05 })).toBe("degraded");
  });

  it("reports down when latency crosses the down threshold", () => {
    expect(classifyStatus({ avgLatencyMs: 2500, errorRate: 0 })).toBe("down");
  });

  it("reports down when error rate crosses the down threshold", () => {
    expect(classifyStatus({ avgLatencyMs: 100, errorRate: 0.2 })).toBe("down");
  });

  it("hardDown always wins regardless of latency/error numbers", () => {
    expect(classifyStatus({ avgLatencyMs: 10, errorRate: 0, hardDown: true })).toBe("down");
  });

  it("respects custom thresholds", () => {
    const t = { ...DEFAULT_STATUS_THRESHOLDS, degradedLatencyMs: 50 };
    expect(classifyStatus({ avgLatencyMs: 60, errorRate: 0 }, t)).toBe("degraded");
  });
});

describe("percentile", () => {
  const sorted = [10, 20, 30, 40, 50];

  it("returns null for an empty array", () => {
    expect(percentile([], 95)).toBeNull();
  });

  it("returns the minimum at p<=0", () => {
    expect(percentile(sorted, 0)).toBe(10);
  });

  it("returns the maximum at p>=100", () => {
    expect(percentile(sorted, 100)).toBe(50);
  });

  it("computes p50 via nearest-rank", () => {
    expect(percentile(sorted, 50)).toBe(30);
  });

  it("computes p95 via nearest-rank", () => {
    expect(percentile(sorted, 95)).toBe(50);
  });

  it("handles a single-element array", () => {
    expect(percentile([42], 95)).toBe(42);
  });
});

describe("aggregateDailyRollup", () => {
  it("returns a full-uptime zero-row for an empty day", () => {
    const r = aggregateDailyRollup([]);
    expect(r.sampleCount).toBe(0);
    expect(r.uptimePct).toBe(100);
    expect(r.avgLatencyMs).toBeNull();
  });

  it("reports 100% uptime when every sample was operational", () => {
    const r = aggregateDailyRollup([
      { status: "operational", avgLatencyMs: 100, requestCount: 10, errorCount: 0 },
      { status: "operational", avgLatencyMs: 120, requestCount: 12, errorCount: 0 },
      { status: "operational", avgLatencyMs: 110, requestCount: 8, errorCount: 0 },
    ]);
    expect(r.sampleCount).toBe(3);
    expect(r.upSamples).toBe(3);
    expect(r.uptimePct).toBe(100);
    expect(r.requestCount).toBe(30);
  });

  it("counts a degraded tick as half-up (matches real status-page convention)", () => {
    const r = aggregateDailyRollup([
      { status: "operational", avgLatencyMs: 100, requestCount: 1, errorCount: 0 },
      { status: "operational", avgLatencyMs: 100, requestCount: 1, errorCount: 0 },
      { status: "degraded", avgLatencyMs: 600, requestCount: 1, errorCount: 0 },
      { status: "down", avgLatencyMs: 3000, requestCount: 1, errorCount: 1 },
    ]);
    // (2 up + 0.5*1 degraded) / 4 * 100 = 62.5
    expect(r.uptimePct).toBe(62.5);
    expect(r.downSamples).toBe(1);
    expect(r.errorCount).toBe(1);
  });

  it("computes avg/min/max/p95/p99 latency only from non-null readings", () => {
    const r = aggregateDailyRollup([
      { status: "operational", avgLatencyMs: 100, requestCount: 1, errorCount: 0 },
      { status: "down", avgLatencyMs: null, requestCount: 0, errorCount: 1 }, // e.g. a hard DB-ping failure, no latency reading
      { status: "operational", avgLatencyMs: 300, requestCount: 1, errorCount: 0 },
    ]);
    expect(r.avgLatencyMs).toBe(200);
    expect(r.minLatencyMs).toBe(100);
    expect(r.maxLatencyMs).toBe(300);
  });
});

describe("computeReliabilityScore", () => {
  it("scores 100 when every input is perfect", () => {
    const { score, breakdown } = computeReliabilityScore({
      uptimePct30d: 100, p95LatencyMs: null, targetP95Ms: 500,
      avgResolutionMinutes: null, targetResolutionMinutes: 30, lostAttempts30d: 0,
    });
    expect(score).toBe(100);
    expect(breakdown.uptimeComponent).toBe(100);
    expect(breakdown.latencyComponent).toBe(100);
    expect(breakdown.incidentComponent).toBe(100);
    expect(breakdown.examImpactComponent).toBe(100);
  });

  it("weights uptime at 50% of the score", () => {
    const { score } = computeReliabilityScore({
      uptimePct30d: 90, p95LatencyMs: null, targetP95Ms: 500,
      avgResolutionMinutes: null, targetResolutionMinutes: 30, lostAttempts30d: 0,
    });
    // 0.5*90 + 0.2*100 + 0.2*100 + 0.1*100 = 45+20+20+10 = 95
    expect(score).toBe(95);
  });

  it("penalizes p95 latency exceeding its target, clamped at 0", () => {
    const { score, breakdown } = computeReliabilityScore({
      uptimePct30d: 100, p95LatencyMs: 1000, targetP95Ms: 500,
      avgResolutionMinutes: null, targetResolutionMinutes: 30, lostAttempts30d: 0,
    });
    expect(breakdown.latencyComponent).toBe(0); // 100% overage clamps to 0
    // 0.5*100 + 0.2*0 + 0.2*100 + 0.1*100 = 50+0+20+10 = 80
    expect(score).toBe(80);
  });

  it("penalizes lost exam attempts — the platform's unique differentiator", () => {
    const { score, breakdown } = computeReliabilityScore({
      uptimePct30d: 100, p95LatencyMs: null, targetP95Ms: 500,
      avgResolutionMinutes: null, targetResolutionMinutes: 30, lostAttempts30d: 5,
    });
    expect(breakdown.examImpactComponent).toBe(75); // 100 - 5*5
    // 0.5*100 + 0.2*100 + 0.2*100 + 0.1*75 = 50+20+20+7.5 = 97.5
    expect(score).toBe(97.5);
  });

  it("penalizes slow incident resolution relative to target", () => {
    const { breakdown } = computeReliabilityScore({
      uptimePct30d: 100, p95LatencyMs: null, targetP95Ms: 500,
      avgResolutionMinutes: 60, targetResolutionMinutes: 30, lostAttempts30d: 0,
    });
    // 100 - (60/30)*50 = 100 - 100 = 0
    expect(breakdown.incidentComponent).toBe(0);
  });
});
