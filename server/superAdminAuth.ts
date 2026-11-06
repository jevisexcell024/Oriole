import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import type { SafeSuperAdmin, SuperAdmin } from "../shared/types.ts";
import { db } from "./db.ts";
import { env } from "./env.ts";
import { recordSession, isSessionRevoked, touchSession } from "./sessions.ts";

// Mirrors server/auth.ts's shape exactly — same jsonwebtoken sign/verify
// pattern, same cookie-option shape, same tokenVersion revocation model — but
// with its OWN cookie name and its OWN signing secret (env.superAdminJwtSecret,
// never env.jwtSecret). No function here reads db.data!.users or the
// "orcalis_session" cookie, and nothing in server/auth.ts reads superAdmins or
// this cookie — the two identities cannot cross-authenticate under any
// circumstance, including a leaked token or a code-level mistake elsewhere.
const JWT_SECRET = env.superAdminJwtSecret;
const COOKIE = "orcalis_superadmin_session";
const TWO_FA_COOKIE = "orcalis_superadmin_2fa";

export function toSafeSuperAdmin(s: SuperAdmin): SafeSuperAdmin {
  return { id: s.id, email: s.email, name: s.name, mustChangePassword: !!s.mustChangePassword, role: s.role ?? "owner", twoFactorEnabled: !!s.twoFactorEnabled };
}

export async function issueSuperAdminSession(req: Request, res: Response, superAdmin: SuperAdmin) {
  const sid = await recordSession(req, "superAdmin", superAdmin.id);
  const token = jwt.sign({ sub: superAdmin.id, tv: superAdmin.tokenVersion ?? 0, sid }, JWT_SECRET, { expiresIn: "7d" });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProd,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

export function clearSuperAdminSession(res: Response) {
  res.clearCookie(COOKIE);
}

/** Same purpose as auth.ts's currentSessionId — identifies "this device"'s
 *  own row in the Sessions list. */
export function currentSuperAdminSessionId(req: Request): string | null {
  const token = req.cookies?.[COOKIE];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sid?: string };
    return payload.sid ?? null;
  } catch {
    return null;
  }
}

/** Same short-lived (5 min) challenge-cookie pattern as server/auth.ts's
 *  issuePending2fa — deliberately a separate function using this module's own
 *  secret and cookie name, never the tenant one, so the two identities still
 *  can't cross-authenticate even mid-2FA-challenge. */
export function issuePendingSuperAdmin2fa(res: Response, superAdminId: string) {
  const token = jwt.sign({ sub: superAdminId, p2fa: true }, JWT_SECRET, { expiresIn: "5m" });
  res.cookie(TWO_FA_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: env.isProd, maxAge: 5 * 60 * 1000 });
}
export function pendingSuperAdmin2faId(req: Request): string | null {
  const token = req.cookies?.[TWO_FA_COOKIE];
  if (!token) return null;
  try {
    const p = jwt.verify(token, JWT_SECRET) as { sub: string; p2fa?: boolean };
    return p.p2fa ? p.sub : null;
  } catch {
    return null;
  }
}
export function clearPendingSuperAdmin2fa(res: Response) { res.clearCookie(TWO_FA_COOKIE); }

export function currentSuperAdmin(req: Request): SuperAdmin | null {
  const token = req.cookies?.[COOKIE];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string; tv?: number; sid?: string };
    const superAdmin = db.data!.superAdmins.find((s) => s.id === payload.sub);
    if (!superAdmin) return null;
    // Session revocation: void once tokenVersion has moved past the value
    // baked into the token (logout / password change / a future admin reset).
    if ((payload.tv ?? 0) !== (superAdmin.tokenVersion ?? 0)) return null;
    // Finer-grained than tokenVersion — this one specific device was revoked
    // from the Sessions list, without signing every other device out too.
    if (isSessionRevoked(payload.sid)) return null;
    // Defense in depth: a disabled account's tokenVersion is bumped at the
    // moment it's disabled (see PATCH /api/super-admin/team/:id), which already
    // invalidates every outstanding token — this is a second check in case that
    // ever isn't true (e.g. disabled and re-enabled and disabled again quickly).
    if (superAdmin.disabled) return null;
    touchSession(payload.sid);
    return superAdmin;
  } catch {
    return null;
  }
}

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  const superAdmin = currentSuperAdmin(req);
  if (!superAdmin) return res.status(401).json({ error: "Not authenticated" });
  (req as Request & { superAdmin: SuperAdmin }).superAdmin = superAdmin;
  next();
}

/** Stricter gate for the handful of "owner"-only actions — see SuperAdmin's
 *  own doc comment on `role` for exactly which routes use this instead of
 *  requireSuperAdmin. Always used ON TOP OF requireSuperAdmin, never alone
 *  (it doesn't itself check authentication). */
export function requireSuperAdminOwner(req: Request, res: Response, next: NextFunction) {
  const superAdmin = currentSuperAdmin(req);
  if (!superAdmin) return res.status(401).json({ error: "Not authenticated" });
  if ((superAdmin.role ?? "owner") !== "owner") {
    return res.status(403).json({ error: "Only an Owner-tier Super Admin can do this." });
  }
  (req as Request & { superAdmin: SuperAdmin }).superAdmin = superAdmin;
  next();
}
