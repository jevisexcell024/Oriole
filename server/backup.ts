import path from "node:path";
import fs from "node:fs";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { dumpAll } from "./db.ts";
import { logger } from "./logger.ts";
import { recordJobRun } from "./reliability.ts";

const gzipAsync = promisify(gzip);

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

let lastBackupAt: string | null = null;
let lastBackupBytes: number | null = null;
let lastBackupError: string | null = null;

export function backupStatus() {
  return { dir: backupDir(), lastBackupAt, lastBackupBytes, lastBackupError, retentionCount: retentionCount(), intervalHours: intervalHours() };
}

/** Dump every table to a single gzip-compressed JSON file, timestamped, then
 *  prune old backups past the retention count. Returns the written file path. */
export async function runBackup(): Promise<{ file: string; bytes: number }> {
  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });

  const data = await dumpAll();
  const json = JSON.stringify({ takenAt: new Date().toISOString(), data });
  const gz = await gzipAsync(Buffer.from(json, "utf8"));

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `orcalis-backup-${stamp}.json.gz`);
  fs.writeFileSync(file, gz);

  // Prune: keep only the most recent `retentionCount` backups.
  const files = fs.readdirSync(dir)
    .filter((f) => f.startsWith("orcalis-backup-") && f.endsWith(".json.gz"))
    .sort(); // ISO-ish timestamps in the filename sort chronologically
  const excess = files.length - retentionCount();
  for (let i = 0; i < excess; i++) fs.rmSync(path.join(dir, files[i]), { force: true });

  lastBackupAt = new Date().toISOString();
  lastBackupBytes = gz.length;
  lastBackupError = null;
  logger.info({ file, bytes: gz.length, kept: Math.min(files.length, retentionCount()) }, "database backup written");
  return { file, bytes: gz.length };
}

let timer: ReturnType<typeof setInterval> | null = null;

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
  fire(); // one at startup so a redeploy/restart doesn't leave a stale gap
  timer = setInterval(fire, intervalHours() * 60 * 60 * 1000);
  timer.unref?.();
}

export function stopBackup() { if (timer) { clearInterval(timer); timer = null; } }
