// Consecutive-day "study streak" tracking.
//
// A day counts as active when the student opens their portal (we ping this from
// the dashboard's summary call). The streak is the number of consecutive UTC
// days with activity, ending on the most recent active day. It's recomputed on
// each ping, so a missed day naturally resets it the next time they return.

/** UTC calendar day (YYYY-MM-DD) for a timestamp. */
export function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export interface StreakUpdate {
  streak: number;
  day: string;
  /** True when this ping moved to a new day (caller should persist). */
  changed: boolean;
}

/**
 * Given the last active day and current streak, compute the streak after an
 * activity ping at `nowMs`:
 *  - same day  → unchanged
 *  - yesterday → +1
 *  - otherwise → reset to 1
 */
export function nextStreak(lastDay: string | null | undefined, current: number | undefined, nowMs: number): StreakUpdate {
  const today = dayKey(nowMs);
  if (lastDay === today) return { streak: Math.max(1, current ?? 1), day: today, changed: false };
  const yesterday = dayKey(nowMs - 86_400_000);
  const streak = lastDay === yesterday ? (current ?? 0) + 1 : 1;
  return { streak, day: today, changed: true };
}

/**
 * The streak to SHOW now (read-only, no mutation): a stored streak is still
 * "alive" only if the last active day was today or yesterday. If the student
 * hasn't studied in more than a day, the streak has lapsed → show 0.
 */
export function displayStreak(lastDay: string | null | undefined, current: number | undefined, nowMs: number): number {
  if (!lastDay) return 0;
  const today = dayKey(nowMs);
  const yesterday = dayKey(nowMs - 86_400_000);
  return lastDay === today || lastDay === yesterday ? (current ?? 0) : 0;
}
