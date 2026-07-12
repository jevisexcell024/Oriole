#!/usr/bin/env node
// Load test — simulates N concurrent students taking an exam at the same time,
// polling /api/attempts/:id/control every 3.5s (matching the real client's
// polling interval) and periodically saving an answer, to get an actual
// measured capacity number instead of an unverified assumption.
//
// Usage:
//   node scripts/load-test.mjs [--students=500] [--duration=90] [--base=http://localhost:8787]
//
// Requires: the dev server running locally (`npm run dev:api` or `npm run dev`)
// with the seeded admin account (npm run seed, or ADMIN_EMAIL/ADMIN_PASSWORD env
// vars matching this script's constants below).
//
// SAFETY: refuses to run against anything that isn't localhost/127.0.0.1 — this
// creates real load and real database rows; never point it at a real, shared,
// or production server.

import http from "node:http";
import https from "node:https";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);

const BASE = args.base || "http://localhost:8787";
const STUDENTS = Number(args.students || 500);
const DURATION_S = Number(args.duration || 90);
// Spread student logins across this many seconds instead of firing all at once
// (simulates students trickling into check-in over a window rather than
// everyone clicking "Start Exam" in the same instant). 0 = original behavior.
const STAGGER_S = Number(args.stagger || 0);
const POLL_INTERVAL_MS = 3500;
const ANSWER_INTERVAL_MS = 10000;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@orcalis.dev";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "password123";

if (!/^https?:\/\/(localhost|127\.0\.0\.1)([:/]|$)/i.test(BASE)) {
  console.error(`Refusing to run against "${BASE}" — this tool only runs against localhost/127.0.0.1. Never point it at a shared or production server.`);
  process.exit(1);
}

// Node's built-in fetch() is backed by an internal undici dispatcher with a
// small default per-origin connection pool — at 500 concurrent virtual
// students, THAT pool becomes the bottleneck, not the server, which would
// silently invalidate this whole test. Using node:http/https directly with an
// Agent explicitly sized for the full concurrency level guarantees the client
// side is never the limiting factor.
const parsedBase = new URL(BASE);
const transport = parsedBase.protocol === "https:" ? https : http;
const agent = new transport.Agent({ keepAlive: true, maxSockets: STUDENTS + 50 });

// ---- Minimal per-virtual-student HTTP client with a manual cookie jar ----
class Session {
  constructor() { this.cookie = ""; }
  request(method, path, body, timeoutMs = 15000) {
    return new Promise((resolve) => {
      const start = performance.now();
      const payload = body !== undefined ? JSON.stringify(body) : undefined;
      const headers = { "Content-Type": "application/json" };
      if (payload) headers["Content-Length"] = Buffer.byteLength(payload);
      if (this.cookie) headers.Cookie = this.cookie;
      const req = transport.request(
        { hostname: parsedBase.hostname, port: parsedBase.port, path, method, headers, agent, timeout: timeoutMs },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const ms = performance.now() - start;
            const setCookie = res.headers["set-cookie"];
            if (setCookie?.length) this.cookie = setCookie[0].split(";")[0];
            let json = null;
            try { json = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* not JSON, fine for some endpoints */ }
            resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, ms, json });
          });
        },
      );
      req.on("timeout", () => { req.destroy(); resolve({ ok: false, ms: performance.now() - start, json: null, error: "timeout" }); });
      req.on("error", (e) => resolve({ ok: false, ms: performance.now() - start, json: null, error: String(e?.message ?? e) }));
      if (payload) req.write(payload);
      req.end();
    });
  }
}

// ---- Metrics ----
const metrics = { control: [], answer: [], login: [] };
const errors = [];
function record(bucket, ms, ok, note) {
  metrics[bucket].push(ms);
  if (!ok) errors.push({ bucket, ms: Math.round(ms), note, at: new Date().toISOString() });
}
function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}
function summarize(name, arr) {
  if (!arr.length) return `  ${name}: no samples`;
  const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
  return `  ${name}: n=${arr.length}  avg=${avg.toFixed(0)}ms  p50=${percentile(arr, 0.5).toFixed(0)}ms  p95=${percentile(arr, 0.95).toFixed(0)}ms  p99=${percentile(arr, 0.99).toFixed(0)}ms  max=${Math.max(...arr).toFixed(0)}ms`;
}

// ---- Setup: create a disposable exam + N candidate accounts via the real API ----
async function setup() {
  const admin = new Session();
  const login = await admin.request("POST", "/api/auth/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (!login.ok) {
    throw new Error(`Admin login failed (status ${login.status}). Run "npm run seed" first, or set ADMIN_EMAIL/ADMIN_PASSWORD env vars to match your dev admin account.`);
  }

  console.log("Enabling auto-confirm enrollment (so candidates don't need manual approval)...");
  await admin.request("PATCH", "/api/admin/settings", { autoConfirmEnrollment: true });

  console.log("Creating a disposable load-test exam...");
  const examRes = await admin.request("POST", "/api/admin/exams", { title: "Load Test Exam (auto-generated, safe to delete)", code: `LOADTEST-${Date.now()}` });
  if (!examRes.ok) throw new Error(`Exam creation failed: ${JSON.stringify(examRes.json)}`);
  const examId = examRes.json.exam.id;
  await admin.request("PATCH", `/api/admin/exams/${examId}`, { proctored: false, durationMinutes: 60, passingScore: 1 });

  const qRes = await admin.request("POST", `/api/admin/exams/${examId}/questions`, { type: "mcq" });
  const questionId = qRes.json.question.id;
  await admin.request("PATCH", `/api/admin/questions/${questionId}`, {
    prompt: "Load-test question — any answer is accepted.",
    options: ["A", "B", "C", "D"],
    correctAnswer: "A",
    points: 1,
  });

  const pubRes = await admin.request("POST", `/api/admin/exams/${examId}/publish`, { publish: true });
  if (!pubRes.ok) throw new Error(`Publish failed: ${JSON.stringify(pubRes.json)}`);
  console.log(`Exam published: ${examId}`);

  console.log(`Creating ${STUDENTS} candidate accounts (this is a real db.write(), may take a few seconds)...`);
  const stamp = Date.now();
  const rows = Array.from({ length: STUDENTS }, (_, i) => ({ name: `Load Test Student ${i}`, email: `loadtest${stamp}_${i}@test.local` }));
  // Generous timeout: creating N candidates means N sequential bcrypt hashes plus
  // N mock emails plus a full-mirror db.write() at the end — genuinely slow at
  // scale, but this is a one-time setup cost outside the measured load window.
  // Measured: 400 accounts takes ~150s (sequential bcryptjs hashing, no native
  // bindings) — 120s was too tight and caused false-negative timeouts.
  const bulkRes = await admin.request("POST", "/api/admin/candidates/bulk", { rows }, 300000);
  if (!bulkRes.json?.created?.length) throw new Error(`Bulk candidate creation returned no accounts (status ${bulkRes.status}, error: ${bulkRes.error ?? "none"}): ${JSON.stringify(bulkRes.json)}`);
  console.log(`Created ${bulkRes.json.created.length} candidates (${bulkRes.json.skipped?.length ?? 0} skipped).`);

  return { examId, questionId, candidates: bulkRes.json.created };
}

// ---- One simulated student's full session lifecycle ----
async function runStudent(cred, questionId, stopAt, startDelayMs = 0) {
  if (startDelayMs > 0) await new Promise((r) => setTimeout(r, startDelayMs));
  const s = new Session();
  // Generous timeout here on purpose: this is exactly the "login stampede" case
  // (many students logging in within the same few seconds) the test is meant to
  // measure. A short timeout would just hide how long the queue actually takes
  // to drain instead of reporting it.
  const login = await s.request("POST", "/api/auth/login", { email: cred.email, password: cred.tempPassword }, 120000);
  record("login", login.ms, login.ok, login.ok ? undefined : `login ${login.status}`);
  if (!login.ok) return;

  const exams = await s.request("GET", "/api/exams");
  if (!exams.ok || !exams.json?.items?.length) return;
  const item = exams.json.items.find((it) => it.exam.title.startsWith("Load Test Exam")) ?? exams.json.items[0];
  const registrationId = item.registration.id;

  const start = await s.request("POST", "/api/attempts", { registrationId });
  if (!start.ok || !start.json?.attempt) return;
  const attemptId = start.json.attempt.id;

  let lastAnswerAt = 0;
  while (Date.now() < stopAt) {
    const control = await s.request("GET", `/api/attempts/${attemptId}/control`);
    record("control", control.ms, control.ok, control.ok ? undefined : `control ${control.status}`);
    if (control.json?.terminated) break;

    if (Date.now() - lastAnswerAt > ANSWER_INTERVAL_MS) {
      lastAnswerAt = Date.now();
      const ans = await s.request("POST", `/api/attempts/${attemptId}/answer`, { questionId, value: "A" });
      record("answer", ans.ms, ans.ok, ans.ok ? undefined : `answer ${ans.status}`);
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

// ---- Main ----
async function main() {
  const staggerNote = STAGGER_S > 0 ? `, logins staggered over ${STAGGER_S}s` : ", all logins fired at once";
  console.log(`\nLoad test: ${STUDENTS} concurrent students, ${DURATION_S}s sustained${staggerNote}, against ${BASE}\n`);

  const { examId, questionId, candidates } = await setup();

  console.log(`\nStarting ${candidates.length} student sessions${STAGGER_S > 0 ? ` (staggered over ${STAGGER_S}s)` : " (concurrently)"}...\n`);
  const stopAt = Date.now() + (DURATION_S + STAGGER_S) * 1000;
  const t0 = performance.now();

  await Promise.all(candidates.map((c, i) => {
    const startDelayMs = STAGGER_S > 0 ? Math.floor((i / candidates.length) * STAGGER_S * 1000) : 0;
    return runStudent(c, questionId, stopAt, startDelayMs).catch((e) => errors.push({ bucket: "student", ms: 0, note: String(e), at: new Date().toISOString() }));
  }));

  const elapsed = ((performance.now() - t0) / 1000).toFixed(1);

  console.log(`\n=== Results (${elapsed}s elapsed, exam ${examId}) ===\n`);
  console.log(summarize("login", metrics.login));
  console.log(summarize("control-poll", metrics.control));
  console.log(summarize("answer-save", metrics.answer));
  console.log(`\n  Total control-polls: ${metrics.control.length}  |  Total errors: ${errors.length}`);
  if (errors.length) {
    console.log("\n  First 10 errors:");
    for (const e of errors.slice(0, 10)) console.log(`    [${e.at}] ${e.bucket}: ${e.note}`);
  }
  console.log(`\n  Cleanup: this created exam "${examId}" and ${candidates.length} test candidates — delete them via the admin UI or API when done.\n`);
}

main().catch((e) => { console.error("Load test failed:", e); process.exit(1); });
