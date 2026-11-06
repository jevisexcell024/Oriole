import path from "node:path";
import fs from "node:fs";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { dumpEach } from "./db.ts";
import { logger } from "./logger.ts";
import { recordJobRun } from "./reliability.ts";

// Where backups land. Defaults to a `backups/` folder that's a SIBLING of the
// live PGlite data directory (not inside it, and not inside the app's own code
// folder — a redeploy only ever touches dist/ + server.mjs, so this survives
// redeploys the same way the data directory itself does). Override with
// BACKUP_DIR if you want it somewhere else (e.g. to match wherever your host's
// whole-account backup / cPanel backup destination is scoped to).
function backupDir(): string {
  if (process.env.BACKUP_DIR) return process.env.BACKUP_DIR;
  const dataDir = process.env.PGLITE_DIR;
  if (dataDir && dataDir !== "memory://") return path.join(path.dirname(dataDir), "backups");
  return path.join(process.cwd(), "backups");
}

// How many backups to keep (oldest deleted first). A daily cadence with 14
// kept gives two weeks of history without unbounded disk growth.
function retentionCount(): number {
  const n = Number(process.env.BACKUP_RETENTION_COUNT ?? 14);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 14;
}

function intervalHours(): number {
  const n = Number(process.env.BACKUP_INTERVAL_HOURS ?? 24);
  return Number.isFinite(n) && n > 0 ? n : 24;
}

/** Proctoring webcam frames are the bulk of a busy database (up to ~24 per exam attempt),
 *  are disposable by design (a rolling timeline, purged by the retention sweep) and are
 *  encrypted blobs — including them is what made a backup balloon to hundreds of MB.
 *  Set BACKUP_INCLUDE_SNAPSHOTS=true to keep them in the backup anyway. */
function skippedTables(): string[] {
  return process.env.BACKUP_INCLUDE_SNAPSHOTS === "true" ? [] : ["snapshots"];
}

const FILE_PREFIX = "orcalis-backup-";
const FILE_SUFFIX = ".json.gz";

let lastBackupAt: string | null = null;
let lastBackupBytes: number | null = null;
let lastBackupError: string | null = null;

export function backupStatus() {
  return { dir: backupDir(), lastBackupAt, lastBackupBytes, lastBackupError, retentionCount: retentionCount(), intervalHours: intervalHours(), excludes: skippedTables() };
}

/** Dump every table to a single gzip-compressed JSON file, timestamped, then
 *  prune old backups past the retention count. Returns the written file path.
 *
 *  The file is STREAMED: one table at a time, in slices of rows, straight through
 *  gzip to disk. The old version built the whole database as one JavaScript string
 *  and then copied it twice more (Buffer, gzip output), so peak memory was a few
 *  times the size of the database — enough to get the process killed on a host
 *  with a memory limit. The file format is unchanged, so restores still work. */
export async function runBackup(): Promise<{ file: string; bytes: number }> {
  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `${FILE_PREFIX}${stamp}${FILE_SUFFIX}`);
  const partial = `${file}.partial`; // never matches the backup-file pattern until it is complete

  const gz = createGzip();
  const done = pipeline(gz, fs.createWriteStream(partial));
  done.catch(() => { /* surfaced through the awaits below */ });
  const write = (chunk: string) => (gz.write(chunk) ? Promise.resolve() : new Promise<void>((resolve) => gz.once("drain", () => resolve())));

  try {
    await write(`{"takenAt":${JSON.stringify(new Date().toISOString())},"data":{`);
    let first = true;
    const SLICE = 500;
    for await (const [name, rows] of dumpEach(skippedTables())) {
      await write(`${first ? "" : ","}${JSON.stringify(name)}:[`);
      first = false;
      for (let i = 0; i < rows.length; i += SLICE) {
        const part = JSON.stringify(rows.slice(i, i + SLICE));
        await write((i ? "," : "") + part.slice(1, -1));
      }
      await write("]");
    }
    await write("}}");
    gz.end();
    await done;
  } catch (e) {
    gz.destroy();
    fs.rmSync(partial, { force: true });
    throw e;
  }
  fs.renameSync(partial, file);
  const bytes = fs.statSync(file).size;

  // Prune: keep only the most recent `retentionCount` backups (and sweep stray partials).
  const names = fs.readdirSync(dir);
  for (const f of names) if (f.startsWith(FILE_PREFIX) && f.endsWith(".partial") && f !== path.basename(partial)) fs.rmSync(path.join(dir, f), { force: true });
  const files = names.filter((f) => f.startsWith(FILE_PREFIX) && f.endsWith(FILE_SUFFIX)).sort(); // ISO-ish timestamps sort chronologically
  const excess = files.length - retentionCount();
  for (let i = 0; i < excess; i++) fs.rmSync(path.join(dir, files[i]), { force: true });

  lastBackupAt = new Date().toISOString();
  lastBackupBytes = bytes;
  lastBackupError = null;
  logger.info({ file, bytes, kept: Math.min(files.length, retentionCount()), excludes: skippedTables() }, "database backup written");
  return { file, bytes };
}

/** Age (ms) of the newest completed backup on disk, or null if there is none. */
function newestBackupAgeMs(): number | null {
  try {
    const dir = backupDir();
    let newest = 0;
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith(FILE_PREFIX) || !f.endsWith(FILE_SUFFIX)) continue;
      newest = Math.max(newest, fs.statSync(path.join(dir, f)).mtimeMs);
    }
    return newest ? Date.now() - newest : null;
  } catch { return null; }
}

let timer: ReturnType<typeof setInterval> | null = null;
let startupTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleBackup() {
  const fire = () => {
    const t0 = performance.now();
    void runBackup()
      .then(() => recordJobRun("backup", true, performance.now() - t0))
      .catch((e) => {
        lastBackupError = e instanceof Error ? e.message : String(e);
        recordJobRun("backup", false, performance.now() - t0, lastBackupError);
        logger.error({ err: e }, "database backup failed");
      });
  };
  // Not at the instant of startup (that is when requests are arriving and, on a host that
  // recycles idle apps, when the process has just been revived — a full dump then made every
  // cold start slower and heavier). Only if the newest backup is already older than one
  // interval, and a few minutes in, spread randomly.
  const age = newestBackupAgeMs();
  if (age === null || age >= intervalHours() * 3_600_000) {
    startupTimer = setTimeout(fire, (3 + Math.random() * 3) * 60_000);
    startupTimer.unref?.();
  }
  timer = setInterval(fire, intervalHours() * 60 * 60 * 1000);
  timer.unref?.();
}

export function stopBackup() {
  if (timer) { clearInterval(timer); timer = null; }
  if (startupTimer) { clearTimeout(startupTimer); startupTimer = null; }
}
