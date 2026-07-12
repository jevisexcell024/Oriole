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
  // The password field's breach check calls the HIBP API (fails OPEN on any
  // network error, so these assertions hold whether or not the network call
  // actually succeeds in the test environment) — hence safeParseAsync here.
  it("accepts a valid staff invite", async () => {
    const r = await teamCreateSchema.safeParseAsync({ name: "Grace", email: "g@x.com", password: "Str0ng-Passphrase!", role: "facilitator" });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown role", async () => {
    const r = await teamCreateSchema.safeParseAsync({ name: "G", email: "g@x.com", password: "Str0ng-Passphrase!", role: "superuser" });
    expect(r.success).toBe(false);
  });

  it("rejects a short password", async () => {
    const r = await teamCreateSchema.safeParseAsync({ name: "G", email: "g@x.com", password: "123", role: "proctor" });
    expect(r.success).toBe(false);
  });

  it("rejects a long but too-simple password", async () => {
    const r = await teamCreateSchema.safeParseAsync({ name: "G", email: "g@x.com", password: "aaaaaaaaaaaaaa", role: "proctor" });
    expect(r.success).toBe(false);
  });

  it("rejects a known breached password even if it meets length/variety rules", async () => {
    // "correcthorsebatterystaple" is a famously breached password (xkcd 936), guaranteed in HIBP's corpus.
    const r = await teamCreateSchema.safeParseAsync({ name: "G", email: "g@x.com", password: "correcthorsebatterystaple", role: "proctor" });
    expect(r.success).toBe(false);
  });
});
