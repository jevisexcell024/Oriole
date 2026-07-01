import { describe, it, expect } from "vitest";
import { nextStreak, dayKey, displayStreak } from "../server/streak.ts";

const DAY = 86_400_000;
const t = (iso: string) => new Date(iso + "T12:00:00Z").getTime();

describe("nextStreak", () => {
  it("starts at 1 for a first-ever ping", () => {
    const r = nextStreak(null, undefined, t("2026-06-12"));
    expect(r).toMatchObject({ streak: 1, day: "2026-06-12", changed: true });
  });

  it("does not change within the same day", () => {
    const r = nextStreak("2026-06-12", 5, t("2026-06-12"));
    expect(r).toMatchObject({ streak: 5, changed: false });
  });

  it("increments when the last active day was yesterday", () => {
    const now = t("2026-06-12");
    const r = nextStreak(dayKey(now - DAY), 5, now);
    expect(r).toMatchObject({ streak: 6, day: "2026-06-12", changed: true });
  });

  it("resets to 1 after a gap of more than one day", () => {
    const now = t("2026-06-12");
    const r = nextStreak(dayKey(now - 3 * DAY), 9, now);
    expect(r).toMatchObject({ streak: 1, changed: true });
  });

  it("dayKey is a UTC YYYY-MM-DD string", () => {
    expect(dayKey(t("2026-01-02"))).toBe("2026-01-02");
  });
});

describe("displayStreak (read-only, lapses after a missed day)", () => {
  const now = t("2026-06-12");
  it("shows the streak when last active today", () => {
    expect(displayStreak("2026-06-12", 7, now)).toBe(7);
  });
  it("shows the streak when last active yesterday (still alive today)", () => {
    expect(displayStreak(dayKey(now - DAY), 7, now)).toBe(7);
  });
  it("shows 0 when more than a day has lapsed", () => {
    expect(displayStreak(dayKey(now - 2 * DAY), 7, now)).toBe(0);
  });
  it("shows 0 when never active", () => {
    expect(displayStreak(null, undefined, now)).toBe(0);
  });
});
