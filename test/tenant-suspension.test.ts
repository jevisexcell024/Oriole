import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Request, Response } from "express";
import type { Tenant, User } from "../shared/types.ts";

// Same in-memory PGlite + mock-Response pattern as super-admin-auth.test.ts —
// currentUser() reads db.data.tenants/users directly, so a real (if empty)
// store is needed, and a session is issued/read via real cookie values rather
// than a mocked JWT.
process.env.PGLITE_DIR = "memory://";
delete process.env.DATABASE_URL;

let db: typeof import("../server/db.ts")["db"];
let issueSession: typeof import("../server/auth.ts")["issueSession"];
let currentUser: typeof import("../server/auth.ts")["currentUser"];

beforeAll(async () => {
  const dbMod = await import("../server/db.ts");
  db = dbMod.db;
  await dbMod.initDb();
  const authMod = await import("../server/auth.ts");
  issueSession = authMod.issueSession;
  currentUser = authMod.currentUser;
}, 30000);

afterAll(async () => { await db.close(); });

function mockRes() {
  const cookies: Record<string, string> = {};
  const res = { cookie: (name: string, value: string) => { cookies[name] = value; } } as unknown as Response;
  return { res, cookies };
}
function mockReq(cookies: Record<string, string>): Request {
  return { cookies } as unknown as Request;
}

describe("Tenant suspension — real enforcement via currentUser() (server/auth.ts)", () => {
  it("a session for an active tenant resolves normally", () => {
    const tenant: Tenant = { id: "t_active_" + Math.random().toString(36).slice(2), name: "Active School", status: "active", createdAt: new Date().toISOString() };
    db.data!.tenants.push(tenant);
    const user: User = { id: "u_" + Math.random().toString(36).slice(2), tenantId: tenant.id, email: "admin@active.test", passwordHash: "x", name: "Admin", role: "admin" };
    db.data!.users.push(user);

    const { res, cookies } = mockRes();
    issueSession(res, user);
    expect(currentUser(mockReq(cookies))?.id).toBe(user.id);
  });

  it("suspending a tenant immediately invalidates every session already issued for it", () => {
    const tenant: Tenant = { id: "t_susp_" + Math.random().toString(36).slice(2), name: "Suspend Me School", status: "active", createdAt: new Date().toISOString() };
    db.data!.tenants.push(tenant);
    const user: User = { id: "u_" + Math.random().toString(36).slice(2), tenantId: tenant.id, email: "admin@suspendme.test", passwordHash: "x", name: "Admin", role: "admin" };
    db.data!.users.push(user);

    const { res, cookies } = mockRes();
    issueSession(res, user);
    // Session is valid before suspension...
    expect(currentUser(mockReq(cookies))?.id).toBe(user.id);

    // ...and immediately void afterward, without needing a fresh login or a
    // tokenVersion bump — the exact same cookie now resolves to nothing.
    tenant.status = "suspended";
    expect(currentUser(mockReq(cookies))).toBeNull();

    // Reactivating restores access with the very same, still-unexpired cookie.
    tenant.status = "active";
    expect(currentUser(mockReq(cookies))?.id).toBe(user.id);
  });

  it("a user with no tenantId (not yet possible in practice, but defensively) is unaffected by any tenant's suspension", () => {
    const tenant: Tenant = { id: "t_other_" + Math.random().toString(36).slice(2), name: "Some Other School", status: "suspended", createdAt: new Date().toISOString() };
    db.data!.tenants.push(tenant);
    const user: User = { id: "u_" + Math.random().toString(36).slice(2), email: "noTenant@test.test", passwordHash: "x", name: "No Tenant", role: "admin" };
    db.data!.users.push(user);

    const { res, cookies } = mockRes();
    issueSession(res, user);
    expect(currentUser(mockReq(cookies))?.id).toBe(user.id);
  });
});
