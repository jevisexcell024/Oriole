import { describe, it, expect } from "vitest";
import { gradeOne, parseMultiValue, rubricTotal, lateSyncEligible, LATE_SYNC_GRACE_MS } from "../server/grading.ts";
import type { Question, Attempt } from "../shared/types.ts";

const q = (over: Partial<Question>): Question => ({
  id: "q", examId: "e", type: "mcq", prompt: "p", points: 10, correctAnswer: "", ...over,
});

describe("gradeOne", () => {
  it("mcq: exact (case-insensitive) match", () => {
    const Q = q({ type: "mcq", options: ["A", "B"], correctAnswer: "B" });
    expect(gradeOne(Q, "B")).toEqual({ awarded: 10, correct: true, needsReview: false });
    expect(gradeOne(Q, "b")).toMatchObject({ correct: true });
    expect(gradeOne(Q, "A")).toEqual({ awarded: 0, correct: false, needsReview: false });
    expect(gradeOne(Q, "")).toMatchObject({ correct: false, awarded: 0 });
  });

  it("true_false", () => {
    const Q = q({ type: "true_false", options: ["true", "false"], correctAnswer: "false" });
    expect(gradeOne(Q, "false")).toMatchObject({ correct: true, awarded: 10 });
    expect(gradeOne(Q, "true")).toMatchObject({ correct: false });
  });

  it("short: matches primary or accepted, else needs review", () => {
    const Q = q({ type: "short", correctAnswer: "const", acceptedAnswers: ["let"] });
    expect(gradeOne(Q, "CONST")).toMatchObject({ correct: true, awarded: 10 });
    expect(gradeOne(Q, " let ")).toMatchObject({ correct: true });
    expect(gradeOne(Q, "var")).toMatchObject({ needsReview: true, correct: null, awarded: 0 });
  });

  it("numeric: within tolerance", () => {
    const Q = q({ type: "numeric", correctAnswer: "3.14", tolerance: 0.01 });
    expect(gradeOne(Q, "3.15")).toMatchObject({ correct: true, awarded: 10 });
    expect(gradeOne(Q, "3.13")).toMatchObject({ correct: true });
    expect(gradeOne(Q, "3.2")).toMatchObject({ correct: false, awarded: 0 });
    expect(gradeOne(Q, "abc")).toMatchObject({ correct: false });
    expect(gradeOne(q({ type: "numeric", correctAnswer: "42" }), "42")).toMatchObject({ correct: true }); // tol 0
  });

  it("multi_select: exact set, order-independent, all-or-nothing", () => {
    const Q = q({ type: "multi_select", options: ["A", "B", "C", "D"], correctAnswers: ["A", "C"] });
    expect(gradeOne(Q, JSON.stringify(["C", "A"]))).toMatchObject({ correct: true, awarded: 10 });
    expect(gradeOne(Q, JSON.stringify(["A"]))).toMatchObject({ correct: false, awarded: 0 });        // missing one
    expect(gradeOne(Q, JSON.stringify(["A", "C", "D"]))).toMatchObject({ correct: false });           // extra one
    expect(gradeOne(Q, "")).toMatchObject({ correct: false });
  });

  it("essay / code always go to manual review", () => {
    expect(gradeOne(q({ type: "essay" }), "a long answer")).toMatchObject({ needsReview: true, correct: null, awarded: 0 });
    expect(gradeOne(q({ type: "code" }), "print(1)")).toMatchObject({ needsReview: true, awarded: 0 });
  });

  it("parseMultiValue handles JSON and comma fallback", () => {
    expect(parseMultiValue(JSON.stringify(["A", "B"]))).toEqual(["A", "B"]);
    expect(parseMultiValue("A, B")).toEqual(["A", "B"]);
    expect(parseMultiValue("")).toEqual([]);
  });

  it("file_upload always goes to manual review", () => {
    expect(gradeOne(q({ type: "file_upload" }), JSON.stringify({ name: "essay.pdf" }))).toMatchObject({ needsReview: true, correct: null, awarded: 0 });
  });

  it("matching: all pairs correct (case-insensitive), else wrong", () => {
    const Q = q({ type: "matching", points: 10, matchPairs: [{ left: "Dog", right: "Bark" }, { left: "Cat", right: "Meow" }] });
    expect(gradeOne(Q, JSON.stringify(["Bark", "Meow"]))).toMatchObject({ correct: true, awarded: 10 });
    expect(gradeOne(Q, JSON.stringify(["bark", "MEOW"]))).toMatchObject({ correct: true });
    expect(gradeOne(Q, JSON.stringify(["Meow", "Bark"]))).toMatchObject({ correct: false, awarded: 0 });
    expect(gradeOne(Q, "")).toMatchObject({ correct: false, awarded: 0 });
  });

  it("matching: partial credit scales by correct pairs", () => {
    const Q = q({ type: "matching", points: 10, matchPairs: [{ left: "A", right: "1" }, { left: "B", right: "2" }] });
    expect(gradeOne(Q, JSON.stringify(["1", "9"]), { partialCredit: true })).toMatchObject({ awarded: 5, correct: false });
  });

  it("ordering: exact sequence scores, partial credit by position", () => {
    const Q = q({ type: "ordering", points: 9, sequence: ["a", "b", "c"] });
    expect(gradeOne(Q, JSON.stringify(["a", "b", "c"]))).toMatchObject({ correct: true, awarded: 9 });
    expect(gradeOne(Q, JSON.stringify(["a", "c", "b"]))).toMatchObject({ correct: false, awarded: 0 });
    expect(gradeOne(Q, JSON.stringify(["a", "c", "b"]), { partialCredit: true })).toMatchObject({ awarded: 3 }); // 1/3 in place
  });

  it("cloze: proportional by blanks filled correctly", () => {
    const Q = q({ type: "cloze", points: 10, blanks: [["paris"], ["france", "fr"]] });
    expect(gradeOne(Q, JSON.stringify(["Paris", "France"]))).toMatchObject({ correct: true, awarded: 10 });
    expect(gradeOne(Q, JSON.stringify(["Paris", "fr"]))).toMatchObject({ correct: true });
    expect(gradeOne(Q, JSON.stringify(["Paris", "spain"]))).toMatchObject({ correct: false, awarded: 5 });
    expect(gradeOne(Q, JSON.stringify(["", ""]))).toMatchObject({ correct: false, awarded: 0 });
  });

  it("hotspot: a click inside any region scores", () => {
    const Q = q({ type: "hotspot", points: 10, hotspots: [{ x: 10, y: 10, w: 20, h: 20 }] });
    expect(gradeOne(Q, JSON.stringify({ x: 15, y: 15 }))).toMatchObject({ correct: true, awarded: 10 });
    expect(gradeOne(Q, JSON.stringify({ x: 30, y: 30 }))).toMatchObject({ correct: true }); // on the boundary
    expect(gradeOne(Q, JSON.stringify({ x: 50, y: 50 }))).toMatchObject({ correct: false, awarded: 0 });
    expect(gradeOne(Q, "")).toMatchObject({ correct: false });
  });
});

describe("gradeOne — marking scheme", () => {
  it("negative marking penalises a wrong, non-blank objective answer; blanks are safe", () => {
    const Q = q({ type: "mcq", options: ["A", "B"], correctAnswer: "A", points: 10 });
    expect(gradeOne(Q, "B", { negativeMarking: 0.5 })).toMatchObject({ awarded: -5, correct: false });
    expect(gradeOne(Q, "", { negativeMarking: 0.5 })).toMatchObject({ awarded: 0 });          // blank never penalised
    expect(gradeOne(Q, "A", { negativeMarking: 0.5 })).toMatchObject({ awarded: 10, correct: true });
  });
  it("negative marking applies to numeric too", () => {
    const Q = q({ type: "numeric", correctAnswer: "4", points: 8 });
    expect(gradeOne(Q, "9", { negativeMarking: 0.25 })).toMatchObject({ awarded: -2 });
  });
  it("does not penalise short answers (they go to review)", () => {
    const Q = q({ type: "short", correctAnswer: "x" });
    expect(gradeOne(Q, "wrong", { negativeMarking: 1 })).toMatchObject({ needsReview: true, awarded: 0 });
  });
  it("partial credit on multi-select scales by net-correct fraction", () => {
    const Q = q({ type: "multi_select", options: ["A", "B", "C", "D"], correctAnswers: ["A", "C"], points: 12 });
    expect(gradeOne(Q, JSON.stringify(["A"]), { partialCredit: true })).toMatchObject({ awarded: 6, correct: false });        // (1-0)/2
    expect(gradeOne(Q, JSON.stringify(["A", "B"]), { partialCredit: true })).toMatchObject({ awarded: 0 });                   // (1-1)/2 → 0
    expect(gradeOne(Q, JSON.stringify(["A", "C"]), { partialCredit: true })).toMatchObject({ awarded: 12, correct: true });
  });
  it("partial credit floors at 0 unless negative marking is on", () => {
    const Q = q({ type: "multi_select", options: ["A", "B", "C", "D"], correctAnswers: ["A", "C"], points: 12 });
    expect(gradeOne(Q, JSON.stringify(["B", "D"]), { partialCredit: true })).toMatchObject({ awarded: 0 });                   // floored
    expect(gradeOne(Q, JSON.stringify(["B", "D"]), { partialCredit: true, negativeMarking: 1 })).toMatchObject({ awarded: -12 }); // (0-2)/2 = -1
  });
});

describe("rubricTotal", () => {
  const rubric = [
    { id: "c1", label: "Correctness", maxPoints: 6 },
    { id: "c2", label: "Style", maxPoints: 4 },
  ];
  it("sums per-criterion scores", () => {
    expect(rubricTotal(rubric, { c1: 5, c2: 3 }, 10)).toBe(8);
  });
  it("clamps each criterion to its max", () => {
    expect(rubricTotal(rubric, { c1: 99, c2: 99 }, 10)).toBe(10); // 6 + 4
  });
  it("clamps the total to the cap", () => {
    expect(rubricTotal(rubric, { c1: 6, c2: 4 }, 8)).toBe(8);
  });
  it("treats missing/invalid criterion scores as 0", () => {
    expect(rubricTotal(rubric, { c1: 4 }, 10)).toBe(4);
    expect(rubricTotal(rubric, {}, 10)).toBe(0);
  });
  it("returns 0 with no rubric", () => {
    expect(rubricTotal(undefined, { c1: 5 }, 10)).toBe(0);
  });
});

describe("lateSyncEligible", () => {
  const T0 = Date.parse("2026-01-01T12:00:00.000Z"); // the exam's deadline
  const attempt = (over: Partial<Attempt> = {}): Attempt => ({
    id: "a", registrationId: "r", examId: "e", candidateId: "c",
    startedAt: "2026-01-01T11:00:00.000Z", submittedAt: new Date(T0).toISOString(),
    durationMinutes: 60, score: null, passed: null, status: "submitted",
    ...over,
  });

  it("accepts an answer saved locally before the deadline, synced shortly after auto-submit", () => {
    const a = attempt();
    const nowMs = T0 + 5 * 60_000; // 5 min after close
    const savedBeforeDeadline = T0 - 60_000; // written 1 min before time ran out
    expect(lateSyncEligible(a, T0, savedBeforeDeadline, nowMs)).toBe(true);
  });

  it("rejects an answer whose own timestamp is after the deadline — can't smuggle in a late answer", () => {
    const a = attempt();
    const nowMs = T0 + 5 * 60_000;
    const savedAfterDeadline = T0 + 60_000; // claims to be written 1 min after time ran out
    expect(lateSyncEligible(a, T0, savedAfterDeadline, nowMs)).toBe(false);
  });

  it("rejects once the grace window itself has elapsed", () => {
    const a = attempt();
    const nowMs = T0 + LATE_SYNC_GRACE_MS + 1000; // just past the window
    const savedBeforeDeadline = T0 - 60_000;
    expect(lateSyncEligible(a, T0, savedBeforeDeadline, nowMs)).toBe(false);
  });

  it("rejects a proctor/violation termination outright, regardless of timestamp", () => {
    const a = attempt({ terminated: true, terminationReason: "Auto-submitted: reached the integrity-violation limit." });
    const nowMs = T0 + 5 * 60_000;
    const savedBeforeDeadline = T0 - 60_000;
    expect(lateSyncEligible(a, T0, savedBeforeDeadline, nowMs)).toBe(false);
  });

  it("rejects a still-in-progress attempt (not the scenario this exists for)", () => {
    const a = attempt({ status: "in_progress", submittedAt: null });
    expect(lateSyncEligible(a, T0, T0 - 60_000, T0 + 60_000)).toBe(false);
  });

  it("rejects a missing or non-numeric clientSavedAt", () => {
    const a = attempt();
    const nowMs = T0 + 5 * 60_000;
    expect(lateSyncEligible(a, T0, undefined, nowMs)).toBe(false);
    expect(lateSyncEligible(a, T0, "not-a-number", nowMs)).toBe(false);
  });

  it("uses the earlier of the deadline and the candidate's own (early) submit time as the cutoff", () => {
    // Candidate submitted 10 minutes before the exam's own deadline — a
    // locally-saved answer timestamped between their submit and the full
    // deadline must NOT be accepted, since it couldn't have existed on their
    // device before they hit submit.
    const earlySubmit = T0 - 10 * 60_000;
    const a = attempt({ submittedAt: new Date(earlySubmit).toISOString() });
    const nowMs = earlySubmit + 5 * 60_000;
    const savedBetweenSubmitAndDeadline = earlySubmit + 2 * 60_000;
    expect(lateSyncEligible(a, T0, savedBetweenSubmitAndDeadline, nowMs)).toBe(false);
    const savedBeforeSubmit = earlySubmit - 60_000;
    expect(lateSyncEligible(a, T0, savedBeforeSubmit, nowMs)).toBe(true);
  });
});
