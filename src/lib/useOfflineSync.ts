/**
 * Offline Sync Hook
 *
 * Coordinates offline storage and sync for exam sessions.
 * Provides unified status and recovery capabilities.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import {
  saveAnswer,
  saveSnapshot,
  saveEvent,
  saveGeofencePing,
  getUnsyncedAnswers,
  getUnsyncedSnapshots,
  getUnsyncedEvents,
  getLatestUnsyncedGeofence,
  markAnswerSynced,
  markSnapshotSynced,
  markEventsSynced,
  markGeofenceSynced,
  cleanupAttempt,
  getUnsyncedCount,
  setAttemptExamTitle,
  cleanupSyncedSnapshots,
  type StoredAnswer,
  type StoredSnapshot,
  type StoredEvent,
} from "./offlineStorage";

export type OfflineSyncStatus =
  | "online"      // Connected, all synced
  | "syncing"     // Connected, sync in progress
  | "pending"     // Connected, has unsynced data waiting
  | "offline"     // No connection
  | "error";      // Sync failed (will retry)

export interface OfflineSyncState {
  status: OfflineSyncStatus;
  online: boolean;
  unsyncedCount: number;
  lastSyncAt: number | null;
  lastError: string | null;
  /** Time spent offline in current session (ms) */
  offlineDuration: number;
}

interface UseOfflineSyncOptions {
  attemptId: string;
  examTitle?: string;
  enabled?: boolean;
  /** Callback when sync completes successfully */
  onSyncComplete?: () => void;
  /** Callback when offline data is recovered on load */
  onRecovery?: (answers: Record<string, string>) => void;
}

/**
 * Hook for managing offline data sync during an exam.
 *
 * Features:
 * - Automatic offline detection
 * - Durable storage in IndexedDB
 * - Automatic sync on reconnection
 * - Progress tracking
 * - Recovery of data from previous sessions
 */
export function useOfflineSync(options: UseOfflineSyncOptions) {
  const { attemptId, examTitle, enabled = true, onSyncComplete, onRecovery } = options;

  const [state, setState] = useState<OfflineSyncState>({
    status: navigator.onLine ? "online" : "offline",
    online: navigator.onLine,
    unsyncedCount: 0,
    lastSyncAt: null,
    lastError: null,
    offlineDuration: 0,
  });

  const syncingRef = useRef(false);
  const offlineStartRef = useRef<number | null>(null);
  const offlineTotalRef = useRef(0);
  const retryTimerRef = useRef<number | undefined>(undefined);
  const consecutiveFailures = useRef(0);

  // Track offline duration
  useEffect(() => {
    if (!state.online && offlineStartRef.current === null) {
      offlineStartRef.current = Date.now();
    } else if (state.online && offlineStartRef.current !== null) {
      offlineTotalRef.current += Date.now() - offlineStartRef.current;
      offlineStartRef.current = null;
    }

    const interval = setInterval(() => {
      if (offlineStartRef.current !== null) {
        setState((s) => ({
          ...s,
          offlineDuration: offlineTotalRef.current + (Date.now() - (offlineStartRef.current || Date.now())),
        }));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [state.online]);

  // Set exam title in metadata
  useEffect(() => {
    if (attemptId && examTitle) {
      setAttemptExamTitle(attemptId, examTitle);
    }
  }, [attemptId, examTitle]);

  // Update unsynced count
  const updateUnsyncedCount = useCallback(async () => {
    if (!attemptId) return;
    const count = await getUnsyncedCount(attemptId);
    setState((s) => ({ ...s, unsyncedCount: count }));
  }, [attemptId]);

  /**
   * Sync all pending data to server.
   */
  const sync = useCallback(async (): Promise<boolean> => {
    if (!attemptId || !enabled || syncingRef.current || !navigator.onLine) {
      return false;
    }

    syncingRef.current = true;
    setState((s) => ({ ...s, status: "syncing" }));

    let allSynced = true;

    try {
      // Sync answers
      const answers = await getUnsyncedAnswers(attemptId);
      for (const answer of answers) {
        try {
          await api.post(`/attempts/${attemptId}/answer`, {
            questionId: answer.questionId,
            value: answer.value,
            clientSavedAt: answer.savedAt,
          });
          await markAnswerSynced(attemptId, answer.questionId);
        } catch (err) {
          // Check if exam is closed - if so, try late sync
          if (err instanceof Error && /time is up|closed/i.test(err.message)) {
            // Exam closed - answers may have been accepted via late sync
            await markAnswerSynced(attemptId, answer.questionId);
          } else {
            allSynced = false;
          }
        }
      }

      // Sync snapshots (batch them)
      const snapshots = await getUnsyncedSnapshots(attemptId);
      for (const snapshot of snapshots.slice(0, 5)) { // Max 5 at a time
        try {
          await api.post(`/attempts/${attemptId}/snapshot`, { image: snapshot.image });
          await markSnapshotSynced(snapshot.id);
        } catch {
          // Snapshots are less critical - don't block sync
        }
      }
      // Cleanup synced snapshots to free space
      await cleanupSyncedSnapshots(attemptId);

      // Sync events
      const events = await getUnsyncedEvents(attemptId);
      const eventIds: string[] = [];
      for (const event of events) {
        try {
          await api.post(`/attempts/${attemptId}/proctor-event`, {
            type: event.type,
            severity: event.severity,
            message: event.message,
          });
          eventIds.push(event.id);
        } catch {
          // Events are less critical
        }
      }
      if (eventIds.length > 0) {
        await markEventsSynced(eventIds);
      }

      // Sync latest geofence
      const geofence = await getLatestUnsyncedGeofence(attemptId);
      if (geofence) {
        try {
          await api.post(`/attempts/${attemptId}/geofence-ping`, {
            lat: geofence.lat,
            lng: geofence.lng,
            accuracy: geofence.accuracy,
            deviceId: geofence.deviceId,
            clientError: geofence.clientError,
          });
          await markGeofenceSynced([geofence.id]);
        } catch {
          // Geofence less critical
        }
      }

      await updateUnsyncedCount();

      if (allSynced) {
        consecutiveFailures.current = 0;
        setState((s) => ({
          ...s,
          status: s.unsyncedCount === 0 ? "online" : "pending",
          lastSyncAt: Date.now(),
          lastError: null,
        }));
        onSyncComplete?.();
      } else {
        throw new Error("Some items failed to sync");
      }

      return allSynced;
    } catch (err) {
      consecutiveFailures.current += 1;
      setState((s) => ({
        ...s,
        status: "error",
        lastError: err instanceof Error ? err.message : "Sync failed",
      }));

      // Schedule retry with exponential backoff
      const delay = Math.min(30_000, 3_000 * 2 ** consecutiveFailures.current) * (0.8 + Math.random() * 0.4);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = window.setTimeout(() => {
        if (navigator.onLine) void sync();
      }, delay);

      return false;
    } finally {
      syncingRef.current = false;
    }
  }, [attemptId, enabled, updateUnsyncedCount, onSyncComplete]);

  /**
   * Force sync all data now, with retries.
   */
  const syncNow = useCallback(async (): Promise<boolean> => {
    for (let i = 0; i < 3; i++) {
      if (await sync()) return true;
      if (!navigator.onLine) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  }, [sync]);

  /**
   * Queue an answer for sync.
   */
  const queueAnswer = useCallback(
    async (questionId: string, value: string) => {
      if (!attemptId) return;
      await saveAnswer(attemptId, questionId, value);
      await updateUnsyncedCount();

      if (navigator.onLine && !syncingRef.current) {
        // Debounce sync
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = window.setTimeout(() => void sync(), 500);
      }
    },
    [attemptId, sync, updateUnsyncedCount]
  );

  /**
   * Queue a snapshot for sync.
   */
  const queueSnapshot = useCallback(
    async (image: string) => {
      if (!attemptId) return;
      await saveSnapshot(attemptId, image);
      await updateUnsyncedCount();
    },
    [attemptId, updateUnsyncedCount]
  );

  /**
   * Queue an event for sync.
   */
  const queueEvent = useCallback(
    async (type: string, severity: "info" | "warning" | "high", message: string) => {
      if (!attemptId) return;
      await saveEvent(attemptId, type, severity, message);
      await updateUnsyncedCount();
    },
    [attemptId, updateUnsyncedCount]
  );

  /**
   * Queue a geofence ping for sync.
   */
  const queueGeofencePing = useCallback(
    async (data: { lat: number; lng: number; accuracy: number | null; deviceId: string | null; clientError?: string }) => {
      if (!attemptId) return;
      await saveGeofencePing(attemptId, data);
    },
    [attemptId]
  );

  /**
   * Recover answers from previous session.
   */
  const recoverAnswers = useCallback(async (): Promise<Record<string, string>> => {
    if (!attemptId) return {};

    const answers = await getUnsyncedAnswers(attemptId);
    const recovered: Record<string, string> = {};

    for (const answer of answers) {
      recovered[answer.questionId] = answer.value;
    }

    if (Object.keys(recovered).length > 0) {
      onRecovery?.(recovered);
    }

    return recovered;
  }, [attemptId, onRecovery]);

  /**
   * Cleanup after successful submit.
   */
  const cleanup = useCallback(async () => {
    if (!attemptId) return;
    await cleanupAttempt(attemptId);
    setState((s) => ({ ...s, unsyncedCount: 0 }));
  }, [attemptId]);

  // Handle online/offline events
  useEffect(() => {
    const handleOnline = () => {
      setState((s) => ({ ...s, online: true, status: s.unsyncedCount > 0 ? "pending" : "online" }));
      // Sync immediately when back online
      void sync();
    };

    const handleOffline = () => {
      setState((s) => ({ ...s, online: false, status: "offline" }));
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = undefined;
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [sync]);

  // Initial recovery and sync
  useEffect(() => {
    if (!attemptId || !enabled) return;

    // Recover any pending data from previous session
    void recoverAnswers();
    void updateUnsyncedCount();

    // Start sync if online
    if (navigator.onLine) {
      void sync();
    }

    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
      }
    };
  }, [attemptId, enabled, recoverAnswers, updateUnsyncedCount, sync]);

  // Periodic sync check
  useEffect(() => {
    if (!enabled) return;

    const interval = setInterval(() => {
      if (navigator.onLine && !syncingRef.current) {
        void updateUnsyncedCount().then(() => {
          // Sync if we have pending data and aren't already syncing
          if (state.unsyncedCount > 0) {
            void sync();
          }
        });
      }
    }, 30_000); // Check every 30 seconds

    return () => clearInterval(interval);
  }, [enabled, state.unsyncedCount, sync, updateUnsyncedCount]);

  return {
    ...state,
    sync,
    syncNow,
    queueAnswer,
    queueSnapshot,
    queueEvent,
    queueGeofencePing,
    recoverAnswers,
    cleanup,
  };
}

/**
 * Get a human-readable status message.
 */
export function getStatusMessage(status: OfflineSyncStatus, unsyncedCount: number): string {
  switch (status) {
    case "online":
      return "All saved";
    case "syncing":
      return "Syncing...";
    case "pending":
      return `${unsyncedCount} pending`;
    case "offline":
      return "Offline - saved locally";
    case "error":
      return "Sync error - retrying...";
  }
}

/**
 * Format offline duration for display.
 */
export function formatOfflineDuration(ms: number): string {
  if (ms < 1000) return "";
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m offline`;
  } else if (minutes > 0) {
    return `${minutes}m offline`;
  } else {
    return `${seconds}s offline`;
  }
}
