// Pure grade-scaling + letter-boundary helpers, shared by the API and the client.

export type GradeScaleMode = "none" | "add" | "multiply";
export interface GradeScale {
  mode: GradeScaleMode;
  /** Points to add (mode "add") or factor to multiply by (mode "multiply"). */
  value: number;
}
export interface GradeBand {
  label: string; // e.g. "A", "B+", "Pass"
  min: number;   // inclusive minimum percentage for this band
}

/** Apply a per-exam curve to a raw percentage, clamped to 0..100. */
export function applyCurve(raw: number, scale?: GradeScale | null): number {
  if (!scale || scale.mode === "none") return Math.max(0, Math.min(100, Math.round(raw)));
  let s = raw;
  if (scale.mode === "add") s = raw + (scale.value || 0);
  else if (scale.mode === "multiply") s = raw * (scale.value || 1);
  return Math.max(0, Math.min(100, Math.round(s)));
}

/** The letter grade for a score given the exam's boundaries (highest band whose min is met). */
export function letterFor(score: number, bands?: GradeBand[] | null): string | null {
  if (!bands?.length) return null;
  const sorted = [...bands].filter((b) => b && typeof b.label === "string").sort((a, b) => b.min - a.min);
  for (const b of sorted) if (score >= b.min) return b.label;
  return sorted[sorted.length - 1]?.label ?? null;
}

/** A sensible default 5-band scheme used as a starting point in the builder. */
export const DEFAULT_GRADE_BANDS: GradeBand[] = [
  { label: "A", min: 80 },
  { label: "B", min: 70 },
  { label: "C", min: 60 },
  { label: "D", min: 50 },
  { label: "F", min: 0 },
];

/** Normalise/validate a bands array coming off the wire. */
export function cleanBands(input: unknown): GradeBand[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((b): b is { label?: unknown; min?: unknown } => !!b && typeof b === "object")
    .map((b) => ({ label: String(b.label ?? "").slice(0, 8).trim(), min: Math.max(0, Math.min(100, Math.round(Number(b.min) || 0))) }))
    .filter((b) => b.label !== "");
}
