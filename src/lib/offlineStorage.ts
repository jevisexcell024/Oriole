/**
 * Offline Storage Manager
 *
 * Uses IndexedDB for durable storage of exam data when offline or on poor connections.
 * Provides automatic sync when connectivity returns, with conflict resolution
 * and progress preservation across browser crashes/reloads.
 *
 * Storage hierarchy:
 * - IndexedDB (primary): Large capacity, survives browser restart
 * - localStorage (fallback): Smaller but more compatible
 * - Memory (last resort): Lost on page close but works everywhere
 */

import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "orcalis_offline";
const DB_VERSION = 1;

// Store names
const STORES = {
  ANSWERS: "answers",
  SNAPSHOTS: "snapshots",
  EVENTS: "events",
  GEOFENCE: "geofence",
  META: "meta",
} as const;

export interface StoredAnswer {
  id: string; // `${attemptId}:${questionId}`
  attemptId: string;
  questionId: string;
  value: string;
  savedAt: number;
  synced: boolean;
}

export interface StoredSnapshot {
  id: string;
  attemptId: string;
  image: string;
  capturedAt: number;
  synced: boolean;
}

export interface StoredEvent {
  id: string;
  attemptId: string;
  type: string;
  severity: "info" | "warning" | "high";
  message: string;
  at: number;
  synced: boolean;
}

export interface StoredGeofence {
  id: string;
  attemptId: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  deviceId: string | null;
  clientError?: string;
  at: number;
  synced: boolean;
}

export interface AttemptMeta {
  attemptId: string;
  examTitle: string;
  startedAt: number;
  lastActivity: number;
  unsyncedCount: number;
}

type StoreValue = StoredAnswer | StoredSnapshot | StoredEvent | StoredGeofence | AttemptMeta;

let dbPromise: Promise<IDBPDatabase | null> | null = null;
let dbAvailable = true;

/**
 * Initialize or get the IndexedDB connection.
 */
async function getDb(): Promise<IDBPDatabase | null> {
  if (!dbAvailable) return null;

  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Answers store - keyed by attemptId:questionId
        if (!db.objectStoreNames.contains(STORES.ANSWERS)) {
          const answersStore = db.createObjectStore(STORES.ANSWERS, { keyPath: "id" });
          answersStore.createIndex("attemptId", "attemptId");
          answersStore.createIndex("synced", "synced");
        }

        // Snapshots store
        if (!db.objectStoreNames.contains(STORES.SNAPSHOTS)) {
          const snapshotsStore = db.createObjectStore(STORES.SNAPSHOTS, { keyPath: "id" });
          snapshotsStore.createIndex("attemptId", "attemptId");
          snapshotsStore.createIndex("synced", "synced");
        }

        // Events store
        if (!db.objectStoreNames.contains(STORES.EVENTS)) {
          const eventsStore = db.createObjectStore(STORES.EVENTS, { keyPath: "id" });
          eventsStore.createIndex("attemptId", "attemptId");
          eventsStore.createIndex("synced", "synced");
        }

        // Geofence pings store
        if (!db.objectStoreNames.contains(STORES.GEOFENCE)) {
          const geoStore = db.createObjectStore(STORES.GEOFENCE, { keyPath: "id" });
          geoStore.createIndex("attemptId", "attemptId");
          geoStore.createIndex("synced", "synced");
        }

        // Attempt metadata store
        if (!db.objectStoreNames.contains(STORES.META)) {
          db.createObjectStore(STORES.META, { keyPath: "attemptId" });
        }
      },
    }).catch((err) => {
      console.warn("IndexedDB unavailable, falling back to localStorage:", err);
      dbAvailable = false;
      return null;
    });
  }

  return dbPromise;
}

/**
 * Generate a unique ID for stored items.
 */
function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// ==================== ANSWERS ====================

/**
 * Save an answer to offline storage.
 */
export async function saveAnswer(
  attemptId: string,
  questionId: string,
  value: string
): Promise<void> {
  const answer: StoredAnswer = {
    id: `${attemptId}:${questionId}`,
    attemptId,
    questionId,
    value,
    savedAt: Date.now(),
    synced: false,
  };

  const db = await getDb();
  if (db) {
    await db.put(STORES.ANSWERS, answer);
  } else {
    // Fallback to localStorage
    const key = `orcalis_answer_${attemptId}:${questionId}`;
    try {
      localStorage.setItem(key, JSON.stringify(answer));
    } catch { /* storage full */ }
  }

  await updateAttemptMeta(attemptId);
}

/**
 * Get all unsynced answers for an attempt.
 */
export async function getUnsyncedAnswers(attemptId: string): Promise<StoredAnswer[]> {
  const db = await getDb();
  if (db) {
    const all = await db.getAllFromIndex(STORES.ANSWERS, "attemptId", attemptId);
    return all.filter((a) => !a.synced);
  }

  // Fallback: scan localStorage
  const answers: StoredAnswer[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(`orcalis_answer_${attemptId}:`)) {
      try {
        const answer = JSON.parse(localStorage.getItem(key) || "");
        if (!answer.synced) answers.push(answer);
      } catch { /* ignore corrupt entries */ }
    }
  }
  return answers;
}

/**
 * Mark an answer as synced.
 */
export async function markAnswerSynced(attemptId: string, questionId: string): Promise<void> {
  const id = `${attemptId}:${questionId}`;
  const db = await getDb();
  if (db) {
    const answer = await db.get(STORES.ANSWERS, id);
    if (answer) {
      answer.synced = true;
      await db.put(STORES.ANSWERS, answer);
    }
  } else {
    const key = `orcalis_answer_${id}`;
    try {
      const answer = JSON.parse(localStorage.getItem(key) || "{}");
      answer.synced = true;
      localStorage.setItem(key, JSON.stringify(answer));
    } catch { /* ignore */ }
  }
}

/**
 * Get all answers for an attempt (for recovery/display).
 */
export async function getAllAnswers(attemptId: string): Promise<StoredAnswer[]> {
  const db = await getDb();
  if (db) {
    return db.getAllFromIndex(STORES.ANSWERS, "attemptId", attemptId);
  }

  const answers: StoredAnswer[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(`orcalis_answer_${attemptId}:`)) {
      try {
        answers.push(JSON.parse(localStorage.getItem(key) || ""));
      } catch { /* ignore */ }
    }
  }
  return answers;
}

// ==================== SNAPSHOTS ====================

/**
 * Save a snapshot to offline storage.
 * Snapshots are large, so we limit how many we store offline.
 */
export async function saveSnapshot(
  attemptId: string,
  image: string
): Promise<void> {
  const snapshot: StoredSnapshot = {
    id: generateId(),
    attemptId,
    image,
    capturedAt: Date.now(),
    synced: false,
  };

  const db = await getDb();
  if (db) {
    // Keep only last 10 unsynced snapshots per attempt to manage storage
    const existing = await db.getAllFromIndex(STORES.SNAPSHOTS, "attemptId", attemptId);
    const unsynced = existing.filter((s) => !s.synced);
    if (unsynced.length >= 10) {
      // Remove oldest unsynced
      unsynced.sort((a, b) => a.capturedAt - b.capturedAt);
      await db.delete(STORES.SNAPSHOTS, unsynced[0].id);
    }
    await db.put(STORES.SNAPSHOTS, snapshot);
  }
  // Don't use localStorage for snapshots - too large

  await updateAttemptMeta(attemptId);
}

/**
 * Get all unsynced snapshots for an attempt.
 */
export async function getUnsyncedSnapshots(attemptId: string): Promise<StoredSnapshot[]> {
  const db = await getDb();
  if (!db) return [];

  const all = await db.getAllFromIndex(STORES.SNAPSHOTS, "attemptId", attemptId);
  return all.filter((s) => !s.synced).sort((a, b) => a.capturedAt - b.capturedAt);
}

/**
 * Mark a snapshot as synced.
 */
export async function markSnapshotSynced(id: string): Promise<void> {
  const db = await getDb();
  if (db) {
    const snapshot = await db.get(STORES.SNAPSHOTS, id);
    if (snapshot) {
      snapshot.synced = true;
      await db.put(STORES.SNAPSHOTS, snapshot);
    }
  }
}

/**
 * Delete synced snapshots to free up space.
 */
export async function cleanupSyncedSnapshots(attemptId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const all = await db.getAllFromIndex(STORES.SNAPSHOTS, "attemptId", attemptId);
  for (const snapshot of all) {
    if (snapshot.synced) {
      await db.delete(STORES.SNAPSHOTS, snapshot.id);
    }
  }
}

// ==================== EVENTS ====================

/**
 * Save a proctor event to offline storage.
 */
export async function saveEvent(
  attemptId: string,
  type: string,
  severity: "info" | "warning" | "high",
  message: string
): Promise<void> {
  const event: StoredEvent = {
    id: generateId(),
    attemptId,
    type,
    severity,
    message,
    at: Date.now(),
    synced: false,
  };

  const db = await getDb();
  if (db) {
    await db.put(STORES.EVENTS, event);
  } else {
    // Fallback to localStorage with a queue
    const key = `orcalis_events_${attemptId}`;
    try {
      const existing = JSON.parse(localStorage.getItem(key) || "[]");
      existing.push(event);
      // Keep last 50 events
      if (existing.length > 50) existing.shift();
      localStorage.setItem(key, JSON.stringify(existing));
    } catch { /* storage full */ }
  }

  await updateAttemptMeta(attemptId);
}

/**
 * Get all unsynced events for an attempt.
 */
export async function getUnsyncedEvents(attemptId: string): Promise<StoredEvent[]> {
  const db = await getDb();
  if (db) {
    const all = await db.getAllFromIndex(STORES.EVENTS, "attemptId", attemptId);
    return all.filter((e) => !e.synced).sort((a, b) => a.at - b.at);
  }

  // Fallback
  const key = `orcalis_events_${attemptId}`;
  try {
    const events = JSON.parse(localStorage.getItem(key) || "[]");
    return events.filter((e: StoredEvent) => !e.synced);
  } catch {
    return [];
  }
}

/**
 * Mark events as synced.
 */
export async function markEventsSynced(ids: string[]): Promise<void> {
  const db = await getDb();
  if (db) {
    for (const id of ids) {
      const event = await db.get(STORES.EVENTS, id);
      if (event) {
        event.synced = true;
        await db.put(STORES.EVENTS, event);
      }
    }
  }
}

// ==================== GEOFENCE ====================

/**
 * Save a geofence ping to offline storage.
 */
export async function saveGeofencePing(
  attemptId: string,
  data: { lat: number; lng: number; accuracy: number | null; deviceId: string | null; clientError?: string }
): Promise<void> {
  const ping: StoredGeofence = {
    id: generateId(),
    attemptId,
    ...data,
    at: Date.now(),
    synced: false,
  };

  const db = await getDb();
  if (db) {
    // Keep only last 20 unsynced pings
    const existing = await db.getAllFromIndex(STORES.GEOFENCE, "attemptId", attemptId);
    const unsynced = existing.filter((g) => !g.synced);
    if (unsynced.length >= 20) {
      unsynced.sort((a, b) => a.at - b.at);
      await db.delete(STORES.GEOFENCE, unsynced[0].id);
    }
    await db.put(STORES.GEOFENCE, ping);
  }
}

/**
 * Get the latest unsynced geofence ping for an attempt.
 */
export async function getLatestUnsyncedGeofence(attemptId: string): Promise<StoredGeofence | null> {
  const db = await getDb();
  if (!db) return null;

  const all = await db.getAllFromIndex(STORES.GEOFENCE, "attemptId", attemptId);
  const unsynced = all.filter((g) => !g.synced).sort((a, b) => b.at - a.at);
  return unsynced[0] || null;
}

/**
 * Mark geofence pings as synced.
 */
export async function markGeofenceSynced(ids: string[]): Promise<void> {
  const db = await getDb();
  if (db) {
    for (const id of ids) {
      const ping = await db.get(STORES.GEOFENCE, id);
      if (ping) {
        ping.synced = true;
        await db.put(STORES.GEOFENCE, ping);
      }
    }
  }
}

// ==================== METADATA ====================

/**
 * Update attempt metadata (last activity, unsynced count).
 */
async function updateAttemptMeta(attemptId: string, examTitle?: string): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const existing = await db.get(STORES.META, attemptId) as AttemptMeta | undefined;

  // Count unsynced items
  const unsyncedAnswers = (await db.getAllFromIndex(STORES.ANSWERS, "attemptId", attemptId)).filter((a) => !a.synced).length;
  const unsyncedSnapshots = (await db.getAllFromIndex(STORES.SNAPSHOTS, "attemptId", attemptId)).filter((s) => !s.synced).length;
  const unsyncedEvents = (await db.getAllFromIndex(STORES.EVENTS, "attemptId", attemptId)).filter((e) => !e.synced).length;

  const meta: AttemptMeta = {
    attemptId,
    examTitle: examTitle || existing?.examTitle || "Exam",
    startedAt: existing?.startedAt || Date.now(),
    lastActivity: Date.now(),
    unsyncedCount: unsyncedAnswers + unsyncedSnapshots + unsyncedEvents,
  };

  await db.put(STORES.META, meta);
}

/**
 * Get metadata for an attempt.
 */
export async function getAttemptMeta(attemptId: string): Promise<AttemptMeta | null> {
  const db = await getDb();
  if (!db) return null;
  return db.get(STORES.META, attemptId);
}

/**
 * Set the exam title in metadata.
 */
export async function setAttemptExamTitle(attemptId: string, examTitle: string): Promise<void> {
  await updateAttemptMeta(attemptId, examTitle);
}

// ==================== CLEANUP ====================

/**
 * Clean up all synced data for an attempt (call after successful submit).
 */
export async function cleanupAttempt(attemptId: string): Promise<void> {
  const db = await getDb();
  if (db) {
    // Delete all data for this attempt
    const answers = await db.getAllFromIndex(STORES.ANSWERS, "attemptId", attemptId);
    for (const a of answers) await db.delete(STORES.ANSWERS, a.id);

    const snapshots = await db.getAllFromIndex(STORES.SNAPSHOTS, "attemptId", attemptId);
    for (const s of snapshots) await db.delete(STORES.SNAPSHOTS, s.id);

    const events = await db.getAllFromIndex(STORES.EVENTS, "attemptId", attemptId);
    for (const e of events) await db.delete(STORES.EVENTS, e.id);

    const geofence = await db.getAllFromIndex(STORES.GEOFENCE, "attemptId", attemptId);
    for (const g of geofence) await db.delete(STORES.GEOFENCE, g.id);

    await db.delete(STORES.META, attemptId);
  }

  // Also clean localStorage
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.includes(attemptId)) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((k) => localStorage.removeItem(k));
}

/**
 * Get total unsynced count for an attempt.
 */
export async function getUnsyncedCount(attemptId: string): Promise<number> {
  const meta = await getAttemptMeta(attemptId);
  return meta?.unsyncedCount || 0;
}

/**
 * Check if IndexedDB is available.
 */
export function isIndexedDBAvailable(): boolean {
  return dbAvailable;
}

/**
 * Estimate storage usage for an attempt.
 */
export async function estimateStorageUsage(attemptId: string): Promise<{ bytes: number; items: number }> {
  const db = await getDb();
  if (!db) return { bytes: 0, items: 0 };

  let bytes = 0;
  let items = 0;

  const answers = await db.getAllFromIndex(STORES.ANSWERS, "attemptId", attemptId);
  items += answers.length;
  bytes += answers.reduce((sum, a) => sum + JSON.stringify(a).length, 0);

  const snapshots = await db.getAllFromIndex(STORES.SNAPSHOTS, "attemptId", attemptId);
  items += snapshots.length;
  bytes += snapshots.reduce((sum, s) => sum + (s.image?.length || 0), 0);

  const events = await db.getAllFromIndex(STORES.EVENTS, "attemptId", attemptId);
  items += events.length;
  bytes += events.reduce((sum, e) => sum + JSON.stringify(e).length, 0);

  return { bytes, items };
}
