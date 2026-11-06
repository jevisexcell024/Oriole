import { nanoid } from "nanoid";
import type { Request } from "express";
import { db } from "./db.ts";
import type { AuthSession } from "../shared/types.ts";

// Shared by server/auth.ts and server/superAdminAuth.ts — one real
// implementation of session tracking for both identities, not two duplicated
// ones, even though their JWTs are otherwise fully isolated from each other.

/** Creates a new real session record (one row per issued JWT) and returns its
 *  id to embed as the token's `sid` claim — the piece that makes individual
 *  ("kill just this one device") revocation possible, on top of the existing
 *  tokenVersion field's coarser "revoke everything at once". */
export async function recordSession(req: Request, ownerType: AuthSession["ownerType"], ownerId: string): Promise<string> {
  const session: AuthSession = {
    id: nanoid(21),
    ownerType,
    ownerId,
    userAgent: req.get("user-agent") ?? "",
    ip: req.ip ?? "",
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    revokedAt: null,
  };
  db.data!.authSessions.push(session);
  await db.upsert("authSessions", session);
  return session.id;
}

/** True only if this session id was individually revoked. A token issued
 *  before this feature shipped (no `sid` claim) or whose row is missing for
 *  any other reason (e.g. restored from a pre-feature backup) is treated as
 *  NOT revoked — this is an additive security layer, and failing closed here
 *  would mass-log-out the platform on every embedded-database recovery,
 *  which is a real, observed event in this app's history. */
export function isSessionRevoked(sid: string | undefined): boolean {
  if (!sid) return false;
  const session = db.data!.authSessions.find((s) => s.id === sid);
  if (!session) return false;
  return !!session.revokedAt;
}

/** Marks one specific session revoked — the "kill just this device" action
 *  from the Sessions list. Returns false if no matching, still-active session
 *  exists for this owner (caller should 404), so a session id can never be
 *  used to probe or revoke a session belonging to someone else. */
export async function revokeSession(ownerType: AuthSession["ownerType"], ownerId: string, sessionId: string): Promise<boolean> {
  const session = db.data!.authSessions.find((s) => s.id === sessionId && s.ownerType === ownerType && s.ownerId === ownerId);
  if (!session || session.revokedAt) return false;
  session.revokedAt = new Date().toISOString();
  await db.upsert("authSessions", session);
  return true;
}

/** Marks every active session for this owner revoked in one pass — called
 *  wherever tokenVersion is already bumped (logout, password change, a
 *  disabled account), so the Sessions list stays accurate instead of showing
 *  stale "active" rows for sessions that are actually already dead. */
export async function revokeAllSessions(ownerType: AuthSession["ownerType"], ownerId: string): Promise<void> {
  const active = db.data!.authSessions.filter((s) => s.ownerType === ownerType && s.ownerId === ownerId && !s.revokedAt);
  const now = new Date().toISOString();
  for (const s of active) {
    s.revokedAt = now;
    await db.upsert("authSessions", s);
  }
}

/** Real session list for the account's own self-service Sessions page —
 *  newest first, revoked sessions included (shown as ended, not hidden). */
export function listSessions(ownerType: AuthSession["ownerType"], ownerId: string): AuthSession[] {
  return db.data!.authSessions
    .filter((s) => s.ownerType === ownerType && s.ownerId === ownerId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Drop session rows nobody can use any more. A login token lives at most 7 days, so
 *  a row older than that (plus slack) is dead weight — but every login adds one, and
 *  they sit in the in-memory mirror and get scanned on every authenticated request.
 *  Unpruned, a busy school's memory and per-request cost grow without bound. */
export async function pruneAuthSessions(maxAgeDays = 14): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeDays * 86_400_000).toISOString();
  const dead = db.data!.authSessions.filter((s) => s.createdAt < cutoff).map((s) => s.id);
  if (dead.length === 0) return 0;
  const gone = new Set(dead);
  db.data!.authSessions = db.data!.authSessions.filter((s) => !gone.has(s.id));
  await db.removeMany("authSessions", dead);
  return dead.length;
}

const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;

/** Best-effort, throttled, fire-and-forget — keeps lastSeenAt roughly fresh
 *  for the session list UI without a DB write on every single authenticated
 *  request (same reasoning as this session's earlier login-storm fix: never
 *  add latency or write-amplification to the hot request path). */
export function touchSession(sid: string | undefined): void {
  if (!sid) return;
  const session = db.data!.authSessions.find((s) => s.id === sid);
  if (!session) return;
  if (Date.now() - new Date(session.lastSeenAt).getTime() < LAST_SEEN_THROTTLE_MS) return;
  session.lastSeenAt = new Date().toISOString();
  void db.upsert("authSessions", session).catch(() => { /* best-effort */ });
}
