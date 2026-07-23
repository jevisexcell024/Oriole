import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Request, Response } from "express";
import type { SuperAdmin } from "../shared/types.ts";

// Same in-memory PGlite pattern as permissions.test.ts — currentSuperAdmin()
// reads db.data.superAdmins directly, so a real (if empty) store is needed.
process.env.PGLITE_DIR = "memory://";
delete process.env.DATABASE_URL;
// Bootstrap is intentionally not exercised here (SUPER_ADMIN_EMAIL stays
// unset) — these tests construct SuperAdmin records directly instead.

let db: typeof import("../server/db.ts")["db"];
let issueSuperAdminSession: typeof import("../server/superAdminAuth.ts")["issueSuperAdminSession"];
let currentSuperAdmin: typeof import("../server/superAdminAuth.ts")["currentSuperAdmin"];
let clearSuperAdminSession: typeof import("../server/superAdminAuth.ts")["clearSuperAdminSession"];

beforeAll(async () => {
  const dbMod = await import("../server/db.ts");
  db = dbMod.db;
  await dbMod.initDb();
  const authMod = await import("../server/superAdminAuth.ts");
  issueSuperAdminSession = authMod.issueSuperAdminSession;
  currentSuperAdmin = authMod.currentSuperAdmin;
  clearSuperAdminSession = authMod.clearSuperAdminSession;
}, 30000);

afterAll(async () => { await db.close(); });

function superAdmin(extra: Partial<SuperAdmin> = {}): SuperAdmin {
  return { id: "sa_" + Math.random().toString(36).slice(2), email: "op@platform.test", passwordHash: "x", name: "Op", createdAt: new Date().toISOString(), ...extra };
}

/** Minimal mock of the one Response surface issueSuperAdminSession/
 *  clearSuperAdminSession touch — captures the cookie a real Express response
 *  would have set, so it can be fed straight into a mock Request below. */
function mockRes() {
  const cookies: Record<string, string> = {};
  let cleared = false;
  const res = {
    cookie: (name: string, value: string) => { cookies[name] = value; },
    clearCookie: (name: string) => { delete cookies[name]; cleared = true; },
  } as unknown as Response;
  return { res, cookies, wasCleared: () => cleared };
}
function mockReq(cookies: Record<string, string>): Request {
  return { cookies } as unknown as Request;
}

describe("Super Admin session (server/superAdminAuth.ts)", () => {
  it("round-trips: issuing a session, then reading it back, resolves to the same account", async () => {
    const sa = superAdmin();
    db.data!.superAdmins.push(sa);
    const { res, cookies } = mockRes();
    issueSuperAdminSession(res, sa);
    const resolved = currentSuperAdmin(mockReq(cookies));
    expect(resolved?.id).toBe(sa.id);
  });

  it("returns null with no cookie at all", () => {
    expect(currentSuperAdmin(mockReq({}))).toBeNull();
  });

  it("returns null for a garbage cookie value", () => {
    expect(currentSuperAdmin(mockReq({ orcalis_superadmin_session: "not-a-real-token" }))).toBeNull();
  });

  it("revokes the session once tokenVersion is bumped (logout-equivalent)", async () => {
    const sa = superAdmin();
    db.data!.superAdmins.push(sa);
    const { res, cookies } = mockRes();
    issueSuperAdminSession(res, sa);
    expect(currentSuperAdmin(mockReq(cookies))?.id).toBe(sa.id);
    // Bump tokenVersion the same way the logout/complete-password-setup routes do.
    sa.tokenVersion = (sa.tokenVersion ?? 0) + 1;
    expect(currentSuperAdmin(mockReq(cookies))).toBeNull();
  });

  it("clearSuperAdminSession actually removes the cookie", async () => {
    const sa = superAdmin();
    db.data!.superAdmins.push(sa);
    const { res, cookies, wasCleared } = mockRes();
    issueSuperAdminSession(res, sa);
    clearSuperAdminSession(res);
    expect(wasCleared()).toBe(true);
    expect(currentSuperAdmin(mockReq(cookies))).toBeNull();
  });

  it("rejects a session for an account disabled after the token was issued", async () => {
    // Defense-in-depth check added alongside the team-management "disable"
    // route (which also bumps tokenVersion) — this pins the second, independent
    // guard so a disabled account can never authenticate even if tokenVersion
    // somehow wasn't bumped.
    const sa = superAdmin();
    db.data!.superAdmins.push(sa);
    const { res, cookies } = mockRes();
    issueSuperAdminSession(res, sa);
    expect(currentSuperAdmin(mockReq(cookies))?.id).toBe(sa.id);
    sa.disabled = true;
    expect(currentSuperAdmin(mockReq(cookies))).toBeNull();
  });

  it("does not authenticate against a tenant user id that happens to collide", () => {
    // Sanity check for the isolation claim: a superAdmins-store lookup miss
    // (e.g. an id that only exists in db.data.users) must not silently pass.
    const sa = superAdmin({ id: "collides_with_nothing" });
    const { res, cookies } = mockRes();
    issueSuperAdminSession(res, sa); // never pushed into db.data.superAdmins
    expect(currentSuperAdmin(mockReq(cookies))).toBeNull();
  });
});
