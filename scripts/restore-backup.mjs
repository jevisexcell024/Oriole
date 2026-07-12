#!/usr/bin/env node
// One-off recovery script: rebuilds server/.pgdata from a gzip-compressed
// backup produced by server/backup.ts (runBackup / the "database backup
// written" log lines). Used once, manually, after the embedded PGlite file
// crashed with a hard WASM runtime error (data-directory corruption from an
// unclean shutdown) — NOT part of the normal app flow.
//
// Usage: node scripts/restore-backup.mjs <path-to-backup.json.gz>
// The target .pgdata must not already exist (move any existing one aside first).

import fs from "node:fs";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";

const gunzipAsync = promisify(gunzip);

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/restore-backup.mjs <path-to-backup.json.gz>");
  process.exit(1);
}

const { db, initDb, snapshotStore, answerStore, proctorStore, auditStore, emailStore, geofenceStore } = await import("../server/db.ts");

const raw = await gunzipAsync(fs.readFileSync(file));
const { takenAt, data } = JSON.parse(raw.toString("utf8"));
console.log(`Backup taken at: ${takenAt}`);
console.log(`Tables in backup: ${Object.keys(data).join(", ")}`);

console.log("\nInitializing a fresh database...");
await initDb();

const MIRRORED = [
  "users", "exams", "questions", "registrations", "attempts", "certificates",
  "announcements", "settings", "faculties", "departments", "programs", "campuses",
  "academicYears", "classes", "regradeRequests", "books", "readingProgress",
  "resourceVersions", "resourceBookmarks", "resourceRatings", "resourceDownloadLogs",
  "announcementReads",
];

console.log("\nRestoring mirrored tables...");
for (const key of MIRRORED) {
  const rows = Array.isArray(data[key]) ? data[key] : [];
  db.data[key] = rows;
  console.log(`  ${key}: ${rows.length} row(s)`);
}
await db.write();
console.log("Mirrored tables written.");

console.log("\nRestoring off-mirror tables (in original order, for audit-log hash-chain integrity)...");
const restoreOffMirror = async (name, rows, addFn) => {
  const list = Array.isArray(rows) ? rows : [];
  for (const row of list) await addFn(row);
  console.log(`  ${name}: ${list.length} row(s)`);
};
await restoreOffMirror("snapshots", data.snapshots, (r) => snapshotStore.add(r));
await restoreOffMirror("answers", data.answers, (r) => answerStore.upsert(r));
await restoreOffMirror("proctor_events", data.proctor_events, (r) => proctorStore.add(r));
await restoreOffMirror("audit_logs", data.audit_logs, (r) => auditStore.add(r));
await restoreOffMirror("emails", data.emails, (r) => emailStore.add(r));
await restoreOffMirror("geofence_logs", data.geofence_logs, (r) => geofenceStore.add(r));

console.log("\nRestore complete.");
process.exit(0);
