import { describe, it, expect } from "vitest";
import { loginSchema, teamCreateSchema } from "../server/schemas.ts";

describe("loginSchema", () => {
  it("accepts a valid credential pair and trims the email", () => {
    const r = loginSchema.safeParse({ email: "  Admin@Orcalis.dev ", password: "password123" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.email).toBe("Admin@Orcalis.dev");
  });

  it("rejects a malformed email", () => {
    expect(loginSchema.safeParse({ email: "nope", password: "x" }).success).toBe(false);
  });

  it("rejects a missing password", () => {
    expect(loginSchema.safeParse({ email: "a@b.com" }).success).toBe(false);
  });
});

describe("teamCreateSchema", () => {
  it("accepts a valid staff invite", () => {
    expect(teamCreateSchema.safeParse({ name: "Grace", email: "g@x.com", password: "Str0ng-Passphrase!", role: "facilitator" }).success).toBe(true);
  });

  it("rejects an unknown role", () => {
    expect(teamCreateSchema.safeParse({ name: "G", email: "g@x.com", password: "Str0ng-Passphrase!", role: "superuser" }).success).toBe(false);
  });

  it("rejects a short password", () => {
    expect(teamCreateSchema.safeParse({ name: "G", email: "g@x.com", password: "123", role: "proctor" }).success).toBe(false);
  });

  it("rejects a long but too-simple password", () => {
    expect(teamCreateSchema.safeParse({ name: "G", email: "g@x.com", password: "aaaaaaaaaaaaaa", role: "proctor" }).success).toBe(false);
  });
});
