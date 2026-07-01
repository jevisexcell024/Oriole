import { describe, it, expect } from "vitest";
import { shuffle, chooseQuestionIds, deadlineMs } from "../server/exam-delivery.ts";

// Deterministic RNG for repeatable assertions.
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; };
}

const ids = ["a", "b", "c", "d", "e"];

describe("shuffle", () => {
  it("is a permutation (same multiset, no loss)", () => {
    const out = shuffle(ids, seeded(7));
    expect([...out].sort()).toEqual([...ids].sort());
  });
  it("does not mutate the input", () => {
    const copy = [...ids];
    shuffle(ids, seeded(1));
    expect(ids).toEqual(copy);
  });
});

describe("chooseQuestionIds", () => {
  it("serves all when no count, order preserved when not shuffling", () => {
    expect(chooseQuestionIds(ids, null, false, seeded(1))).toEqual(ids);
  });
  it("draws exactly `count` ids, all from the pool, no duplicates", () => {
    const out = chooseQuestionIds(ids, 3, true, seeded(42));
    expect(out).toHaveLength(3);
    expect(new Set(out).size).toBe(3);
    out.forEach((id) => expect(ids).toContain(id));
  });
  it("ignores count when it is >= pool size", () => {
    expect(chooseQuestionIds(ids, 99, false, seeded(1))).toEqual(ids);
  });
  it("different seeds generally yield different subsets", () => {
    const a = chooseQuestionIds(ids, 3, true, seeded(1));
    const b = chooseQuestionIds(ids, 3, true, seeded(999));
    expect(a).not.toEqual(b);
  });
});

describe("deadlineMs", () => {
  const start = "2026-06-12T10:00:00.000Z";
  it("uses start + duration when there is no window close", () => {
    expect(deadlineMs(start, 60, null)).toBe(new Date("2026-06-12T11:00:00.000Z").getTime());
  });
  it("clamps to the window close when it is earlier", () => {
    const close = "2026-06-12T10:30:00.000Z";
    expect(deadlineMs(start, 60, close)).toBe(new Date(close).getTime());
  });
  it("keeps the duration deadline when the window closes later", () => {
    const close = "2026-06-12T23:00:00.000Z";
    expect(deadlineMs(start, 60, close)).toBe(new Date("2026-06-12T11:00:00.000Z").getTime());
  });
});
