import { PGlite } from "@electric-sql/pglite";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { randomBytes, createHash } from "node:crypto";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";
import { encryptString } from "./crypto.ts";
import { BCRYPT_COST } from "./env.ts";
import type {
  User, Exam, Question, Registration, Attempt, Answer, ProctorEvent, Certificate, Snapshot, EmailMessage, Announcement, AnnouncementRead, OrgSettings, AuditLog,
  Faculty, Department, Program, Campus, AcademicYear, ClassGroup, RegradeRequest, Book, ReadingProgress,
  ResourceVersion, ResourceBookmark, ResourceRating, ResourceDownloadLog, GeofenceLog,
} from "../shared/types.ts";
import { DEFAULT_LOCKDOWN, DEFAULT_LEARNING_STRUCTURE } from "../shared/types.ts";

export interface Schema {
  users: User[];
  exams: Exam[];
  questions: Question[];
  registrations: Registration[];
  attempts: Attempt[];
  certificates: Certificate[];
  // NOTE: high-volume / per-attempt collections are deliberately NOT mirrored in
  // memory — they live in their own indexed tables and are served via dedicated
  // stores (direct queries) to keep per-node memory bounded:
  //   snapshots     → snapshotStore  (base64 webcam frames)
  //   proctorEvents → proctorStore   (per-attempt integrity events)
  //   answers       → answerStore    (per-attempt submitted answers)
  //   emails        → emailStore     (delivery log)
  //   auditLogs     → auditStore     (admin action trail)
  //   geofenceLogs  → geofenceStore  (per-registration/attempt GPS checks)
  announcements: Announcement[];
  settings: OrgSettings[];
  faculties: Faculty[];
  departments: Department[];
  programs: Program[];
  campuses: Campus[];
  academicYears: AcademicYear[];
  classes: ClassGroup[];
  regradeRequests: RegradeRequest[];
  books: Book[];
  readingProgress: ReadingProgress[];
  resourceVersions: ResourceVersion[];
  resourceBookmarks: ResourceBookmark[];
  resourceRatings: ResourceRating[];
  resourceDownloadLogs: ResourceDownloadLog[];
  announcementReads: AnnouncementRead[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gunzipAsync = promisify(gunzip);

const defaultData: Schema = {
  users: [], exams: [], questions: [], registrations: [],
  attempts: [], certificates: [], announcements: [],
  settings: [],
  faculties: [], departments: [], programs: [], campuses: [], academicYears: [], classes: [], regradeRequests: [],
  books: [], readingProgress: [],
  resourceVersions: [], resourceBookmarks: [], resourceRatings: [], resourceDownloadLogs: [],
  announcementReads: [],
};

// Each collection is stored in a Postgres table as (id, doc jsonb). This keeps a
// real, durable, transactional database underneath while the app's data interface
// stays stable.
const TABLES: { key: keyof Schema; table: string; idField: string }[] = [
  { key: "users", table: "users", idField: "id" },
  { key: "exams", table: "exams", idField: "id" },
  { key: "questions", table: "questions", idField: "id" },
  { key: "registrations", table: "registrations", idField: "id" },
  { key: "attempts", table: "attempts", idField: "id" },
  { key: "certificates", table: "certificates", idField: "id" },
  { key: "announcements", table: "announcements", idField: "id" },
  { key: "settings", table: "settings", idField: "id" },
  { key: "faculties", table: "faculties", idField: "id" },
  { key: "departments", table: "departments", idField: "id" },
  { key: "programs", table: "programs", idField: "id" },
  { key: "campuses", table: "campuses", idField: "id" },
  { key: "academicYears", table: "academic_years", idField: "id" },
  { key: "classes", table: "class_groups", idField: "id" },
  { key: "regradeRequests", table: "regrade_requests", idField: "id" },
  { key: "books", table: "books", idField: "id" },
  { key: "readingProgress", table: "reading_progress", idField: "id" },
  { key: "resourceVersions", table: "resource_versions", idField: "id" },
  { key: "resourceBookmarks", table: "resource_bookmarks", idField: "id" },
  { key: "resourceRatings", table: "resource_ratings", idField: "id" },
  { key: "resourceDownloadLogs", table: "resource_download_logs", idField: "id" },
  { key: "announcementReads", table: "announcement_reads", idField: "id" },
];

const TABLE_BY_KEY = new Map(TABLES.map((t) => [t.key, t]));

// ---------------------------------------------------------------------------
// Storage backend — the single seam between the app and the SQL engine.
// `DATABASE_URL` selects managed Postgres (node-postgres, pooled) for staging
// and production; with no URL we fall back to an embedded PGlite file for local
// dev and tests. Both speak the same (id, doc jsonb) schema and `$1` params, so
// nothing above this line changes when you point at RDS / Neon / Supabase.
// ---------------------------------------------------------------------------
interface Tx { query: (sql: string, params?: unknown[]) => Promise<unknown>; }
interface Backend {
  query: <T>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  exec: (sql: string) => Promise<void>;
  transaction: (fn: (tx: Tx) => Promise<void>) => Promise<void>;
  close: () => Promise<void>;
  readonly kind: "postgres" | "pglite";
}

let backend: Backend | null = null;

async function createBackend(): Promise<Backend> {
  const url = process.env.DATABASE_URL;
  if (url) {
    // Managed Postgres. Dynamically imported so the embedded path has no hard
    // dependency on `pg` at startup.
    const pgModule = (await import("pg")) as unknown as {
      default?: { Pool: new (cfg: unknown) => PgPool };
      Pool?: new (cfg: unknown) => PgPool;
    };
    const Pool = (pgModule.Pool ?? pgModule.default!.Pool);
    const pool = new Pool({
      connectionString: url,
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      ssl: process.env.DATABASE_SSL === "false" ? undefined : { rejectUnauthorized: false },
    });
    return {
      kind: "postgres",
      async query<T>(sql: string, params: unknown[] = []) {
        const res = await pool.query(sql, params);
        return { rows: res.rows as T[] };
      },
      async exec(sql: string) { await pool.query(sql); },
      async transaction(fn) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await fn({ query: (sql, params) => client.query(sql, params as unknown[]) });
          await client.query("COMMIT");
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        } finally {
          client.release();
        }
      },
      async close() { await pool.end(); },
    };
  }

  // Embedded PGlite (dev / single-host prod). `memory://` keeps tests hermetic.
  const dataDir = process.env.PGLITE_DIR || path.join(__dirname, ".pgdata");
  const pg = await openPglite(dataDir);
  return {
    kind: "pglite",
    async query<T>(sql: string, params: unknown[] = []) {
      const res = await pg.query<T>(sql, params);
      return { rows: res.rows };
    },
    async exec(sql: string) { await pg.exec(sql); },
    async transaction(fn) { await pg.transaction(async (tx) => { await fn({ query: (sql, params) => tx.query(sql, params) }); }); },
    async close() { await pg.close(); },
  };
}

interface PgPool {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  connect: () => Promise<{ query: (sql: string, params?: unknown[]) => Promise<unknown>; release: () => void }>;
  end: () => Promise<void>;
}

/**
 * Open the embedded PGlite store, self-healing the one known crash mode: an
 * unclean shutdown (host SIGKILLs the idle app) leaves a stale postmaster.pid
 * lock that makes the next boot fail with "PGlite failed to initialize".
 * On init failure we remove the stale lock and retry exactly once.
 */
async function openPglite(dataDir: string): Promise<PGlite> {
  const attempt = async () => {
    const inst = new PGlite(dataDir);
    await inst.query("select 1"); // force init so failures surface here
    return inst;
  };
  try {
    return await attempt();
  } catch (err) {
    const pidFile = path.join(dataDir, "postmaster.pid");
    if (fs.existsSync(pidFile)) {
      console.warn("⚠️  Stale postmaster.pid from an unclean shutdown — removing and retrying.");
      fs.rmSync(pidFile, { force: true });
      return await attempt();
    }
    throw err;
  }
}

const be = () => {
  if (!backend) throw new Error("Database not initialized — call initDb() before using db.");
  return backend;
};

// Serializes full-mirror flushes: the delete-then-reinsert in write() is not
// safe to run concurrently on a real (non-PGlite) backend — two overlapping
// flushes race on the same rows. Chaining them makes write() atomic per process.
let writeChain: Promise<void> = Promise.resolve();

export const db: {
  data: Schema;
  read: () => Promise<void>;
  write: () => Promise<void>;
  upsert: <K extends keyof Schema>(key: K, item: Schema[K][number]) => Promise<void>;
  remove: (key: keyof Schema, id: string) => Promise<void>;
  removeMany: (key: keyof Schema, ids: string[]) => Promise<void>;
  close: () => Promise<void>;
  ping: () => Promise<void>;
  backendKind: () => "postgres" | "pglite";
} = {
  data: structuredClone(defaultData),
  async read() {
    for (const { key, table } of TABLES) {
      const { rows } = await be().query<{ doc: unknown }>(`select doc from ${table}`);
      (db.data[key] as unknown[]) = rows.map((r) => r.doc);
    }
  },
  // Full snapshot flush — used by initDb/seed and the (rare) bulk admin operations.
  async write() {
    // Serialize flushes (never interleave) and snapshot each table before
    // writing so a concurrent push can't mutate the array mid-iteration.
    const run = writeChain.then(() => be().transaction(async (tx) => {
      for (const { key, table, idField } of TABLES) {
        const rows = [...(db.data[key] as unknown as Record<string, unknown>[])];
        await tx.query(`delete from ${table}`);
        for (const item of rows) {
          // Upsert (not plain insert) so a duplicate id can never crash the flush.
          await tx.query(
            `insert into ${table}(id, doc) values ($1, $2::jsonb)
             on conflict (id) do update set doc = excluded.doc`,
            [String(item[idField]), JSON.stringify(item)],
          );
        }
      }
    }));
    // Keep the chain alive even if this flush throws (don't wedge later writes).
    writeChain = run.then(() => undefined, () => undefined);
    await run;
  },
  // Targeted single-row write — O(1) regardless of dataset size. Used by hot paths
  // (answer saves, snapshots, proctor events) so one change touches one row, not the
  // whole database. The caller keeps db.data in sync; this persists just that row.
  async upsert(key, item) {
    const meta = TABLE_BY_KEY.get(key)!;
    const id = String((item as unknown as Record<string, unknown>)[meta.idField]);
    await be().query(
      `insert into ${meta.table}(id, doc) values ($1, $2::jsonb)
       on conflict (id) do update set doc = excluded.doc`,
      [id, JSON.stringify(item)],
    );
  },
  async remove(key, id) {
    const meta = TABLE_BY_KEY.get(key)!;
    await be().query(`delete from ${meta.table} where id = $1`, [String(id)]);
  },
  async removeMany(key, ids) {
    if (ids.length === 0) return;
    const meta = TABLE_BY_KEY.get(key)!;
    await be().query(`delete from ${meta.table} where id = any($1::text[])`, [ids.map(String)]);
  },
  async close() { if (backend) { await backend.close(); backend = null; } },
  async ping() { await be().query("select 1"); },
  backendKind() { return be().kind; },
};

// Off-mirror tables (see the comment on Schema above) — not part of TABLES
// because they're never held in the in-memory mirror, but a full backup needs
// every row from every table, mirrored or not.
const OFF_MIRROR_TABLES = ["snapshots", "answers", "proctor_events", "audit_logs", "emails", "geofence_logs"];

/** Full logical snapshot of every row in every table (mirrored + off-mirror),
 *  keyed by collection/table name. Used for backups — a plain SELECT per table,
 *  not wrapped in one giant transaction, since a backup running alongside normal
 *  traffic accepts "consistent as of roughly now" rather than blocking writes. */
export async function dumpAll(): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const { key, table } of TABLES) {
    const { rows } = await be().query<{ doc: unknown }>(`select doc from ${table}`);
    out[key] = rows.map((r) => r.doc);
  }
  for (const table of OFF_MIRROR_TABLES) {
    const { rows } = await be().query<{ doc: unknown }>(`select doc from ${table}`);
    out[table] = rows.map((r) => r.doc);
  }
  return out;
}

// Proctoring webcam frames — stored in their own table with indexed attempt_id /
// at columns and queried directly (never held in the in-memory mirror). This
// keeps per-node memory bounded regardless of how many frames accumulate, and
// makes the data correct across multiple API instances without a shared cache.
export const snapshotStore = {
  async add(frame: Snapshot): Promise<void> {
    await be().query(
      `insert into snapshots(id, attempt_id, at, doc) values ($1, $2, $3, $4::jsonb)
       on conflict (id) do update set doc = excluded.doc, attempt_id = excluded.attempt_id, at = excluded.at`,
      [frame.id, frame.attemptId, frame.at, JSON.stringify(frame)],
    );
  },
  async forAttempt(attemptId: string): Promise<Snapshot[]> {
    const { rows } = await be().query<{ doc: Snapshot }>(
      `select doc from snapshots where attempt_id = $1 order by at asc`, [attemptId]);
    return rows.map((r) => r.doc);
  },
  async latest(attemptId: string): Promise<Snapshot | null> {
    const { rows } = await be().query<{ doc: Snapshot }>(
      `select doc from snapshots where attempt_id = $1 order by at desc limit 1`, [attemptId]);
    return rows[0]?.doc ?? null;
  },
  /** Keep only the most recent `cap` frames for an attempt; delete the rest. */
  async trim(attemptId: string, cap: number): Promise<void> {
    await be().query(
      `delete from snapshots where id in (
         select id from snapshots where attempt_id = $1 order by at desc offset $2)`,
      [attemptId, cap]);
  },
  async removeForAttempts(attemptIds: string[]): Promise<void> {
    if (attemptIds.length === 0) return;
    await be().query(`delete from snapshots where attempt_id = any($1::text[])`, [attemptIds]);
  },
  /** Retention purge — returns the number of frames removed. */
  async purgeOlderThan(cutoffIso: string): Promise<number> {
    const { rows } = await be().query<{ id: string }>(
      `delete from snapshots where at < $1 returning id`, [cutoffIso]);
    return rows.length;
  },
  async totalCount(): Promise<number> {
    const { rows } = await be().query<{ n: string }>(`select count(*)::text as n from snapshots`);
    return Number(rows[0]?.n ?? 0);
  },
};

// Submitted answers — off-mirror, indexed by attempt. Grading reads/writes a
// single attempt's answers at a time; list views batch via `forAttempts`.
export const answerStore = {
  async upsert(answer: Answer): Promise<void> {
    await be().query(
      `insert into answers(id, attempt_id, doc) values ($1, $2, $3::jsonb)
       on conflict (id) do update set doc = excluded.doc, attempt_id = excluded.attempt_id`,
      [answer.id, answer.attemptId, JSON.stringify(answer)]);
  },
  async forAttempt(attemptId: string): Promise<Answer[]> {
    const { rows } = await be().query<{ doc: Answer }>(
      `select doc from answers where attempt_id = $1`, [attemptId]);
    return rows.map((r) => r.doc);
  },
  async forAttempts(attemptIds: string[]): Promise<Map<string, Answer[]>> {
    const map = new Map<string, Answer[]>();
    if (attemptIds.length === 0) return map;
    const { rows } = await be().query<{ doc: Answer }>(
      `select doc from answers where attempt_id = any($1::text[])`, [attemptIds]);
    for (const r of rows) {
      const arr = map.get(r.doc.attemptId) ?? [];
      arr.push(r.doc);
      map.set(r.doc.attemptId, arr);
    }
    return map;
  },
  async byId(id: string): Promise<Answer | null> {
    const { rows } = await be().query<{ doc: Answer }>(`select doc from answers where id = $1`, [id]);
    return rows[0]?.doc ?? null;
  },
  async forAttemptQuestion(attemptId: string, questionId: string): Promise<Answer | null> {
    const rows = (await this.forAttempt(attemptId)).filter((a) => a.questionId === questionId);
    return rows[0] ?? null;
  },
  async removeForAttempts(attemptIds: string[]): Promise<void> {
    if (attemptIds.length === 0) return;
    await be().query(`delete from answers where attempt_id = any($1::text[])`, [attemptIds]);
  },
  async totalCount(): Promise<number> {
    const { rows } = await be().query<{ n: string }>(`select count(*)::text as n from answers`);
    return Number(rows[0]?.n ?? 0);
  },
};

// Proctoring integrity events — off-mirror, indexed by attempt + severity.
// Batched `forAttempts` keeps list/aggregate handlers to one query instead of N.
export const proctorStore = {
  async add(event: ProctorEvent): Promise<void> {
    await be().query(
      `insert into proctor_events(id, attempt_id, severity, at, doc) values ($1, $2, $3, $4, $5::jsonb)
       on conflict (id) do update set doc = excluded.doc, attempt_id = excluded.attempt_id, severity = excluded.severity, at = excluded.at`,
      [event.id, event.attemptId, event.severity, event.at, JSON.stringify(event)]);
  },
  async forAttempt(attemptId: string): Promise<ProctorEvent[]> {
    const { rows } = await be().query<{ doc: ProctorEvent }>(
      `select doc from proctor_events where attempt_id = $1 order by at asc`, [attemptId]);
    return rows.map((r) => r.doc);
  },
  /** Batched: one query for many attempts → Map keyed by attemptId. */
  async forAttempts(attemptIds: string[]): Promise<Map<string, ProctorEvent[]>> {
    const map = new Map<string, ProctorEvent[]>();
    if (attemptIds.length === 0) return map;
    const { rows } = await be().query<{ doc: ProctorEvent }>(
      `select doc from proctor_events where attempt_id = any($1::text[]) order by at asc`, [attemptIds]);
    for (const r of rows) {
      const arr = map.get(r.doc.attemptId) ?? [];
      arr.push(r.doc);
      map.set(r.doc.attemptId, arr);
    }
    return map;
  },
  /** All non-"info" events across every attempt (for cross-exam aggregations). */
  async allFlagged(): Promise<ProctorEvent[]> {
    const { rows } = await be().query<{ doc: ProctorEvent }>(
      `select doc from proctor_events where severity <> 'info' order by at asc`);
    return rows.map((r) => r.doc);
  },
  async removeForAttempts(attemptIds: string[]): Promise<void> {
    if (attemptIds.length === 0) return;
    await be().query(`delete from proctor_events where attempt_id = any($1::text[])`, [attemptIds]);
  },
  async removeByIds(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await be().query(`delete from proctor_events where id = any($1::text[])`, [ids]);
  },
  async totalCount(): Promise<number> {
    const { rows } = await be().query<{ n: string }>(`select count(*)::text as n from proctor_events`);
    return Number(rows[0]?.n ?? 0);
  },
};

// Geofence GPS checks — off-mirror, indexed by registration + attempt. Every
// check (success or failure) is kept for the location audit trail/report.
export const geofenceStore = {
  async add(log: GeofenceLog): Promise<void> {
    await be().query(
      `insert into geofence_logs(id, registration_id, attempt_id, at, doc) values ($1, $2, $3, $4, $5::jsonb)
       on conflict (id) do update set doc = excluded.doc, registration_id = excluded.registration_id, attempt_id = excluded.attempt_id, at = excluded.at`,
      [log.id, log.registrationId, log.attemptId, log.at, JSON.stringify(log)]);
  },
  async forRegistration(registrationId: string): Promise<GeofenceLog[]> {
    const { rows } = await be().query<{ doc: GeofenceLog }>(
      `select doc from geofence_logs where registration_id = $1 order by at asc`, [registrationId]);
    return rows.map((r) => r.doc);
  },
  async forAttempt(attemptId: string): Promise<GeofenceLog[]> {
    const { rows } = await be().query<{ doc: GeofenceLog }>(
      `select doc from geofence_logs where attempt_id = $1 order by at asc`, [attemptId]);
    return rows.map((r) => r.doc);
  },
  async forAttempts(attemptIds: string[]): Promise<Map<string, GeofenceLog[]>> {
    const map = new Map<string, GeofenceLog[]>();
    if (attemptIds.length === 0) return map;
    const { rows } = await be().query<{ doc: GeofenceLog }>(
      `select doc from geofence_logs where attempt_id = any($1::text[]) order by at asc`, [attemptIds]);
    for (const r of rows) {
      const arr = map.get(r.doc.attemptId!) ?? [];
      arr.push(r.doc);
      map.set(r.doc.attemptId!, arr);
    }
    return map;
  },
  async totalCount(): Promise<number> {
    const { rows } = await be().query<{ n: string }>(`select count(*)::text as n from geofence_logs`);
    return Number(rows[0]?.n ?? 0);
  },
};

// Admin action trail — append-only, off-mirror, indexed by time.
// Tamper-evident: every entry hash-chains to the previous one, so any later edit
// or deletion of a row breaks chain verification.
function auditEntryHash(prevHash: string, log: AuditLog): string {
  const core = JSON.stringify([log.id, log.at, log.actorId, log.actorName, log.action, log.target]);
  return createHash("sha256").update(prevHash + core).digest("hex");
}
export const auditStore = {
  async add(log: AuditLog): Promise<void> {
    const tip = (await this.recent(1))[0];
    const prevHash = tip?.hash ?? "";
    log.prevHash = prevHash;
    log.hash = auditEntryHash(prevHash, log);
    await be().query(
      `insert into audit_logs(id, at, doc) values ($1, $2, $3::jsonb)
       on conflict (id) do update set doc = excluded.doc, at = excluded.at`,
      [log.id, log.at, JSON.stringify(log)]);
  },
  /** Recompute the chain to detect any edited or removed entry. Legacy rows
   *  (written before chaining) are allowed only before the chain starts. */
  async verifyChain(): Promise<{ ok: boolean; brokenAt: string | null; entries: number }> {
    const { rows } = await be().query<{ doc: AuditLog }>(`select doc from audit_logs order by at asc`);
    let prev = ""; let started = false; let n = 0;
    for (const r of rows) {
      const log = r.doc;
      if (!log.hash) { if (started) return { ok: false, brokenAt: log.id, entries: n }; continue; }
      started = true; n++;
      if (log.hash !== auditEntryHash(prev, log) || (log.prevHash ?? "") !== prev) return { ok: false, brokenAt: log.id, entries: n };
      prev = log.hash;
    }
    return { ok: true, brokenAt: null, entries: n };
  },
  async recent(limit: number): Promise<AuditLog[]> {
    const { rows } = await be().query<{ doc: AuditLog }>(
      `select doc from audit_logs order by at desc limit $1`, [limit]);
    return rows.map((r) => r.doc);
  },
  async count(): Promise<number> {
    const { rows } = await be().query<{ n: string }>(`select count(*)::text as n from audit_logs`);
    return Number(rows[0]?.n ?? 0);
  },
  async purgeOlderThan(cutoffIso: string): Promise<number> {
    const { rows } = await be().query<{ id: string }>(`delete from audit_logs where at < $1 returning id`, [cutoffIso]);
    return rows.length;
  },
};

// Email delivery log — append-only, off-mirror, indexed by send time.
export const emailStore = {
  async add(msg: EmailMessage): Promise<void> {
    await be().query(
      `insert into emails(id, sent_at, doc) values ($1, $2, $3::jsonb)
       on conflict (id) do update set doc = excluded.doc, sent_at = excluded.sent_at`,
      [msg.id, msg.sentAt, JSON.stringify(msg)]);
  },
  async recent(limit: number): Promise<EmailMessage[]> {
    const { rows } = await be().query<{ doc: EmailMessage }>(
      `select doc from emails order by sent_at desc limit $1`, [limit]);
    return rows.map((r) => r.doc);
  },
  async count(): Promise<number> {
    const { rows } = await be().query<{ n: string }>(`select count(*)::text as n from emails`);
    return Number(rows[0]?.n ?? 0);
  },
};

// Mirrors backup.ts's backupDir() (duplicated rather than imported to avoid a
// db.ts <-> backup.ts circular import in the startup-critical recovery path).
function resolveBackupDir(): string {
  if (process.env.BACKUP_DIR) return process.env.BACKUP_DIR;
  const dataDir = process.env.PGLITE_DIR;
  if (dataDir && dataDir !== "memory://") return path.join(path.dirname(dataDir), "backups");
  return path.join(process.cwd(), "backups");
}

// Signatures of the PGlite failure modes we can self-heal: on-disk data
// corruption, whether it surfaces as a normal Postgres error on read
// ("missing chunk number...") or as a hard WASM-runtime abort during
// Postgres's own startup/WAL-recovery (seen after a stale postmaster.pid
// retry — the lock is gone but the underlying data is still inconsistent).
// A stale lock alone (handled separately by openPglite's own retry) or a
// genuine schema/query bug should keep crashing loudly instead.
function looksLikeCorruption(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /missing chunk number|invalid page in block|could not read block|unexpected data beyond eof|invalid memory alloc request|xx001|aborted\(|runtimeerror/i.test(msg);
}

const OFF_MIRROR_RESTORERS: [string, (row: never) => Promise<void>][] = [
  ["snapshots", (r) => snapshotStore.add(r)],
  ["answers", (r) => answerStore.upsert(r)],
  ["proctor_events", (r) => proctorStore.add(r)],
  ["audit_logs", (r) => auditStore.add(r)],
  ["emails", (r) => emailStore.add(r)],
  ["geofence_logs", (r) => geofenceStore.add(r)],
];

/** Loads a full dump (as produced by dumpAll/runBackup) into the current
 *  (already-empty, already-schema'd) database. Shared by the manual CLI
 *  restore script and the automatic corruption recovery path below. */
async function restoreFromDump(data: Record<string, unknown[]>) {
  for (const { key } of TABLES) {
    (db.data[key] as unknown[]) = Array.isArray(data[key]) ? data[key] : [];
  }
  await db.write();
  // Off-mirror tables restore in original order — required for auditStore's
  // hash-chain to verify correctly.
  for (const [name, addFn] of OFF_MIRROR_RESTORERS) {
    const rows = Array.isArray(data[name]) ? data[name] : [];
    for (const row of rows) await addFn(row as never);
  }
}

/** Idempotent: creates every table (mirrored + off-mirror) and applies the
 *  in-place backfill SQL. Safe to call again against a freshly recreated,
 *  empty backend after a corruption quarantine. */
async function ensureSchema() {
  await be().exec(TABLES.map((t) => `CREATE TABLE IF NOT EXISTS ${t.table} (id text primary key, doc jsonb not null);`).join("\n"));

  // Dedicated, indexed snapshots table (not part of the mirror). The ALTER/UPDATE
  // steps migrate a pre-existing generic (id, doc) snapshots table in place.
  await be().exec([
    "CREATE TABLE IF NOT EXISTS snapshots (id text primary key, attempt_id text, at text, doc jsonb not null);",
    "ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS attempt_id text;",
    "ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS at text;",
    "UPDATE snapshots SET attempt_id = doc->>'attemptId', at = doc->>'at' WHERE attempt_id IS NULL;",
    "CREATE INDEX IF NOT EXISTS snapshots_attempt_idx ON snapshots(attempt_id);",
    "CREATE INDEX IF NOT EXISTS snapshots_at_idx ON snapshots(at);",
  ].join("\n"));

  // Append-only log tables (also off-mirror). Migrate any pre-existing generic
  // (id, doc) table in place by adding/backfilling the ordering column.
  await be().exec([
    "CREATE TABLE IF NOT EXISTS audit_logs (id text primary key, at text, doc jsonb not null);",
    "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS at text;",
    "UPDATE audit_logs SET at = doc->>'at' WHERE at IS NULL;",
    "CREATE INDEX IF NOT EXISTS audit_logs_at_idx ON audit_logs(at);",
    "CREATE TABLE IF NOT EXISTS emails (id text primary key, sent_at text, doc jsonb not null);",
    "ALTER TABLE emails ADD COLUMN IF NOT EXISTS sent_at text;",
    "UPDATE emails SET sent_at = doc->>'sentAt' WHERE sent_at IS NULL;",
    "CREATE INDEX IF NOT EXISTS emails_sent_at_idx ON emails(sent_at);",
    // Backfill delivery metadata on emails predating real delivery (was a mirror loop).
    "UPDATE emails SET doc = jsonb_set(jsonb_set(doc, '{delivery}', '\"logged\"'), '{provider}', '\"mock\"') WHERE doc->>'delivery' IS NULL;",
    // Proctoring events — off-mirror, indexed by attempt + severity for integrity queries.
    "CREATE TABLE IF NOT EXISTS proctor_events (id text primary key, attempt_id text, severity text, at text, doc jsonb not null);",
    "ALTER TABLE proctor_events ADD COLUMN IF NOT EXISTS attempt_id text;",
    "ALTER TABLE proctor_events ADD COLUMN IF NOT EXISTS severity text;",
    "ALTER TABLE proctor_events ADD COLUMN IF NOT EXISTS at text;",
    "UPDATE proctor_events SET attempt_id = doc->>'attemptId', severity = doc->>'severity', at = doc->>'at' WHERE attempt_id IS NULL;",
    "CREATE INDEX IF NOT EXISTS proctor_events_attempt_idx ON proctor_events(attempt_id);",
    "CREATE INDEX IF NOT EXISTS proctor_events_severity_idx ON proctor_events(severity);",
    // Geofence GPS checks — off-mirror, indexed by registration + attempt.
    "CREATE TABLE IF NOT EXISTS geofence_logs (id text primary key, registration_id text, attempt_id text, at text, doc jsonb not null);",
    "CREATE INDEX IF NOT EXISTS geofence_logs_registration_idx ON geofence_logs(registration_id);",
    "CREATE INDEX IF NOT EXISTS geofence_logs_attempt_idx ON geofence_logs(attempt_id);",
    // Submitted answers — off-mirror, indexed by attempt.
    "CREATE TABLE IF NOT EXISTS answers (id text primary key, attempt_id text, doc jsonb not null);",
    "ALTER TABLE answers ADD COLUMN IF NOT EXISTS attempt_id text;",
    "UPDATE answers SET attempt_id = doc->>'attemptId' WHERE attempt_id IS NULL;",
    "CREATE INDEX IF NOT EXISTS answers_attempt_idx ON answers(attempt_id);",
    // Legacy grading-lifecycle backfill: answers predating awardedPoints get it
    // from their correctness × the question's points, and are marked auto-graded.
    "UPDATE answers a SET doc = jsonb_set(jsonb_set(jsonb_set(a.doc, '{awardedPoints}', to_jsonb(CASE WHEN a.doc->>'correct' = 'true' THEN COALESCE(NULLIF(q.doc->>'points','')::int, 0) ELSE 0 END)), '{gradedBy}', '\"auto\"'), '{needsReview}', 'false') FROM questions q WHERE a.doc->>'questionId' = q.id AND NOT (a.doc ? 'awardedPoints');",
  ].join("\n"));
}

/** Only reachable for the embedded PGlite backend (see looksLikeCorruption
 *  call site). Quarantines the corrupted data directory, opens a fresh empty
 *  one, and restores the most recent automatic backup into it — so a host
 *  that SIGKILLed the process mid-write self-heals on the next boot instead
 *  of crash-looping forever. Returns the backup filename that was restored. */
async function recoverFromLatestBackup(): Promise<string> {
  const dataDir = process.env.PGLITE_DIR || path.join(__dirname, ".pgdata");
  const dir = resolveBackupDir();
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.startsWith("orcalis-backup-") && f.endsWith(".json.gz")).sort()
    : [];
  const latest = files[files.length - 1];
  if (!latest) {
    throw new Error(`Embedded database is corrupted and no backup was found in ${dir} to auto-recover from — manual intervention required.`);
  }
  const backupPath = path.join(dir, latest);
  console.error(`💥 Embedded database appears corrupted — auto-recovering from latest backup: ${backupPath}`);

  // backend may be null here — a hard WASM abort during PGlite's own startup
  // (e.g. corrupt WAL replay) can throw before createBackend() ever returns.
  if (backend) { await backend.close(); backend = null; }
  const quarantine = `${dataDir}.corrupted-${Date.now()}`;
  if (fs.existsSync(dataDir)) fs.renameSync(dataDir, quarantine);
  console.error(`   Corrupted data quarantined at: ${quarantine}`);

  backend = await createBackend();
  await ensureSchema();

  const raw = await gunzipAsync(fs.readFileSync(backupPath));
  const { takenAt, data } = JSON.parse(raw.toString("utf8")) as { takenAt: string; data: Record<string, unknown[]> };
  console.error(`   Restoring backup taken at ${takenAt}...`);
  await restoreFromDump(data);
  console.error(`   Auto-recovery complete — restored ${latest}.`);
  return latest;
}

async function importLegacyJson(): Promise<boolean> {
  const legacy = path.join(__dirname, "data.json");
  if (!fs.existsSync(legacy)) return false;
  try {
    const parsed = JSON.parse(fs.readFileSync(legacy, "utf8")) as Partial<Schema>;
    for (const { key } of TABLES) {
      if (Array.isArray(parsed[key])) (db.data[key] as unknown[]) = parsed[key] as unknown[];
    }
    fs.renameSync(legacy, legacy + ".migrated"); // keep a backup, don't re-import
    return true;
  } catch {
    return false;
  }
}

export async function initDb() {
  // Corrupted on-disk data can surface at any point in this sequence — as a
  // hard WASM abort while PGlite/Postgres is still starting up and replaying
  // its WAL (openPglite's stale-lock retry gets past a false-positive lock,
  // but the data underneath can still be broken), or as a normal Postgres
  // error the first time a table is actually read. Either way, self-heal by
  // restoring the latest automatic backup rather than crash-looping — see
  // recoverFromLatestBackup(). Only attempted for the embedded backend;
  // managed Postgres failures should keep crashing loudly.
  const usingEmbedded = !process.env.DATABASE_URL;
  let recoveredFrom: string | null = null;
  try {
    backend = await createBackend();
    await ensureSchema();
    await db.read();
  } catch (err) {
    if (!usingEmbedded || !looksLikeCorruption(err)) throw err;
    recoveredFrom = await recoverFromLatestBackup();
  }

  // One-time migration from the previous lowdb JSON file, if the database is
  // empty (never applies after a backup recovery — that database isn't empty,
  // it's freshly restored).
  const empty = !recoveredFrom && TABLES.every((t) => (db.data[t.key] as unknown[]).length === 0);
  let imported = false;
  if (empty) imported = await importLegacyJson();

  // Schema migrations / backfills. Track whether anything actually changed so a
  // routine boot (e.g. the host waking the app from idle) skips the full-table
  // flush at the end — that flush is by far the most expensive part of startup.
  let changed = imported;

  for (const exam of db.data.exams) {
    if (!exam.enrollment) { exam.enrollment = "open"; changed = true; }
    const mergedLockdown = { ...DEFAULT_LOCKDOWN, ...(exam.lockdown ?? {}) };
    if (JSON.stringify(mergedLockdown) !== JSON.stringify(exam.lockdown ?? null)) {
      exam.lockdown = mergedLockdown;
      changed = true;
    }
  }
  const seededAt = new Date().toISOString();
  for (const reg of db.data.registrations) {
    if (!reg.createdAt) { reg.createdAt = seededAt; changed = true; }
    if (!reg.approval) { reg.approval = "confirmed"; changed = true; }
    // Encrypt biometric / ID media stored as plaintext before these fields were
    // encrypted at rest. Idempotent: encryptString skips already-encrypted values
    // and is a no-op when no DATA_ENCRYPTION_KEY is configured.
    if (typeof reg.verificationPhoto === "string") { const e = encryptString(reg.verificationPhoto); if (e !== reg.verificationPhoto) { reg.verificationPhoto = e; changed = true; } }
    if (typeof reg.idDocumentPhoto === "string") { const e = encryptString(reg.idDocumentPhoto); if (e !== reg.idDocumentPhoto) { reg.idDocumentPhoto = e; changed = true; } }
    if (Array.isArray(reg.roomScanPhotos) && reg.roomScanPhotos.length) {
      const orig = reg.roomScanPhotos;
      const enc = orig.map((s) => (typeof s === "string" ? encryptString(s) : s));
      if (enc.some((v, i) => v !== orig[i])) { reg.roomScanPhotos = enc; changed = true; }
    }
  }

  // Encrypt any user avatar/phone stored as plaintext before these fields were
  // encrypted at rest (idempotent; no-op without a DATA_ENCRYPTION_KEY).
  for (const u of db.data.users) {
    if (typeof u.avatarUrl === "string") { const e = encryptString(u.avatarUrl); if (e !== u.avatarUrl) { u.avatarUrl = e; changed = true; } }
    if (typeof u.phone === "string") { const e = encryptString(u.phone); if (e !== u.phone) { u.phone = e; changed = true; } }
  }

  // Encrypt any webhook secret stored as plaintext before this field was
  // encrypted at rest (idempotent; no-op without a DATA_ENCRYPTION_KEY).
  for (const s of db.data.settings) {
    for (const w of s.webhooks ?? []) {
      if (typeof w.secret === "string") { const e = encryptString(w.secret); if (e !== w.secret) { w.secret = e; changed = true; } }
    }
  }

  // Grading-lifecycle backfill for attempts created before this feature.
  // (Answer-level backfill runs as SQL in the answers table init above.)
  for (const att of db.data.attempts) {
    if (att.status === "submitted" && !att.gradingStatus) { att.gradingStatus = "released"; changed = true; }
  }
  // DLRMS backfill for books created before the resource-type/visibility/
  // versioning/engagement fields existed. Existing books were effectively
  // "live" already, so they become resourceType "eBook", status "published",
  // institution-wide visibility, version 1, zeroed counters.
  for (const book of db.data.books) {
    if (!book.resourceType) { book.resourceType = "eBook"; changed = true; }
    if (!book.visibility) { book.visibility = { scope: "institution", classIds: [], studentIds: [] }; changed = true; }
    if (!book.status) { book.status = "published"; changed = true; }
    if (book.canDownload === undefined) { book.canDownload = true; changed = true; }
    if (book.canPreview === undefined) { book.canPreview = true; changed = true; }
    if (book.version === undefined) { book.version = 1; changed = true; }
    if (book.viewCount === undefined) { book.viewCount = 0; changed = true; }
    if (book.downloadCount === undefined) { book.downloadCount = 0; changed = true; }
  }

  // Ensure the single org-settings record exists; backfill new profile fields.
  let org = db.data.settings.find((s) => s.id === "org");
  if (!org) {
    org = {
      id: "org", name: "Oriole", supportEmail: "support@orcalis.dev", website: "",
      timezone: "UTC", defaultPassingScore: 60, defaultProctored: true, autoConfirmEnrollment: false,
    };
    db.data.settings.push(org);
    changed = true;
  }
  if (!org.type) { org.type = "University"; changed = true; }
  if (!org.plan) { org.plan = "Starter"; changed = true; }
  if (org.accreditation === undefined) { org.accreditation = ""; changed = true; }
  if (org.phone === undefined) { org.phone = ""; changed = true; }
  if (org.address === undefined) { org.address = ""; changed = true; }
  if (!org.learningStructure) { org.learningStructure = { ...DEFAULT_LEARNING_STRUCTURE }; changed = true; }

  // Bootstrap a permanent admin account if one with this email doesn't exist.
  // Override via env in production (ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME).
  // Only ever CREATES — never overwrites an existing account, so a password
  // changed later in-app is preserved.
  const adminEmail = (process.env.ADMIN_EMAIL || "jevisexcell024@gmail.com").trim();
  const adminName = process.env.ADMIN_NAME || "Administrator";
  const existingAdmin = db.data.users.find((u) => u.email.toLowerCase() === adminEmail.toLowerCase());
  if (!existingAdmin) {
    // Never ship a hardcoded password. Use ADMIN_PASSWORD when provided, otherwise
    // generate a strong random one and print it ONCE so the operator can sign in
    // and change it immediately.
    const providedPw = process.env.ADMIN_PASSWORD;
    const adminPassword = providedPw || randomBytes(18).toString("base64url");
    db.data.users.push({
      id: nanoid(10),
      email: adminEmail,
      name: adminName,
      role: "admin",
      passwordHash: bcrypt.hashSync(adminPassword, BCRYPT_COST),
    } as User);
    changed = true;
    console.log(`👤 Bootstrapped admin account: ${adminEmail}`);
    if (!providedPw) {
      console.log(`🔑 One-time admin password (set ADMIN_PASSWORD to choose your own): ${adminPassword}`);
      console.log("   Sign in and change it right away.");
    }
  } else if (process.env.ADMIN_RESET_PASSWORD === "1" && process.env.ADMIN_PASSWORD) {
    // Explicit emergency reset — locked behind a second env var (ADMIN_RESET_PASSWORD=1)
    // on top of ADMIN_PASSWORD alone, so a stale ADMIN_PASSWORD left over from initial
    // setup can never silently overwrite a password changed later in-app. Meant to be
    // set for exactly one restart, then removed.
    existingAdmin.passwordHash = bcrypt.hashSync(process.env.ADMIN_PASSWORD, BCRYPT_COST);
    changed = true;
    console.log(`🔑 Admin password for ${adminEmail} force-reset via ADMIN_RESET_PASSWORD. Remove that env var now.`);
  }

  if (changed) await db.write();
  console.log(`🗄️  Storage backend: ${be().kind}${imported ? " (migrated legacy data.json)" : ""}${changed ? "" : " (clean boot, no migration flush)"}`);
}
