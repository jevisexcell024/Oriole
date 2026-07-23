import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import type { SafeSuperAdmin, SuperAdmin } from "../shared/types.ts";
import { db } from "./db.ts";
import { env } from "./env.ts";

// Mirrors server/auth.ts's shape exactly — same jsonwebtoken sign/verify
// pattern, same cookie-option shape, same tokenVersion revocation model — but
// with its OWN cookie name and its OWN signing secret (env.superAdminJwtSecret,
// never env.jwtSecret). No function here reads db.data!.users or the
// "orcalis_session" cookie, and nothing in server/auth.ts reads superAdmins or
// this cookie — the two identities cannot cross-authenticate under any
// circumstance, including a leaked token or a code-level mistake elsewhere.
const JWT_SECRET = env.superAdminJwtSecret;
const COOKIE = "orcalis_superadmin_session";

export function toSafeSuperAdmin(s: SuperAdmin): SafeSuperAdmin {
  return { id: s.id, email: s.email, name: s.name, mustChangePassword: !!s.mustChangePassword };
}

export function issueSuperAdminSession(res: Response, superAdmin: SuperAdmin) {
  const token = jwt.sign({ sub: superAdmin.id, tv: superAdmin.tokenVersion ?? 0 }, JWT_SECRET, { expiresIn: "7d" });
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

export function currentSuperAdmin(req: Request): SuperAdmin | null {
  const token = req.cookies?.[COOKIE];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string; tv?: number };
    const superAdmin = db.data!.superAdmins.find((s) => s.id === payload.sub);
    if (!superAdmin) return null;
    // Session revocation: void once tokenVersion has moved past the value
    // baked into the token (logout / password change / a future admin reset).
    if ((payload.tv ?? 0) !== (superAdmin.tokenVersion ?? 0)) return null;
    // Defense in depth: a disabled account's tokenVersion is bumped at the
    // moment it's disabled (see PATCH /api/super-admin/team/:id), which already
    // invalidates every outstanding token — this is a second check in case that
    // ever isn't true (e.g. disabled and re-enabled and disabled again quickly).
    if (superAdmin.disabled) return null;
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
