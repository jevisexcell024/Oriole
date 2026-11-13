/**
 * Batched Uploader
 *
 * Combines multiple proctoring data types (snapshots, events, answers, geofence)
 * into single multiplexed requests to reduce HTTP overhead and improve reliability
 * on slow connections.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { ConnectionTier } from "./connectionQuality";

/** Proctor event to be batched */
export interface BatchedEvent {
  type: string;
  severity: "info" | "warning" | "high";
  message: string;
  at: number;
}

/** Answer to be batched */
export interface BatchedAnswer {
  questionId: string;
  value: string;
  at: number;
}

/** Geofence ping to be batched */
export interface BatchedGeofence {
  lat: number;
  lng: number;
  accuracy: number;
  deviceId: string | null;
  clientError?: string;
}

/** Snapshot to be batched */
export interface BatchedSnapshot {
  image: string;
  capturedAt: number;
}

/** Internal queue structure */
interface BatchQueue {
  snapshots: BatchedSnapshot[];
  events: BatchedEvent[];
  answers: Map<string, BatchedAnswer>; // Map by questionId for deduplication
  geofence: BatchedGeofence | null;
}

/** Control channel response piggybacked on batch response */
export interface ControlState {
  paused: boolean;
  pauseReason: "break" | "proctor" | null;
  terminated: boolean;
  terminationReason: string | null;
  messages: Array<{ id: string; text: string; at: string }>;
  deadlineAt: string;
  serverNow: string;
  geofenceLocked: boolean;
  geofenceOutsideSince: string | null;
  geofencePauseAuto: boolean;
}

/** Batch response from server */
interface BatchResponse {
  ok: boolean;
  control?: ControlState;
  answerResults?: Array<{ questionId: string; ok: boolean; error?: string; lateSync?: boolean }>;
  autoSubmitted?: boolean;
}

/** Flush interval by connection tier */
const FLUSH_INTERVALS: Record<ConnectionTier, number> = {
  high: 5_000,
  medium: 10_000,
  low: 20_000,
  critical: 30_000,
};

/** Maximum items per category before forcing a flush */
const MAX_QUEUE_SIZE = {
  snapshots: 3,
  events: 10,
  answers: 5,
};

export interface UseBatchedUploaderOptions {
  attemptId: string;
  tier: ConnectionTier;
  enabled?: boolean;
  onControlUpdate?: (control: ControlState) => void;
  onAutoSubmit?: () => void;
  onAnswerError?: (questionId: string, error: string) => void;
  onFlushComplete?: (success: boolean, latencyMs: number) => void;
}

/**
 * React hook for batched uploading of proctoring data.
 *
 * Queues snapshots, events, answers, and geofence pings, then sends them
 * in a single multiplexed request at intervals determined by connection tier.
 */
export function useBatchedUploader(options: UseBatchedUploaderOptions) {
  const {
    attemptId,
    tier,
    enabled = true,
    onControlUpdate,
    onAutoSubmit,
    onAnswerError,
    onFlushComplete,
  } = options;

  const queueRef = useRef<BatchQueue>({
    snapshots: [],
    events: [],
    answers: new Map(),
    geofence: null,
  });

  const [pending, setPending] = useState(false);
  const [lastFlush, setLastFlush] = useState<number>(Date.now());
  const flushingRef = useRef(false);
  const timerRef = useRef<number | undefined>(undefined);

  /**
   * Flush all queued data to the server.
   */
  const flush = useCallback(async (): Promise<boolean> => {
    if (flushingRef.current) return false;

    const queue = queueRef.current;
    const hasData =
      queue.snapshots.length > 0 ||
      queue.events.length > 0 ||
      queue.answers.size > 0 ||
      queue.geofence !== null;

    if (!hasData) return true;

    flushingRef.current = true;
    setPending(true);

    // Build compact payload
    const payload: Record<string, unknown> = { t: Date.now() };

    if (queue.snapshots.length > 0) {
      payload.s = queue.snapshots;
    }
    if (queue.events.length > 0) {
      payload.e = queue.events;
    }
    if (queue.answers.size > 0) {
      payload.a = Array.from(queue.answers.values());
    }
    if (queue.geofence) {
      payload.g = queue.geofence;
    }

    const startTime = performance.now();

    try {
      const resp = await api.post<BatchResponse>(`/attempts/${attemptId}/batch`, payload);

      // Clear successfully sent items
      queueRef.current = {
        snapshots: [],
        events: [],
        answers: new Map(),
        geofence: null,
      };

      setLastFlush(Date.now());

      // Handle piggybacked control state
      if (resp.control && onControlUpdate) {
        onControlUpdate(resp.control);
      }

      // Handle auto-submit trigger
      if (resp.autoSubmitted && onAutoSubmit) {
        onAutoSubmit();
      }

      // Handle answer-specific errors
      if (resp.answerResults && onAnswerError) {
        for (const r of resp.answerResults) {
          if (!r.ok && r.error) {
            onAnswerError(r.questionId, r.error);
          }
        }
      }

      const latency = performance.now() - startTime;
      onFlushComplete?.(true, latency);

      return true;
    } catch (err) {
      const latency = performance.now() - startTime;
      onFlushComplete?.(false, latency);
      return false;
    } finally {
      flushingRef.current = false;
      setPending(false);
    }
  }, [attemptId, onControlUpdate, onAutoSubmit, onAnswerError, onFlushComplete]);

  /**
   * Force an immediate flush, waiting for completion.
   */
  const flushNow = useCallback(async (): Promise<boolean> => {
    // Cancel any pending scheduled flush
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    return flush();
  }, [flush]);

  /**
   * Queue a snapshot for batched upload.
   */
  const queueSnapshot = useCallback(
    (snapshot: BatchedSnapshot) => {
      queueRef.current.snapshots.push(snapshot);
      // Force flush if queue is getting large
      if (queueRef.current.snapshots.length >= MAX_QUEUE_SIZE.snapshots) {
        void flushNow();
      }
    },
    [flushNow]
  );

  /**
   * Queue a proctor event for batched upload.
   */
  const queueEvent = useCallback(
    (event: Omit<BatchedEvent, "at">) => {
      queueRef.current.events.push({ ...event, at: Date.now() });
      // Force flush if queue is getting large
      if (queueRef.current.events.length >= MAX_QUEUE_SIZE.events) {
        void flushNow();
      }
    },
    [flushNow]
  );

  /**
   * Queue an answer for batched upload.
   * Deduplicates by questionId (keeps latest).
   */
  const queueAnswer = useCallback(
    (answer: Omit<BatchedAnswer, "at">) => {
      queueRef.current.answers.set(answer.questionId, {
        ...answer,
        at: Date.now(),
      });
      // Force flush if queue is getting large
      if (queueRef.current.answers.size >= MAX_QUEUE_SIZE.answers) {
        void flushNow();
      }
    },
    [flushNow]
  );

  /**
   * Set the geofence ping for the next batch.
   * Only one ping is sent per batch (latest wins).
   */
  const queueGeofence = useCallback((geofence: BatchedGeofence) => {
    queueRef.current.geofence = geofence;
  }, []);

  /**
   * Check if there's any pending data to flush.
   */
  const hasPending = useCallback(() => {
    const q = queueRef.current;
    return q.snapshots.length > 0 || q.events.length > 0 || q.answers.size > 0 || q.geofence !== null;
  }, []);

  /**
   * Get the count of pending items by type.
   */
  const getPendingCounts = useCallback(() => {
    const q = queueRef.current;
    return {
      snapshots: q.snapshots.length,
      events: q.events.length,
      answers: q.answers.size,
      geofence: q.geofence ? 1 : 0,
    };
  }, []);

  // Periodic flush based on tier
  useEffect(() => {
    if (!enabled) return;

    const interval = FLUSH_INTERVALS[tier];

    const scheduleNext = () => {
      timerRef.current = window.setTimeout(async () => {
        if (hasPending()) {
          await flush();
        }
        scheduleNext();
      }, interval * (0.8 + Math.random() * 0.4)); // Randomize ±20%
    };

    scheduleNext();

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [enabled, tier, flush, hasPending]);

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (hasPending()) {
        // Use sendBeacon for reliable delivery on unmount
        const queue = queueRef.current;
        const payload: Record<string, unknown> = { t: Date.now() };
        if (queue.snapshots.length > 0) payload.s = queue.snapshots;
        if (queue.events.length > 0) payload.e = queue.events;
        if (queue.answers.size > 0) payload.a = Array.from(queue.answers.values());
        if (queue.geofence) payload.g = queue.geofence;

        navigator.sendBeacon(
          `/api/attempts/${attemptId}/batch`,
          new Blob([JSON.stringify(payload)], { type: "application/json" })
        );
      }
    };
  }, [attemptId, hasPending]);

  // Flush when going offline (to persist what we have)
  useEffect(() => {
    const handleOffline = () => {
      if (hasPending()) {
        void flushNow();
      }
    };

    window.addEventListener("offline", handleOffline);
    return () => window.removeEventListener("offline", handleOffline);
  }, [flushNow, hasPending]);

  return {
    /** Queue a snapshot */
    queueSnapshot,
    /** Queue a proctor event */
    queueEvent,
    /** Queue an answer */
    queueAnswer,
    /** Set geofence ping */
    queueGeofence,
    /** Force immediate flush */
    flushNow,
    /** Check if any data is pending */
    hasPending,
    /** Get pending item counts */
    getPendingCounts,
    /** Whether a flush is in progress */
    pending,
    /** Timestamp of last successful flush */
    lastFlush,
  };
}

/**
 * Standalone function to send a batched request without the hook.
 * Useful for one-off flushes or beacon delivery.
 */
export async function sendBatch(
  attemptId: string,
  data: {
    snapshots?: BatchedSnapshot[];
    events?: BatchedEvent[];
    answers?: BatchedAnswer[];
    geofence?: BatchedGeofence;
  }
): Promise<BatchResponse> {
  const payload: Record<string, unknown> = { t: Date.now() };
  if (data.snapshots?.length) payload.s = data.snapshots;
  if (data.events?.length) payload.e = data.events;
  if (data.answers?.length) payload.a = data.answers;
  if (data.geofence) payload.g = data.geofence;

  return api.post<BatchResponse>(`/attempts/${attemptId}/batch`, payload);
}
