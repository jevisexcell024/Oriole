import { describe, it, expect } from "vitest";
import { can, isStaff, landingFor } from "@/lib/roles";

describe("RBAC capability map", () => {
  it("grants admin every capability", () => {
    for (const cap of ["dashboard", "exams", "monitor", "system", "results", "students", "grading", "communication", "org"] as const) {
      expect(can("admin", cap)).toBe(true);
    }
  });

  it("limits facilitators to grading/results/monitor/comms, not exam or org control", () => {
    expect(can("facilitator", "grading")).toBe(true);
    expect(can("facilitator", "results")).toBe(true);
    expect(can("facilitator", "monitor")).toBe(true);
    expect(can("facilitator", "exams")).toBe(false);
    expect(can("facilitator", "org")).toBe(false);
    expect(can("facilitator", "students")).toBe(false);
    expect(can("facilitator", "system")).toBe(false);
  });

  it("limits proctors to dashboard + monitor only", () => {
    expect(can("proctor", "dashboard")).toBe(true);
    expect(can("proctor", "monitor")).toBe(true);
    expect(can("proctor", "grading")).toBe(false);
    expect(can("proctor", "results")).toBe(false);
    expect(can("proctor", "org")).toBe(false);
  });

  it("grants candidates no admin capabilities", () => {
    expect(can("candidate", "dashboard")).toBe(false);
    expect(can("candidate", "results")).toBe(false);
  });

  it("classifies staff vs candidates", () => {
    expect(isStaff("admin")).toBe(true);
    expect(isStaff("facilitator")).toBe(true);
    expect(isStaff("proctor")).toBe(true);
    expect(isStaff("candidate")).toBe(false);
    expect(isStaff(undefined)).toBe(false);
  });

  it("routes users to the right landing page", () => {
    expect(landingFor("admin")).toBe("/admin/dashboard");
    expect(landingFor("proctor")).toBe("/admin/dashboard");
    expect(landingFor("candidate")).toBe("/dashboard");
  });
});
