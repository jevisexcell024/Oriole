import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { graceSecondsRemaining } from "@shared/geo";
import { checkPermissionsPolicy } from "./permissionsPolicyCheck";

export type GeoCheckState = "pending" | "ok" | "fail";

const DEVICE_ID_KEY = "orcalis_device_id";
function getOrCreateDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(DEVICE_ID_KEY, id); }
  return id;
}

interface GeofenceCheckResult {
  allowed: boolean;
  distanceMeters: number | null;
  nearestCenter: string | null;
  reason: string | null;
}

interface Options {
  active: boolean;
  registrationId: string | undefined;
}

/** Runs a one-time entry-verification GPS check against the exam's approved
 *  locations (POST /registrations/:id/geofence-check), mirroring useProctoring's
 *  device-acquisition pattern for camera/mic. */
export function useGeofence({ active, registrationId }: Options) {
  const [state, setState] = useState<GeoCheckState>("pending");
  const [error, setError] = useState<string | null>(null);
  const [distanceMeters, setDistanceMeters] = useState<number | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const retry = useCallback(() => setRetryCount((c) => c + 1), []);

  useEffect(() => {
    if (!active || !registrationId) return;
    let cancelled = false;
    setState("pending");
    setError(null);

    if (!navigator.geolocation) {
      setState("fail");
      setError("Your browser doesn't support location services. Try a different browser.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        if (cancelled) return;
        try {
          const r = await api.post<GeofenceCheckResult>(`/registrations/${registrationId}/geofence-check`, {
            lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy,
            deviceId: getOrCreateDeviceId(),
          });
          if (cancelled) return;
          setDistanceMeters(r.distanceMeters);
          if (r.allowed) setState("ok");
          else { setState("fail"); setError(r.reason ?? "You're outside the approved examination area."); }
        } catch (e) {
          if (!cancelled) { setState("fail"); setError(e instanceof Error ? e.message : "Could not verify your location."); }
        }
      },
      async (err) => {
        if (cancelled) return;
        const clientError = err.code === err.PERMISSION_DENIED ? "GPS_PERMISSION_DENIED" : "GPS_DISABLED";
        setState("fail");
        // A PERMISSION_DENIED here looks identical whether a person clicked
        // "Block" or the server's Permissions-Policy header is blocking
        // geolocation outright (no prompt ever shown) — read back the real
        // header to tell the two apart instead of guessing.
        let message = clientError === "GPS_PERMISSION_DENIED"
          ? "Location permission is required to take this examination. Please enable location services."
          : "Location services are turned off or unavailable. Please enable GPS before continuing.";
        if (clientError === "GPS_PERMISSION_DENIED") {
          const policy = await checkPermissionsPolicy();
          if (!policy.fetchError && policy.geolocation !== "allowed") {
            message = policy.geolocation === "blocked"
              ? "This site's server configuration is blocking location access outright (Permissions-Policy: geolocation=()) — no permission prompt was ever shown, and this isn't something you can fix from your device. Contact your administrator."
              : "This site's server configuration doesn't explicitly allow location access, and the browser may be silently refusing it. Contact your administrator if Retry doesn't work.";
          }
        }
        if (!cancelled) setError(message);
        api.post(`/registrations/${registrationId}/geofence-check`, { clientError, deviceId: getOrCreateDeviceId() }).catch(() => { /* best-effort */ });
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, registrationId, retryCount]);

  return { state, error, distanceMeters, retry };
}

export type GeofenceExitPolicy = "warn" | "pause" | "lock" | "auto_submit" | "terminate";

interface GeofencePingResult {
  allowed: boolean;
  distanceMeters: number | null;
  nearestCenter: string | null;
  reason: string | null;
  outsideSince: string | null;
  graceSeconds: number;
  policy: GeofenceExitPolicy;
}

interface MonitorOptions {
  active: boolean;
  attemptId: string | undefined;
  intervalSec: number;
}

const DEFAULT_PING_STATE: GeofencePingResult = {
  allowed: true, distanceMeters: null, nearestCenter: null, reason: null,
  outsideSince: null, graceSeconds: 120, policy: "warn",
};

/** Runs periodic GPS checkpoints DURING a proctored, geofenced exam (Phase 2 — vs.
 *  useGeofence's one-time entry check), reporting each to POST
 *  /attempts/:id/geofence-ping. The server is the source of truth for how long the
 *  candidate has been outside (`outsideSince`) and what happens once the grace period
 *  elapses; this hook just ticks a local countdown from that server timestamp between
 *  pings so the UI can show a live "return within Xs" banner. */
export function useGeofenceMonitor({ active, attemptId, intervalSec }: MonitorOptions) {
  const [ping, setPing] = useState<GeofencePingResult>(DEFAULT_PING_STATE);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!active || !attemptId) return;
    let cancelled = false;

    const report = (body: Record<string, unknown>) => {
      api.post<GeofencePingResult>(`/attempts/${attemptId}/geofence-ping`, body)
        .then((r) => { if (!cancelled) setPing(r); })
        .catch(() => { /* transient — try again next interval */ });
    };

    const check = () => {
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (cancelled) return;
          report({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, deviceId: getOrCreateDeviceId() });
        },
        (err) => {
          if (cancelled) return;
          const clientError = err.code === err.PERMISSION_DENIED ? "GPS_PERMISSION_DENIED" : "GPS_DISABLED";
          report({ clientError, deviceId: getOrCreateDeviceId() });
        },
        { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
      );
    };

    check();
    const id = window.setInterval(check, Math.max(20, intervalSec) * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, [active, attemptId, intervalSec]);

  // Tick every second while outside, so the grace countdown moves smoothly between pings.
  useEffect(() => {
    if (!ping.outsideSince) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [ping.outsideSince]);

  const graceRemainingSec = ping.outsideSince ? graceSecondsRemaining(ping.outsideSince, ping.graceSeconds) : null;

  return { ...ping, graceRemainingSec };
}
