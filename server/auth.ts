import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import type { SafeUser, User } from "../shared/types.ts";
import { db } from "./db.ts";
import { env } from "./env.ts";
import { decryptString } from "./crypto.ts";

const JWT_SECRET = env.jwtSecret;
const COOKIE = "orcalis_session";
const TWO_FA_COOKIE = "orcalis_2fa";

export function toSafeUser(u: User): SafeUser {
  return {
    id: u.id, email: u.email, name: u.name, role: u.role, avatarUrl: u.avatarUrl ? (decryptString(u.avatarUrl) ?? undefined) : undefined,
    gender: u.gender, phone: u.phone ? (decryptString(u.phone) ?? undefined) : undefined, studentClass: u.studentClass, notificationPrefs: u.notificationPrefs,
    twoFactorEnabled: !!u.twoFactorEnabled,
  };
}

/** A short-lived (5 min) challenge cookie set after the password step when the
 *  account has 2FA on — the session is only issued once the code is verified. */
export function issuePending2fa(res: Response, userId: string) {
  const token = jwt.sign({ sub: userId, p2fa: true }, JWT_SECRET, { expiresIn: "5m" });
  res.cookie(TWO_FA_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: env.isProd, maxAge: 5 * 60 * 1000 });
}
export function pending2faUserId(req: Request): string | null {
  const token = req.cookies?.[TWO_FA_COOKIE];
  if (!token) return null;
  try {
    const p = jwt.verify(token, JWT_SECRET) as { sub: string; p2fa?: boolean };
    return p.p2fa ? p.sub : null;
  } catch {
    return null;
  }
}
export function clearPending2fa(res: Response) { res.clearCookie(TWO_FA_COOKIE); }

export function issueSession(res: Response, user: User) {
  const token = jwt.sign({ sub: user.id, role: user.role, tv: user.tokenVersion ?? 0 }, JWT_SECRET, { expiresIn: "7d" });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProd, // HTTPS-only cookie in production
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

export function clearSession(res: Response) {
  res.clearCookie(COOKIE);
}

export function currentUser(req: Request): User | null {
  const token = req.cookies?.[COOKIE];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string; tv?: number };
    const user = db.data!.users.find((u) => u.id === payload.sub);
    if (!user) return null;
    // Session revocation: the token is void once the user's tokenVersion has moved
    // past the value baked into it (logout / password change / admin reset).
    if ((payload.tv ?? 0) !== (user.tokenVersion ?? 0)) return null;
    return user;
  } catch {
    return null;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  (req as Request & { user: User }).user = user;
  next();
}

export function requireRole(role: User["role"]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = currentUser(req);
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    if (user.role !== role) return res.status(403).json({ error: "Forbidden" });
    (req as Request & { user: User }).user = user;
    next();
  };
}

/** Allow any of the given roles (e.g. requireRoles("admin", "facilitator")). */
export function requireRoles(...roles: User["role"][]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = currentUser(req);
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    if (!roles.includes(user.role)) return res.status(403).json({ error: "Forbidden" });
    (req as Request & { user: User }).user = user;
    next();
  };
}
