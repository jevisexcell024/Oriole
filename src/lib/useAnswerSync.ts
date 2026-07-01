import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

export type SaveState = "saved" | "saving" | "error" | "offline";

/**
 * Resilient answer saving for an exam attempt.
 *  - Optimistic: the caller updates its own UI immediately.
 *  - Durable: every pending write is mirrored to localStorage, so a crash,
 *    reload, or internet drop doesn't lose answers — they re-flush on reconnect.
 *  - Self-healing: failed saves stay queued and retry with backoff; the browser
 *    "online" event triggers an immediate flush so recovery is instant.
 *  - Offline-aware: distinguishes a full internet drop ("offline") from a
 *    transient server error ("error / reconnecting").
 *  - flushNow() lets submit block until everything is persisted.
 */
export function useAnswerSync(attemptId: string | undefined) {
  const key = attemptId ? `orcalis_pending_${attemptId}` : "";
  const pending = useRef<Map<string, string>>(new Map());
  const inFlight = useRef(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onClosedRef = useRef<(() => void) | null>(null);
  const [state, setState] = useState<SaveState>(
    typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "saved",
  );

  const persist = useCallback(() => {
    if (!key) return;
    try {
      if (pending.current.size === 0) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify([...pending.current]));
    } catch { /* storage may be unavailable */ }
  }, [key]);

  const flush = useCallback(async () => {
    if (!attemptId || inFlight.current) return;
    if (!navigator.onLine) { setState("offline"); return; }
    if (pending.current.size === 0) { setState("saved"); return; }
    inFlight.current = true;
    setState("saving");
    for (const [qid, value] of [...pending.current]) {
      try {
        await api.post(`/attempts/${attemptId}/answer`, { questionId: qid, value });
        if (pending.current.get(qid) === value) pending.current.delete(qid);
      } catch (e) {
        if (e instanceof Error && /time is up|closed/i.test(e.message)) {
          pending.current.clear(); persist(); inFlight.current = false;
          onClosedRef.current?.();
          return;
        }
        // transient — leave queued, stop this pass, retry shortly
        break;
      }
    }
    persist();
    inFlight.current = false;
    if (pending.current.size > 0) {
      if (!navigator.onLine) {
        setState("offline");
        // No point scheduling a timer — the 'online' event will flush instead.
      } else {
        setState("error");
        if (retry.current) clearTimeout(retry.current);
        retry.current = setTimeout(() => { void flush(); }, 3000);
      }
    } else {
      setState("saved");
    }
  }, [attemptId, persist]);

  const setAnswer = useCallback((qid: string, value: string) => {
    pending.current.set(qid, value);
    persist();
    if (!navigator.onLine) {
      setState("offline");
      return;
    }
    setState("saving");
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => { void flush(); }, 500);
  }, [flush, persist]);

  /** Force a flush with a few retries; resolves true when nothing remains queued. */
  const flushNow = useCallback(async () => {
    for (let i = 0; i < 4 && pending.current.size > 0; i++) {
      await flush();
      if (pending.current.size > 0) await new Promise((r) => setTimeout(r, 600));
    }
    return pending.current.size === 0;
  }, [flush]);

  /** Recover any writes left in localStorage from a previous session. */
  const loadPersisted = useCallback((): Record<string, string> => {
    if (!key) return {};
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return {};
      const entries = JSON.parse(raw) as [string, string][];
      entries.forEach(([k, v]) => pending.current.set(k, v));
      if (pending.current.size) { setState("saving"); setTimeout(() => { void flush(); }, 300); }
      return Object.fromEntries(entries);
    } catch { return {}; }
  }, [key, flush]);

  const onClosed = useCallback((fn: () => void) => { onClosedRef.current = fn; }, []);

  // React to browser connectivity events.
  // "online"  → flush immediately so recovery is instant rather than waiting for the next retry tick.
  // "offline" → mark state and cancel the retry timer (no point retrying with no connection).
  useEffect(() => {
    const handleOnline = () => {
      if (pending.current.size > 0) {
        setState("saving");
        void flush();
      } else {
        setState("saved");
      }
    };
    const handleOffline = () => {
      setState("offline");
      if (retry.current) { clearTimeout(retry.current); retry.current = null; }
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [flush]);

  useEffect(() => () => {
    if (debounce.current) clearTimeout(debounce.current);
    if (retry.current) clearTimeout(retry.current);
  }, []);

  return { setAnswer, flushNow, loadPersisted, onClosed, state, hasPending: () => pending.current.size > 0 };
}
