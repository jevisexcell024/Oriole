import { describe, it, expect } from "vitest";
import { isMaintenanceExempt } from "../server/security.ts";

describe("isMaintenanceExempt (server/security.ts)", () => {
  it("always exempts Super Admin routes — otherwise turning maintenance off would be impossible", () => {
    expect(isMaintenanceExempt("/api/super-admin/auth/login")).toBe(true);
    expect(isMaintenanceExempt("/api/super-admin/maintenance")).toBe(true);
    expect(isMaintenanceExempt("/api/super-admin/dashboard")).toBe(true);
  });

  it("always exempts the public status page", () => {
    expect(isMaintenanceExempt("/api/status/summary")).toBe(true);
    expect(isMaintenanceExempt("/api/status/incidents")).toBe(true);
  });

  it("gates every other tenant-facing API route", () => {
    expect(isMaintenanceExempt("/api/auth/login")).toBe(false);
    expect(isMaintenanceExempt("/api/auth/me")).toBe(false);
    expect(isMaintenanceExempt("/api/admin/dashboard")).toBe(false);
    expect(isMaintenanceExempt("/api/exams")).toBe(false);
  });

  it("does not match on a bare path-segment prefix collision", () => {
    // "/api/super-adminx" and "/api/statusfoo" must NOT be treated as exempt —
    // a naive startsWith without a trailing-boundary check would wrongly pass
    // any route that merely begins with the same characters.
    expect(isMaintenanceExempt("/api/super-adminx/anything")).toBe(false);
    expect(isMaintenanceExempt("/api/statusfoo/anything")).toBe(false);
  });
});
