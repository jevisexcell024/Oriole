import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import type { SafeUser, User } from "../shared/types.ts";
import { db } from "./db.ts";
import { env } from "./env.ts";
import { decryptString } from "./crypto.ts";
import { type PermissionKey, SYSTEM_ROLE_PERMISSIONS, parseSystemParentId } from "../shared/permissions.ts";

const JWT_SECRET = env.jwtSecret;
const COOKIE = "orcalis_session";
const TWO_FA_COOKIE = "orcalis_2fa";

export function toSafeUser(u: User): SafeUser {
  return {
    id: u.id, email: u.email, name: u.name, role: u.role, avatarUrl: u.avatarUrl ? (decryptString(u.avatarUrl) ?? undefined) : undefined,
    gender: u.gender, phone: u.phone ? (decryptString(u.phone) ?? undefined) : undefined, studentClass: u.studentClass, notificationPrefs: u.notificationPrefs,
    twoFactorEnabled: !!u.twoFactorEnabled,
    customRoleId: u.customRoleId ?? null,
    permissions: resolvePermissions(u),
    mustChangePassword: !!u.mustChangePassword,
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

/** Signed, self-expiring token embedded in a "set up your account" email link —
 *  proves the click is authorized without ever putting a real password in the
 *  email itself. 72h window: long enough to reach an inbox and get checked,
 *  short enough that a stale, unused invite link doesn't stay valid forever. */
export function passwordSetupToken(userId: string): string {
  return jwt.sign({ sub: userId, pwSetup: true }, JWT_SECRET, { expiresIn: "72h" });
}
export function verifyPasswordSetupToken(token: string): string | null {
  try {
    const p = jwt.verify(token, JWT_SECRET) as { sub: string; pwSetup?: boolean };
    return p.pwSetup ? p.sub : null;
  } catch {
    return null;
  }
}

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

// ── Fine-grained permissions (custom roles) ──
// Additive on top of requireRole()/requireRoles() above: those two keep gating
// every existing endpoint on the base `role` field, untouched. This layer only
// backs new endpoints that opt into requirePermission() (starting with role
// management itself). See shared/permissions.ts for the catalog and rationale.

function isStaffRole(role: User["role"]): role is "admin" | "facilitator" | "proctor" {
  return role === "admin" || role === "facilitator" || role === "proctor";
}

function isExpired(iso: string | null | undefined): boolean {
  return !!iso && new Date(iso).getTime() < Date.now();
}

/** Resolves a CustomRole's own + inherited permissions. `seen` guards against a
 *  parentRoleId cycle (which the create/update endpoints should already reject,
 *  but this keeps resolution safe even if bad data ever slips in). Exported so
 *  role-management endpoints can ceiling-check a role's grants against the
 *  acting user's own permissions before creating/assigning it (see index.ts). */
export function resolveCustomRolePermissions(roleId: string, seen: Set<string> = new Set()): PermissionKey[] {
  if (seen.has(roleId)) return [];
  seen.add(roleId);
  const sysParent = parseSystemParentId(roleId);
  if (sysParent) return SYSTEM_ROLE_PERMISSIONS[sysParent];
  const role = db.data!.customRoles.find((r) => r.id === roleId);
  if (!role) return [];
  const inherited = role.parentRoleId ? resolveCustomRolePermissions(role.parentRoleId, seen) : [];
  return Array.from(new Set([...inherited, ...role.permissions])) as PermissionKey[];
}

/** Every permission a user currently has: their base role's default bundle,
 *  plus (while not expired) whatever their assigned custom role grants. */
export function resolvePermissions(user: User): PermissionKey[] {
  const base = isStaffRole(user.role) ? SYSTEM_ROLE_PERMISSIONS[user.role] : [];
  if (user.customRoleId && !isExpired(user.roleExpiresAt)) {
    return Array.from(new Set([...base, ...resolveCustomRolePermissions(user.customRoleId)]));
  }
  return base;
}

export function hasPermission(user: User, key: PermissionKey): boolean {
  return resolvePermissions(user).includes(key);
}

/** Which of `grantedPerms` the actor does NOT themselves currently hold — empty
 *  means the grant is within the actor's own ceiling. Used everywhere a user
 *  with role-management permissions (roles.manage / roles.team_manage) tries
 *  to create, update, or assign a custom role: without this check, someone
 *  holding only those two keys could mint a role containing every permission
 *  in the system and assign it to their own account, a full privilege
 *  escalation to admin-equivalent access with no need to ever hold admin
 *  permissions directly. */
export function permissionOverreach(actor: User, grantedPerms: Iterable<PermissionKey>): PermissionKey[] {
  const actorPerms = new Set(resolvePermissions(actor));
  return [...new Set(grantedPerms)].filter((p) => !actorPerms.has(p));
}

export function requirePermission(key: PermissionKey) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = currentUser(req);
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    if (!hasPermission(user, key)) return res.status(403).json({ error: "Forbidden" });
    (req as Request & { user: User }).user = user;
    next();
  };
}
