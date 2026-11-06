// Restores a backup file produced by the app's own backup job into the CURRENT database,
// every table included (schools, accounts, exams, questions, results, audit logs, emails,
// reliability history…). Use it to move your data to another computer.
//
//   npx tsx --env-file=.env scripts/restore-full-backup.ts path/to/orcalis-backup-….json.gz
//
// Run it against a fresh, empty database (the first run creates the tables). It refuses to run
// when the database already has accounts, unless you add --force. Webcam snapshots are not in
// the backup by default (they are disposable), so they are not restored.
import fs from "node:fs";
import { gunzipSync } from "node:zlib";

const file = process.argv[2];
const force = process.argv.includes("--force");
if (!file || file.startsWith("--")) {
  console.error("Usage: npx tsx --env-file=.env scripts/restore-full-backup.ts <backup.json.gz> [--force]");
  process.exit(1);
}

const { db, initDb, snapshotStore, mediaAssetStore, answerStore, proctorStore, geofenceStore, reliabilityStore, reliabilityRollupStore, auditStore, superAdminAuditStore, emailStore } = await import("../server/db.ts");

const { takenAt, data } = JSON.parse(gunzipSync(fs.readFileSync(file)).toString("utf8")) as { takenAt: string; data: Record<string, any[]> };
console.log(`Backup taken at ${takenAt}`);

await initDb();
// A brand-new database creates one starter school + admin account as soon as it initialises, so
// "empty" means: no more than that, and no exams yet. Anything else is real data — don't overwrite.
const looksFresh = db.data.users.length <= 1 && db.data.tenants.length <= 1 && db.data.exams.length === 0;
if (!looksFresh && !force) {
  console.error(`This database already has data (${db.data.users.length} account(s), ${db.data.exams.length} exam(s)). Restore into a fresh database, or add --force to overwrite.`);
  process.exit(1);
}

// Mirrored tables (kept in memory by the server): replace them wholesale, in one write.
for (const key of Object.keys(db.data)) {
  const rows = Array.isArray(data[key]) ? data[key] : [];
  (db.data as unknown as Record<string, unknown[]>)[key] = rows;
  console.log(`  ${key}: ${rows.length}`);
}
await db.write();

// Off-mirror tables: written row by row. Audit trails are replayed oldest-first so their
// tamper-evident hash chain is rebuilt in the original order.
const byAt = (a: { at?: string }, b: { at?: string }) => String(a.at ?? "").localeCompare(String(b.at ?? ""));
async function run(name: string, rows: any[] | undefined, add: (r: any) => Promise<unknown>, sort = false) {
  const list = [...(rows ?? [])];
  if (sort) list.sort(byAt);
  for (const r of list) await add(r);
  console.log(`  ${name}: ${list.length}`);
}
await run("snapshots", data.snapshots, (r) => snapshotStore.add(r));
await run("media_assets", data.media_assets, (r) => mediaAssetStore.add(r));
await run("answers", data.answers, (r) => answerStore.upsert(r));
await run("proctor_events", data.proctor_events, (r) => proctorStore.add(r));
await run("geofence_logs", data.geofence_logs, (r) => geofenceStore.add(r));
await run("reliability_samples", data.reliability_samples, (r) => reliabilityStore.add(r));
await run("reliability_daily_rollups", data.reliability_daily_rollups, (r) => reliabilityRollupStore.upsert(r));
await run("audit_logs", data.audit_logs, (r) => auditStore.add(r), true);
await run("super_admin_audit_logs", data.super_admin_audit_logs, (r) => superAdminAuditStore.add(r), true);
await run("emails", data.emails, (r) => emailStore.add(r));

console.log("\nRestore complete.");
process.exit(0);
