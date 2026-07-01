import { useState } from "react";
import { TrendingUp, TrendingDown, Minus, Sparkles, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import type { StudentTrend as Trend, SubjectTrend } from "@shared/types";

// Distinct colours that read on both light and dark surfaces.
const SUBJECT_COLORS = ["#c6ff34", "#0EA5E9", "#16A34A", "#7C3AED", "#E9B949", "#E11D48", "#06B6D4", "#64748B"];

interface Theme { fg: string; muted: string; card: string; grid: string }
const SCREEN: Theme = { fg: "var(--fg)", muted: "var(--muted)", card: "var(--card-2)", grid: "var(--border)" };
const PRINT: Theme = { fg: "#111110", muted: "#5A7280", card: "#F4F7F8", grid: "#E2E8EC" };

/** Least-squares line over evenly-spaced y values: value(i) = b0 + slope*i. */
function lsq(ys: number[]): { slope: number; b0: number } {
  const n = ys.length;
  if (n < 2) return { slope: 0, b0: ys[0] ?? 0 };
  const mx = (n - 1) / 2;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (i - mx) * (ys[i] - my); den += (i - mx) ** 2; }
  const slope = den === 0 ? 0 : num / den;
  return { slope, b0: my - slope * mx };
}

const TREND_LABEL: Record<SubjectTrend["trend"], string> = { improving: "Improving", declining: "Declining", steady: "Steady", single: "1 sitting" };
function toneOf(trend: string, theme: Theme) {
  return trend === "improving" || trend === "up" ? "#16A34A" : trend === "declining" || trend === "down" ? "#DC2626" : theme.muted;
}

export function StudentTrend({ trend, variant = "screen", studentId, aiEnabled }: { trend: Trend; variant?: "screen" | "print"; studentId?: string; aiEnabled?: boolean }) {
  const t = variant === "print" ? PRINT : SCREEN;
  const colorOf = new Map(trend.subjects.map((s, i) => [s.subject, SUBJECT_COLORS[i % SUBJECT_COLORS.length]]));
  const [narrative, setNarrative] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState<string | null>(null);

  const generateNarrative = async () => {
    if (!studentId) return;
    setAiBusy(true); setAiErr(null);
    try { const r = await api.post<{ narrative: string }>(`/admin/students/${studentId}/trend-narrative`); setNarrative(r.narrative); }
    catch (e) { setAiErr((e as Error).message); }
    finally { setAiBusy(false); }
  };

  if (trend.subjects.length === 0) {
    return <p className="text-sm" style={{ color: t.muted }}>No completed examinations yet — a subject trend will appear here once this student has sat exams.</p>;
  }

  return (
    <div className="space-y-3.5">
      {/* Summary */}
      <div className="rounded-lg p-3 text-sm leading-relaxed" style={{ background: t.card, color: t.fg }}>
        <span className="font-bold" style={{ color: toneOf(trend.overall.trend, t) }}>
          {trend.overall.trend === "up" ? "Improving" : trend.overall.trend === "down" ? "Declining" : "Steady"}
        </span>
        {"  -  "}
        <span style={{ color: t.muted }}>{trend.summary}</span>
      </div>

      {/* AI narrative (admin/screen only) */}
      {variant === "screen" && aiEnabled && studentId && (
        <div>
          {narrative ? (
            <div className="rounded-lg border border-brand-500/30 bg-brand-500/[0.06] p-3 text-sm leading-relaxed">
              <span className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-400"><Sparkles className="h-3.5 w-3.5" /> AI summary</span>
              {narrative}
              <button onClick={generateNarrative} disabled={aiBusy} className="ml-2 align-baseline text-xs text-brand-400 hover:underline disabled:opacity-50">regenerate</button>
            </div>
          ) : (
            <button onClick={generateNarrative} disabled={aiBusy} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--muted)] transition hover:border-brand-500/40 hover:text-brand-400 disabled:opacity-50">
              {aiBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Generate AI summary
            </button>
          )}
          {aiErr && <p className="mt-1 text-[11px] text-rose-400">{aiErr}</p>}
        </div>
      )}

      {/* Overall trend chart */}
      <OverallChart trend={trend} colorOf={colorOf} theme={t} />

      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]" style={{ color: t.muted }}>
        {trend.subjects.map((s) => (
          <span key={s.subject} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: colorOf.get(s.subject) }} /> {s.subject}
          </span>
        ))}
      </div>

      {/* Per-subject tiles */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {trend.subjects.map((s) => <SubjectTile key={s.subject} s={s} color={colorOf.get(s.subject) ?? "#64748B"} theme={t} />)}
      </div>
    </div>
  );
}

function OverallChart({ trend, colorOf, theme }: { trend: Trend; colorOf: Map<string, string>; theme: Theme }) {
  const W = 560, H = 180, padL = 26, padR = 10, padT = 12, padB = 20;
  const pts = trend.points;
  const n = pts.length;
  const x = (i: number) => padL + (n <= 1 ? (W - padL - padR) / 2 : (i / (n - 1)) * (W - padL - padR));
  const y = (v: number) => padT + (1 - Math.max(0, Math.min(100, v)) / 100) * (H - padT - padB);
  const { slope, b0 } = lsq(pts.map((p) => p.score));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 210 }} preserveAspectRatio="xMidYMid meet">
      {[0, 50, 100].map((g) => {
        const yy = y(g);
        return (<g key={g}>
          <line x1={padL} x2={W - padR} y1={yy} y2={yy} stroke={theme.grid} strokeWidth="0.6" />
          <text x={2} y={yy + 3} fontSize="8" fill={theme.muted}>{g}</text>
        </g>);
      })}
      {/* trajectory */}
      {n > 1 && <polyline points={pts.map((p, i) => `${x(i)},${y(p.score)}`).join(" ")} fill="none" stroke={theme.muted} strokeWidth="1" opacity="0.35" />}
      {/* regression direction */}
      {n > 1 && <line x1={x(0)} y1={y(b0)} x2={x(n - 1)} y2={y(b0 + slope * (n - 1))} stroke="#c6ff34" strokeWidth="1.3" strokeDasharray="4 3" opacity="0.75" />}
      {/* points coloured by subject */}
      {pts.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.score)} r="3.6" fill={colorOf.get(p.subject) ?? "#64748B"} stroke="#FFFFFF" strokeWidth="0.8">
          <title>{`${p.examTitle} (${p.subject}): ${p.score}%`}</title>
        </circle>
      ))}
    </svg>
  );
}

function SubjectTile({ s, color, theme }: { s: SubjectTrend; color: string; theme: Theme }) {
  const tone = toneOf(s.trend, theme);
  const Arrow = s.trend === "improving" ? TrendingUp : s.trend === "declining" ? TrendingDown : Minus;
  return (
    <div className="rounded-lg p-2.5" style={{ background: theme.card }}>
      <div className="flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
        <span className="truncate text-xs font-semibold" style={{ color: theme.fg }}>{s.subject}</span>
      </div>
      <div className="mt-1 flex items-end justify-between">
        <span className="text-xl font-extrabold tabular-nums" style={{ color: theme.fg }}>{s.avg}%</span>
        <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold" style={{ color: tone }}>
          <Arrow className="h-3.5 w-3.5" /> {TREND_LABEL[s.trend]}
        </span>
      </div>
      <Sparkline scores={s.scores} color={color} theme={theme} />
      <p className="mt-1 text-[10px]" style={{ color: theme.muted }}>{s.attempts} exam{s.attempts === 1 ? "" : "s"} · best {s.best}%</p>
    </div>
  );
}

function Sparkline({ scores, color, theme }: { scores: number[]; color: string; theme: Theme }) {
  const W = 120, H = 26;
  if (scores.length < 2) {
    const cy = H - (Math.max(0, Math.min(100, scores[0] ?? 0)) / 100) * H;
    return <svg viewBox={`0 0 ${W} ${H}`} className="mt-1.5 w-full" style={{ height: 26 }}><circle cx={W / 2} cy={cy} r="2.5" fill={color} /></svg>;
  }
  const x = (i: number) => (i / (scores.length - 1)) * W;
  const y = (v: number) => H - (Math.max(0, Math.min(100, v)) / 100) * H;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-1.5 w-full" style={{ height: 26 }} preserveAspectRatio="none">
      <line x1={0} x2={W} y1={y(50)} y2={y(50)} stroke={theme.grid} strokeWidth="0.5" />
      <polyline points={scores.map((v, i) => `${x(i)},${y(v)}`).join(" ")} fill="none" stroke={color} strokeWidth="1.6" />
    </svg>
  );
}
