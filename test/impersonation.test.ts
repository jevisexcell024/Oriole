import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Request, Response } from "express";
import type { User } from "../shared/types.ts";

// Same in-memory PGlite pattern as super-admin-auth.test.ts — currentUser()
// reads db.data.users directly, so a real (if empty) store is needed.
process.env.PGLITE_DIR = "memory://";
delete process.env.DATABASE_URL;

let db: typeof import("../server/db.ts")["db"];
let issueSession: typeof import("../server/auth.ts")["issueSession"];
let currentUser: typeof import("../server/auth.ts")["currentUser"];
let currentImpersonatorId: typeof import("../server/auth.ts")["currentImpersonatorId"];

beforeAll(async () => {
  const dbMod = await import("../server/db.ts");
  db = dbMod.db;
  await dbMod.initDb();
  const authMod = await import("../server/auth.ts");
  issueSession = authMod.issueSession;
  currentUser = authMod.currentUser;
  currentImpersonatorId = authMod.currentImpersonatorId;
}, 30000);

afterAll(async () => { await db.close(); });

function user(extra: Partial<User> = {}): User {
  return {
    id: "u_" + Math.random().toString(36).slice(2), tenantId: "tenant_" + Math.random().toString(36).slice(2),
    email: "admin@school.test", name: "School Admin", passwordHash: "x", role: "admin", ...extra,
  } as User;
}

/** Same mock Response/Request shape as super-admin-auth.test.ts. */
function mockRes() {
  const cookies: Record<string, string> = {};
  const res = { cookie: (name: string, value: string) => { cookies[name] = value; }, clearCookie: () => {} } as unknown as Response;
  return { res, cookies };
}
function mockReq(cookies: Record<string, string>): Request {
  return { cookies } as unknown as Request;
}

describe("Impersonation session tagging (server/auth.ts)", () => {
  it("an ordinary session (no impersonatorId) reports no impersonator", () => {
    const u = user();
    db.data!.users.push(u);
    const { res, cookies } = mockRes();
    issueSession(res, u);
    expect(currentUser(mockReq(cookies))?.id).toBe(u.id);
    expect(currentImpersonatorId(mockReq(cookies))).toBeNull();
  });

  it("a session issued with an impersonatorId still resolves to the real target user", () => {
    const u = user();
    db.data!.users.push(u);
    const superAdminId = "sa_" + Math.random().toString(36).slice(2);
    const { res, cookies } = mockRes();
    issueSession(res, u, superAdminId);
    // The session is a fully real, working session for the impersonated
    // admin — impersonation doesn't change who currentUser() resolves to,
    // only adds a breadcrumb of who's actually driving it.
    expect(currentUser(mockReq(cookies))?.id).toBe(u.id);
    expect(currentImpersonatorId(mockReq(cookies))).toBe(superAdminId);
  });

  it("returns null for a missing cookie, and null (not a throw) for a garbage one", () => {
    expect(currentImpersonatorId(mockReq({}))).toBeNull();
    expect(currentImpersonatorId(mockReq({ orcalis_session: "not-a-real-jwt" }))).toBeNull();
  });
});
