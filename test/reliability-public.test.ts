import { describe, it, expect } from "vitest";
import { toPublicIncident, subsystemLabel } from "../server/reliability.ts";
import type { ReliabilityIncident } from "../shared/types.ts";

// The public status page is unauthenticated — this proves toPublicIncident()
// can NEVER leak impact data (exam/student counts, integrity basis text) or
// internal message text, even when the source incident carries all of it.
function fullIncident(): ReliabilityIncident {
  return {
    id: "inc1", subsystem: "database", severity: "critical", status: "resolved",
    title: "Database outage", openedAt: "2026-06-01T10:00:00.000Z", resolvedAt: "2026-06-01T10:07:00.000Z",
    autoResolved: true,
    timeline: [
      { id: "e1", at: "2026-06-01T10:00:00.000Z", type: "opened", message: "Detected down status for Database." },
      { id: "e2", at: "2026-06-01T10:00:05.000Z", type: "identified", message: "5 exam(s), 1243 student(s) potentially affected. Auto-recovered: 61." },
      { id: "e3", at: "2026-06-01T10:07:00.000Z", type: "auto_resolved", message: "Database returned to operational status." },
    ],
    impact: {
      windowStart: "2026-06-01T10:00:00.000Z", windowEnd: "2026-06-01T10:07:00.000Z",
      affectedExamIds: ["exam1", "exam2"], attemptsOverlapping: 1243, attemptsInterrupted: 67,
      attemptsAutoRecovered: 61, attemptsRequiringManualRecovery: 6, attemptsLost: 0,
      studentsAffected: 67, examIntegrityVerdict: "maintained",
      examIntegrityBasis: "No database restore-from-backup event and no lost attempts were recorded during this window.",
    },
  };
}

describe("toPublicIncident", () => {
  it("never includes the impact field at all", () => {
    const pub = toPublicIncident(fullIncident());
    expect("impact" in pub).toBe(false);
  });

  it("never leaks exam/student counts or integrity text anywhere in the serialized output", () => {
    const pub = toPublicIncident(fullIncident());
    const json = JSON.stringify(pub);
    expect(json).not.toMatch(/exam1|exam2/);
    expect(json).not.toMatch(/1243/);
    expect(json).not.toMatch(/integrity/i);
    expect(json).not.toMatch(/restore-from-backup/i);
  });

  it("strips timeline message text, keeping only type and timestamp", () => {
    const pub = toPublicIncident(fullIncident());
    for (const event of pub.timeline) {
      expect(Object.keys(event).sort()).toEqual(["at", "type"]);
    }
    const json = JSON.stringify(pub.timeline);
    expect(json).not.toMatch(/student/i);
    expect(json).not.toMatch(/61/); // the auto-recovered count embedded in the internal message
  });

  it("exposes a human-readable subsystem label, not the raw internal key", () => {
    const pub = toPublicIncident(fullIncident());
    expect(pub.subsystem).toBe("Database");
    expect(pub.subsystem).not.toBe("database");
  });

  it("preserves the fields a public status page legitimately needs", () => {
    const pub = toPublicIncident(fullIncident());
    expect(pub.id).toBe("inc1");
    expect(pub.title).toBe("Database outage");
    expect(pub.severity).toBe("critical");
    expect(pub.status).toBe("resolved");
    expect(pub.openedAt).toBe("2026-06-01T10:00:00.000Z");
    expect(pub.resolvedAt).toBe("2026-06-01T10:07:00.000Z");
    expect(pub.timeline.length).toBe(3);
  });
});

describe("subsystemLabel", () => {
  it("returns a human-readable label for every subsystem key", () => {
    expect(subsystemLabel("examDelivery")).toBe("Exam Delivery");
    expect(subsystemLabel("api")).toBe("API");
  });
});
