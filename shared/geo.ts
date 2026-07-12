// Pure geofencing distance helpers, shared by the API and the client. No external
// APIs — every distance is computed locally via the Haversine formula.

import type { GeofenceCenter } from "./types.ts";

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance between two lat/lng points, in metres. */
export function haversineDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

export interface NearestGeofenceResult {
  center: GeofenceCenter | null;
  distanceMeters: number | null;
  inside: boolean;
}

/** The closest approved centre to a point, and whether the point falls inside its radius. */
export function nearestGeofence(lat: number, lng: number, centers: GeofenceCenter[]): NearestGeofenceResult {
  if (!centers.length) return { center: null, distanceMeters: null, inside: false };
  let best: GeofenceCenter = centers[0];
  let bestDist = haversineDistanceMeters(lat, lng, best.lat, best.lng);
  for (const c of centers.slice(1)) {
    const d = haversineDistanceMeters(lat, lng, c.lat, c.lng);
    if (d < bestDist) { best = c; bestDist = d; }
  }
  return { center: best, distanceMeters: Math.round(bestDist), inside: bestDist <= best.radiusM };
}

/** True if the point falls inside ANY of the approved centres (not just the nearest). */
export function insideAnyGeofence(lat: number, lng: number, centers: GeofenceCenter[]): boolean {
  return centers.some((c) => haversineDistanceMeters(lat, lng, c.lat, c.lng) <= c.radiusM);
}

/** Seconds remaining before a candidate who has been outside every approved area since
 *  `outsideSinceIso` trips the exam's geofence exit policy (0 once the grace has elapsed). */
export function graceSecondsRemaining(outsideSinceIso: string, graceSeconds: number, nowMs: number = Date.now()): number {
  const elapsed = (nowMs - new Date(outsideSinceIso).getTime()) / 1000;
  return Math.max(0, Math.ceil(graceSeconds - elapsed));
}

/** True once a candidate has been continuously outside every approved area for at least
 *  `graceSeconds` since `outsideSinceIso`. */
export function graceExpired(outsideSinceIso: string, graceSeconds: number, nowMs: number = Date.now()): boolean {
  return graceSecondsRemaining(outsideSinceIso, graceSeconds, nowMs) <= 0;
}
