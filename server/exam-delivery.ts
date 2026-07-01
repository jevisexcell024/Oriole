// Per-attempt question delivery: randomized order, option shuffling, and
// drawing a random subset from a larger pool. Pure + RNG-injected so it's
// deterministic under test. The chosen set is frozen onto the attempt at start
// time, so resuming returns the exact same questions in the same order.

export type Rng = () => number;

/** Fisher–Yates shuffle into a new array. */
export function shuffle<T>(arr: readonly T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Decide which question ids an attempt is served, in order.
 * - optionally shuffles the order,
 * - optionally draws the first `count` (a random subset, since order is shuffled).
 */
export function chooseQuestionIds(
  allIds: readonly string[],
  count: number | null | undefined,
  shuffleQuestions: boolean,
  rng: Rng,
): string[] {
  let ids = shuffleQuestions ? shuffle(allIds, rng) : [...allIds];
  if (count && count > 0 && count < ids.length) ids = ids.slice(0, count);
  return ids;
}

/**
 * The hard deadline for an in-progress attempt: the earlier of
 * (start + duration) and the exam's availability close. Returns epoch ms.
 */
export function deadlineMs(startIso: string, durationMinutes: number, availableUntilIso: string | null | undefined): number {
  const byDuration = new Date(startIso).getTime() + durationMinutes * 60_000;
  if (!availableUntilIso) return byDuration;
  const byWindow = new Date(availableUntilIso).getTime();
  return Math.min(byDuration, byWindow);
}
