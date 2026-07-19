import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

/**
 * Screen Wake Lock for proctored exams. Requests the browser's Wake Lock API
 * while the exam is in progress and releases it on submit/unmount. Detects two
 * things worth reporting to the server (which owns the actual policy — a
 * device-asleep condition is only knowable in hindsight, so there's nothing to
 * "prevent" client-side beyond re-requesting the lock):
 *
 *  - The API isn't supported at all (reported once, at start).
 *  - The device appears to have been asleep/inactive and has now resumed —
 *    detected via a `visibilitychange` gap and a periodic wall-clock time-jump
 *    check (catches OS suspends that don't always fire visibilitychange).
 *
 * Mirrors useExamLockdown's shape (src/lib/lockdown.ts): active-gated effect,
 * a rules ref to avoid re-running the effect on every render, cleanup on unmount.
 */
export function useWakeLock({
  active,
  attemptId,
}: {
  active: boolean;
  attemptId: string | null | undefined;
}) {
  const [supported, setSupported] = useState(true);
  const [held, setHeld] = useState(false);
  const attemptIdRef = useRef(attemptId);
  attemptIdRef.current = attemptId;
  const reportedUnsupportedRef = useRef(false);

  useEffect(() => {
    if (!active) return;
    const id = attemptIdRef.current;
    if (!id) return;

    type WakeLockSentinel = { released: boolean; addEventListener: (t: string, fn: () => void) => void; release: () => Promise<void> };
    type NavigatorWithWakeLock = Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinel> } };
    const nav = navigator as NavigatorWithWakeLock;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const reportUnsupportedOnce = () => {
      if (reportedUnsupportedRef.current) return;
      reportedUnsupportedRef.current = true;
      void api.post(`/attempts/${id}/wake-lock-event`, { type: "unsupported" }).catch(() => {});
    };

    const request = async () => {
      if (!nav.wakeLock) { setSupported(false); reportUnsupportedOnce(); return; }
      try {
        sentinel = await nav.wakeLock.request("screen");
        if (cancelled) { void sentinel.release().catch(() => {}); return; }
        setHeld(true);
        sentinel.addEventListener("release", () => setHeld(false));
      } catch {
        // A denied/failed request isn't "unsupported" (the API exists) — just
        // means the lock isn't currently held; visibility-driven re-request
        // below will try again on the next opportunity.
        setHeld(false);
      }
    };
    void request();

    // Track how long the tab was hidden, and a periodic wall-clock check for a
    // suspend that doesn't fire visibilitychange cleanly on every platform.
    let hiddenAt: number | null = null;
    let lastTick = Date.now();
    const INACTIVITY_REPORT_THRESHOLD_MS = 15_000; // only bother reporting real gaps

    const reportResumed = (inactiveMs: number) => {
      if (inactiveMs < INACTIVITY_REPORT_THRESHOLD_MS) return;
      void api.post(`/attempts/${id}/wake-lock-event`, { type: "inactive_resumed", inactiveSeconds: Math.round(inactiveMs / 1000) }).catch(() => {});
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt != null) {
        reportResumed(Date.now() - hiddenAt);
        hiddenAt = null;
      }
      if (!sentinel || sentinel.released) void request(); // re-acquire after tab-hide or an accidental release
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    // 5s heartbeat: if wall-clock time jumped far more than the tick interval,
    // the machine was very likely suspended (lid closed, system sleep) without
    // ever hiding the tab first.
    const tickTimer = window.setInterval(() => {
      const now = Date.now();
      const drift = now - lastTick - 5000;
      lastTick = now;
      if (drift > 15_000) reportResumed(drift);
    }, 5000);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearInterval(tickTimer);
      if (sentinel && !sentinel.released) void sentinel.release().catch(() => {});
      setHeld(false);
    };
  }, [active]);

  return { supported, held };
}
