import type { Question, RubricCriterion, Attempt } from "../shared/types.ts";

/** Sum rubric scores, clamping each criterion to its max and the whole to `cap`. */
export function rubricTotal(rubric: RubricCriterion[] | undefined, scores: Record<string, number> | undefined, cap: number): number {
  if (!rubric?.length) return 0;
  const s = scores ?? {};
  let total = 0;
  for (const c of rubric) {
    const v = Number(s[c.id]);
    if (Number.isFinite(v)) total += Math.max(0, Math.min(c.maxPoints, v));
  }
  return Math.max(0, Math.min(cap, Math.round(total)));
}

export interface GradeOutcome {
  /** Points awarded for this answer. */
  awarded: number;
  /** true / false for objective grading; null when it awaits a human. */
  correct: boolean | null;
  /** Whether this answer must be graded manually (essay/code, or an unmatched short answer). */
  needsReview: boolean;
}

const norm = (s: string) => s.trim().toLowerCase();

/** Parse a multi_select answer value (stored as a JSON array, comma-fallback). */
export function parseMultiValue(value: string): string[] {
  const v = (value ?? "").trim();
  if (!v) return [];
  try {
    const arr = JSON.parse(v);
    if (Array.isArray(arr)) return arr.map(String);
  } catch { /* not JSON — fall back to comma list */ }
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Parse a JSON-array answer value (matching / ordering / cloze), preserving slots. */
function parseArray(value: string): string[] {
  const v = (value ?? "").trim();
  if (!v) return [];
  try {
    const arr = JSON.parse(v);
    if (Array.isArray(arr)) return arr.map((x) => (x == null ? "" : String(x)));
  } catch { /* not JSON */ }
  return [];
}

/** Parse a hotspot click value: JSON {x,y} in % (0..100). */
function parsePoint(value: string): { x: number; y: number } | null {
  try {
    const o = JSON.parse((value ?? "").trim());
    if (o && Number.isFinite(o.x) && Number.isFinite(o.y)) return { x: Number(o.x), y: Number(o.y) };
  } catch { /* not JSON */ }
  return null;
}

function sameSet(a: string[], b: string[]): boolean {
  const sa = new Set(a.map(norm));
  const sb = new Set(b.map(norm));
  if (sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}

export interface GradeOptions {
  /** Fraction (0..1) of points deducted for a wrong objective answer. */
  negativeMarking?: number;
  /** Proportional partial credit for multi-select. */
  partialCredit?: boolean;
}

/**
 * Grade a single answer against its question. Pure — no DB, no side effects.
 * Objective types are auto-graded; essay/code (and unmatched short answers) are
 * flagged for manual review and awarded 0 provisionally. With a marking scheme,
 * wrong objective answers can be penalised and multi-select can earn partial credit.
 */
export function gradeOne(q: Question, rawValue: string | undefined, opts: GradeOptions = {}): GradeOutcome {
  const value = rawValue ?? "";
  const neg = Math.max(0, Math.min(1, opts.negativeMarking ?? 0));
  const penalty = -Math.round(q.points * neg);
  // Penalise a wrong, non-blank objective answer; never penalise a blank.
  const wrong = (answered: boolean) => ({ awarded: answered && neg > 0 ? penalty : 0, correct: false, needsReview: false });

  switch (q.type) {
    case "essay":
    case "code":
    case "file_upload":
      return { awarded: 0, correct: null, needsReview: true };

    // Full reuse of every existing grading path (auto for objective formats,
    // needsReview for essay) — media_comprehension is just a stimulus wrapper.
    case "media_comprehension":
      return q.answerFormat
        ? gradeOne({ ...q, type: q.answerFormat }, rawValue, opts)
        : { awarded: 0, correct: null, needsReview: true };

    case "matching": {
      const pairs = q.matchPairs ?? [];
      if (pairs.length === 0) return { awarded: 0, correct: null, needsReview: false };
      const given = parseArray(value);
      const correctCount = pairs.filter((p, i) => norm(given[i] ?? "") !== "" && norm(given[i] ?? "") === norm(p.right)).length;
      if (opts.partialCredit) {
        const awarded = Math.round(q.points * (correctCount / pairs.length));
        return { awarded, correct: correctCount === pairs.length, needsReview: false };
      }
      const all = correctCount === pairs.length;
      return all ? { awarded: q.points, correct: true, needsReview: false } : wrong(given.some((g) => g.trim() !== ""));
    }

    case "ordering": {
      const seq = q.sequence ?? [];
      if (seq.length === 0) return { awarded: 0, correct: null, needsReview: false };
      const given = parseArray(value);
      const inPlace = seq.filter((item, i) => norm(given[i] ?? "") === norm(item)).length;
      if (opts.partialCredit) {
        const awarded = Math.round(q.points * (inPlace / seq.length));
        return { awarded, correct: inPlace === seq.length, needsReview: false };
      }
      const all = inPlace === seq.length;
      return all ? { awarded: q.points, correct: true, needsReview: false } : wrong(given.some((g) => g.trim() !== ""));
    }

    case "cloze": {
      const blanks = q.blanks ?? [];
      if (blanks.length === 0) return { awarded: 0, correct: null, needsReview: false };
      const given = parseArray(value);
      const correctCount = blanks.filter((accepted, i) => {
        const g = norm(given[i] ?? "");
        return g !== "" && accepted.map(norm).includes(g);
      }).length;
      // Cloze is graded proportionally by blanks filled correctly (each weighted equally).
      const awarded = Math.round(q.points * (correctCount / blanks.length));
      return { awarded, correct: correctCount === blanks.length, needsReview: false };
    }

    case "hotspot": {
      const regions = q.hotspots ?? [];
      const pt = parsePoint(value);
      if (regions.length === 0) return { awarded: 0, correct: null, needsReview: false };
      if (!pt) return wrong(false);
      const hit = regions.some((r) => pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h);
      return hit ? { awarded: q.points, correct: true, needsReview: false } : wrong(true);
    }

    case "short": {
      const accepted = [q.correctAnswer, ...(q.acceptedAnswers ?? [])].map(norm).filter(Boolean);
      const given = norm(value);
      if (given.length > 0 && accepted.includes(given)) return { awarded: q.points, correct: true, needsReview: false };
      // No match → human review (never auto-penalised).
      return { awarded: 0, correct: null, needsReview: true };
    }

    case "numeric": {
      const student = parseFloat(value);
      const target = parseFloat(q.correctAnswer);
      const tol = Number.isFinite(q.tolerance) ? Math.abs(q.tolerance as number) : 0;
      // Epsilon so an answer exactly on the tolerance boundary isn't rejected by binary FP.
      const ok = Number.isFinite(student) && Number.isFinite(target) && Math.abs(student - target) <= tol + 1e-9;
      return ok ? { awarded: q.points, correct: true, needsReview: false } : wrong(value.trim().length > 0);
    }

    case "parameterized": {
      // Graded like numeric, against the answer computed from this attempt's frozen
      // variable values (the caller injects it into q.correctAnswer before grading).
      const student = parseFloat(value);
      const target = parseFloat(q.correctAnswer);
      const tol = Number.isFinite(q.paramTolerance) ? Math.abs(q.paramTolerance as number) : 0;
      const ok = Number.isFinite(student) && Number.isFinite(target) && Math.abs(student - target) <= tol + 1e-9;
      return ok ? { awarded: q.points, correct: true, needsReview: false } : wrong(value.trim().length > 0);
    }

    case "multi_select": {
      const picked = parseMultiValue(value);
      const correctSet = q.correctAnswers ?? [];
      if (opts.partialCredit && correctSet.length > 0) {
        const correctPicks = picked.filter((p) => correctSet.map(norm).includes(norm(p))).length;
        const wrongPicks = picked.length - correctPicks;
        let frac = (correctPicks - wrongPicks) / correctSet.length;
        frac = neg > 0 ? Math.max(-1, Math.min(1, frac)) : Math.max(0, Math.min(1, frac));
        const awarded = Math.round(q.points * frac);
        return { awarded, correct: awarded >= q.points, needsReview: false };
      }
      const ok = picked.length > 0 && sameSet(picked, correctSet);
      return ok ? { awarded: q.points, correct: true, needsReview: false } : wrong(picked.length > 0);
    }

    case "mcq":
    case "true_false":
    default: {
      const ok = norm(value).length > 0 && norm(value) === norm(q.correctAnswer);
      return ok ? { awarded: q.points, correct: true, needsReview: false } : wrong(norm(value).length > 0);
    }
  }
}

/** How long after an attempt is auto-submitted for running out of time a
 *  late, locally-queued answer can still be accepted (see useAnswerSync.ts
 *  on the client and POST /api/attempts/:id/answer on the server). */
export const LATE_SYNC_GRACE_MS = 30 * 60_000;

/**
 * True if a late answer-save for an already-submitted attempt should be
 * accepted rather than rejected as "exam already closed." Pure — no DB, no
 * side effects — so this can't be gamed by anything the route itself does.
 *
 * Exists to close a real gap: a candidate's browser keeps unsynced answers
 * queued on their own device while offline (localStorage) and flushes them
 * the instant connectivity returns, which can be after autoSubmitOverdue()
 * has already closed the exam out for running out of time. Without this,
 * that answer — genuinely written before the deadline, just never
 * transmitted — is silently discarded even though it was sitting right there
 * on the candidate's device the whole time.
 *
 * Every condition here exists specifically so this can't become a way to
 * sneak in a late, post-deadline answer:
 *  - Only for an attempt closed purely by running out of time. An attempt a
 *    proctor or the violation-enforcement path force-submitted (`terminated`)
 *    never qualifies — ending an exam for misconduct must stay final.
 *  - Only within a short window after that submission — not "whenever the
 *    candidate's internet happens to come back," which could be hours later.
 *  - The actual proof: `clientSavedAt` (the moment this exact answer was
 *    written on the candidate's own device, per useAnswerSync.ts) must be at
 *    or before the earlier of the exam's deadline and this candidate's own
 *    submit time. A timestamp from after that cutoff — meaning it was typed
 *    once the exam was already known to be over — is rejected exactly like
 *    any other overdue answer.
 */
export function lateSyncEligible(attempt: Attempt, deadlineMs: number, clientSavedAt: unknown, nowMs: number = Date.now()): boolean {
  if (attempt.status !== "submitted" || attempt.terminated || !attempt.submittedAt) return false;
  const submittedAtMs = new Date(attempt.submittedAt).getTime();
  if (nowMs - submittedAtMs > LATE_SYNC_GRACE_MS) return false;
  const cutoff = Math.min(deadlineMs, submittedAtMs);
  const savedAt = Number(clientSavedAt);
  return Number.isFinite(savedAt) && savedAt <= cutoff;
}
