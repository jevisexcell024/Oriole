import { describe, it, expect } from "vitest";
import { haversineDistanceMeters, nearestGeofence, insideAnyGeofence, graceSecondsRemaining, graceExpired } from "../shared/geo.ts";
import type { GeofenceCenter } from "../shared/types.ts";

describe("haversineDistanceMeters", () => {
  it("returns 0 for the same point", () => {
    expect(haversineDistanceMeters(5.6037, -0.187, 5.6037, -0.187)).toBe(0);
  });

  it("matches a known real-world distance (London to Paris, ~344km)", () => {
    const d = haversineDistanceMeters(51.5074, -0.1278, 48.8566, 2.3522);
    expect(d).toBeGreaterThan(340_000);
    expect(d).toBeLessThan(348_000);
  });

  it("computes short distances accurately (~111m per 0.001 degree latitude)", () => {
    const d = haversineDistanceMeters(5.6037, -0.187, 5.6047, -0.187);
    expect(d).toBeGreaterThan(105);
    expect(d).toBeLessThan(115);
  });
});

const centers: GeofenceCenter[] = [
  { id: "a", label: "Main Campus", lat: 5.6037, lng: -0.187, radiusM: 100 },
  { id: "b", label: "ICT Lab", lat: 5.62, lng: -0.2, radiusM: 50 },
];

describe("nearestGeofence", () => {
  it("returns null center when there are no centers configured", () => {
    const r = nearestGeofence(5.6037, -0.187, []);
    expect(r.center).toBeNull();
    expect(r.inside).toBe(false);
  });

  it("finds the closest center and reports inside when within its radius", () => {
    const r = nearestGeofence(5.6037, -0.187, centers);
    expect(r.center?.id).toBe("a");
    expect(r.inside).toBe(true);
    expect(r.distanceMeters).toBe(0);
  });

  it("reports outside when beyond every center's radius", () => {
    const r = nearestGeofence(5.7, -0.3, centers);
    expect(r.inside).toBe(false);
  });
});

describe("insideAnyGeofence", () => {
  it("passes when inside any one of several centers", () => {
    expect(insideAnyGeofence(5.62, -0.2, centers)).toBe(true);
  });

  it("fails when outside all centers", () => {
    expect(insideAnyGeofence(6.0, -1.0, centers)).toBe(false);
  });
});

describe("graceSecondsRemaining / graceExpired", () => {
  const now = new Date("2026-01-01T12:00:00.000Z").getTime();

  it("counts down the full grace window right when the candidate leaves", () => {
    const outsideSince = new Date(now).toISOString();
    expect(graceSecondsRemaining(outsideSince, 120, now)).toBe(120);
    expect(graceExpired(outsideSince, 120, now)).toBe(false);
  });

  it("counts down partway through the grace window", () => {
    const outsideSince = new Date(now - 45_000).toISOString();
    expect(graceSecondsRemaining(outsideSince, 120, now)).toBe(75);
    expect(graceExpired(outsideSince, 120, now)).toBe(false);
  });

  it("reports expired once the grace window has fully elapsed", () => {
    const outsideSince = new Date(now - 120_000).toISOString();
    expect(graceSecondsRemaining(outsideSince, 120, now)).toBe(0);
    expect(graceExpired(outsideSince, 120, now)).toBe(true);
  });

  it("reports expired (clamped to 0, not negative) well past the grace window", () => {
    const outsideSince = new Date(now - 999_000).toISOString();
    expect(graceSecondsRemaining(outsideSince, 120, now)).toBe(0);
    expect(graceExpired(outsideSince, 120, now)).toBe(true);
  });

  it("treats a zero grace period as immediately expired", () => {
    const outsideSince = new Date(now).toISOString();
    expect(graceExpired(outsideSince, 0, now)).toBe(true);
  });
});
