import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";
import {
  Loader2, Dumbbell, Play, FileText, Clock, Search, Target, CheckCircle2, TrendingUp, RotateCcw,
  Flame, History as HistoryIcon, ChevronRight, ListChecks, LineChart as LineChartIcon,
} from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, Tooltip } from "recharts";
import { Shell } from "@/components/Shell";
import { Skeleton, EmptyState, ErrorBanner } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { clsx } from "clsx";

interface Item {
  exam: { id: string; title: string; code: string; description: string; subject: string | null; durationMinutes: number; questionCount: number };
  registrationId: string;
  lastScore: number | null;
  inProgress: boolean;
  inProgressPct: number | null;
}
interface HistoryEntry {
  id: string; examTitle: string; score: number | null; passed: boolean | null; submittedAt: string; durationMinutes: number;
}

type StatusFilter = "all" | "completed" | "notStarted";

// Same accent set the Dashboard uses (src/pages/Dashboard.tsx) — kept consistent
// rather than inventing new colors for this page.
const LIME = "var(--color-brand-500)";
// Lime as text/icon colour: deeper olive in light mode (see --lime-text in index.css).
const LIME_TEXT = "var(--lime-text)";
const CYAN = "#22d3ee";
const PURPLE = "#c084fc";
const AMBER = "#f59e0b";
const SUBJECT_COLORS = [LIME, CYAN, PURPLE, AMBER];

function tint(hex: string) { return `color-mix(in oklch, ${hex} 16%, transparent)`; }

function StatCard({ icon: Icon, label, value, sub, color }: { icon: typeof Dumbbell; label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div className="card flex items-center gap-3 transition hover:-translate-y-0.5 hover:shadow-[0_12px_36px_rgba(15,23,42,0.08)]" style={{ borderRadius: 18, padding: "22px 18px" }}>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ background: tint(color) }}>
        <Icon className="h-5 w-5" style={{ color }} />
      </span>
      <div className="min-w-0">
        <p className="text-xl font-bold leading-tight text-[var(--fg)]">{value}</p>
        <p className="text-xs text-[var(--muted)]">{label}</p>
        {sub && <p className="mt-0.5 truncate text-[10px] text-[var(--muted)]">{sub}</p>}
      </div>
    </div>
  );
}

// 180×180 outer ring, 140×140 inner circle — the ring band is the 20px gap
// between them (r=70, strokeWidth=20), per the spec's exact hero-ring sizing.
function ScoreRing({ pct }: { pct: number | null }) {
  const r = 70, c = 2 * Math.PI * r;
  const dash = pct !== null ? (pct / 100) * c : 0;
  return (
    <svg width="180" height="180" viewBox="0 0 180 180" className="shrink-0">
      <circle cx="90" cy="90" r={r} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="20" />
      {pct !== null && (
        <circle cx="90" cy="90" r={r} fill="none" stroke={LIME} strokeWidth="20" strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`} transform="rotate(-90 90 90)" />
      )}
      <circle cx="90" cy="90" r="70" fill="rgba(255,255,255,0.04)" />
      <text x="90" y="84" textAnchor="middle" fill="#fff" fontSize="30" fontWeight="700">{pct !== null ? `${pct}%` : "—"}</text>
      <text x="90" y="106" textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="11">{pct !== null ? "avg score" : "no scores yet"}</text>
    </svg>
  );
}

function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  const m = s / 60; if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60; if (h < 24) return `${Math.floor(h)}h ago`;
  const d = h / 24; return `${Math.floor(d)}d ago`;
}

export function PracticeTests() {
  const t = useT();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [items, setItems] = useState<Item[] | null>(null);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [streak, setStreak] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [subject, setSubject] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>("all");

  useEffect(() => {
    api.get<{ items: Item[]; history: HistoryEntry[]; streak: number }>("/practice")
      .then((d) => { setItems(d.items); setHistory(d.history); setStreak(d.streak); })
      .catch((e) => setError(e.message));
  }, []);

  async function start(registrationId: string) {
    setStarting(registrationId); setError(null);
    try {
      const r = await api.post<{ attempt: { id: string } }>("/attempts", { registrationId });
      navigate(`/attempts/${r.attempt.id}/session`);
    } catch (e) { setError((e as Error).message); setStarting(null); }
  }

  // Real subjects only — whatever's actually tagged on this school's practice
  // exams, not a fixed example list (subjects vary by institution).
  const subjects = useMemo(() => {
    const set = new Set<string>();
    for (const it of items ?? []) if (it.exam.subject) set.add(it.exam.subject);
    return [...set].sort();
  }, [items]);

  const subjectColor = useMemo(() => {
    const map = new Map<string, string>();
    subjects.forEach((s, i) => map.set(s, SUBJECT_COLORS[i % SUBJECT_COLORS.length]));
    return map;
  }, [subjects]);

  // Real per-subject rollup for the "Course Categories" cards — count and
  // completion, computed from the same items the list below uses.
  const categories = useMemo(() => {
    return subjects.map((s) => {
      const rows = (items ?? []).filter((it) => it.exam.subject === s);
      const done = rows.filter((it) => it.lastScore !== null).length;
      return { subject: s, total: rows.length, done, pct: rows.length ? Math.round((done / rows.length) * 100) : 0, color: subjectColor.get(s)! };
    });
  }, [items, subjects, subjectColor]);

  const continueItem = useMemo(() => (items ?? []).find((it) => it.inProgress) ?? null, [items]);
  const nextNotStarted = useMemo(() => (items ?? []).find((it) => !it.inProgress && it.lastScore === null) ?? null, [items]);

  const completedCount = useMemo(() => (items ?? []).filter((it) => it.lastScore !== null).length, [items]);
  const avgScore = useMemo(() => {
    const scored = (items ?? []).filter((it) => it.lastScore !== null);
    if (scored.length === 0) return null;
    return Math.round(scored.reduce((s, it) => s + it.lastScore!, 0) / scored.length);
  }, [items]);
  const totalQuestions = useMemo(() => (items ?? []).reduce((s, it) => s + it.exam.questionCount, 0), [items]);
  const totalAttempts = history?.length ?? 0;
  const completionPct = items && items.length ? Math.round((completedCount / items.length) * 100) : 0;

  // Real score-over-time series from actual submitted attempts (oldest → newest),
  // not a fabricated trend line.
  const trend = useMemo(() => {
    const rows = [...(history ?? [])].filter((h) => h.score !== null).reverse();
    return rows.map((h, i) => ({ i, label: new Date(h.submittedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }), score: h.score! }));
  }, [history]);

  const filtered = useMemo(() => {
    let list = items ?? [];
    if (subject) list = list.filter((it) => it.exam.subject === subject);
    if (status === "completed") list = list.filter((it) => it.lastScore !== null);
    if (status === "notStarted") list = list.filter((it) => it.lastScore === null && !it.inProgress);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((it) => it.exam.title.toLowerCase().includes(q) || it.exam.code.toLowerCase().includes(q) || (it.exam.subject ?? "").toLowerCase().includes(q));
    return list;
  }, [items, subject, status, search]);

  return (
    <Shell>
      <div className="fade-in">
        {error && <ErrorBanner>{error}</ErrorBanner>}

        {!items && !error && (
          <div className="mt-4 space-y-4">
            <Skeleton className="h-[220px] rounded-[28px]" />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6"><Skeleton className="h-20 rounded-[18px]" /><Skeleton className="h-20 rounded-[18px]" /><Skeleton className="h-20 rounded-[18px]" /><Skeleton className="h-20 rounded-[18px]" /><Skeleton className="h-20 rounded-[18px]" /><Skeleton className="h-20 rounded-[18px]" /></div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="card p-5">
                  <div className="flex items-center gap-2"><Skeleton className="h-9 w-9 rounded-xl" /><div className="flex-1"><Skeleton className="h-3.5 w-2/3" /><Skeleton className="mt-1.5 h-3 w-1/3" /></div></div>
                  <Skeleton className="mt-3 h-3 w-full" />
                  <Skeleton className="mt-4 h-9 w-full rounded-lg" />
                </div>
              ))}
            </div>
          </div>
        )}

        {items && items.length === 0 && (
          <EmptyState className="mt-6" icon={Dumbbell} title={t("prac.none")} hint={t("prac.noneHint")} />
        )}

        {items && items.length > 0 && (
          <>
            {/* Hero — 28px radius, 44/48px padding, 180×180 ring, 320×10 progress bar */}
            <div className="flex flex-wrap items-center gap-8" style={{ borderRadius: 28, padding: "44px 48px", background: "linear-gradient(135deg, #14140f 0%, #1c1c14 100%)" }}>
              <ScoreRing pct={avgScore} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: LIME_TEXT }}>
                  {continueItem ? "Pick up where you left off" : "Keep up the great work"}
                </p>
                <h2 className="mt-1 text-2xl font-bold text-white">
                  {continueItem ? continueItem.exam.title : `Ready to practice, ${(user?.name ?? "there").split(" ")[0]}?`}
                </h2>
                <p className="mt-1.5 text-sm text-white/60">
                  {completedCount} of {items.length} completed{streak > 0 ? ` · ${streak}-day streak` : ""}
                </p>
                <div className="mt-3 overflow-hidden rounded-full bg-white/10" style={{ width: 320, maxWidth: "100%", height: 10, borderRadius: 6 }}>
                  <div className="h-full" style={{ width: `${completionPct}%`, background: LIME, borderRadius: 6 }} />
                </div>
                <div className="mt-5 flex flex-wrap gap-2.5">
                  {continueItem && (
                    <button onClick={() => start(continueItem.registrationId)} disabled={starting === continueItem.registrationId}
                      className="btn btn-primary disabled:opacity-50" style={{ padding: "13px 22px", borderRadius: 12, whiteSpace: "nowrap" }}>
                      {starting === continueItem.registrationId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Continue Practice
                    </button>
                  )}
                  {nextNotStarted && (
                    <button onClick={() => start(nextNotStarted.registrationId)} disabled={starting === nextNotStarted.registrationId}
                      className="inline-flex items-center gap-2 border border-white/20 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-50"
                      style={{ padding: "13px 22px", borderRadius: 12, whiteSpace: "nowrap" }}>
                      {starting === nextNotStarted.registrationId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Start {continueItem ? "Another" : "Practice"}
                    </button>
                  )}
                  <Link to="/results" className="inline-flex items-center gap-2 border border-white/20 text-sm font-semibold text-white transition hover:bg-white/10"
                    style={{ padding: "13px 22px", borderRadius: 12, whiteSpace: "nowrap" }}>
                    <HistoryIcon className="h-4 w-4" /> Past Results
                  </Link>
                </div>
              </div>
            </div>

            {/* Continue Practice — 22px radius, 26/30px padding, 52×52 icon, 220×8 progress */}
            {continueItem && (
              <div className="card mt-4 flex flex-wrap items-center gap-5" style={{ borderRadius: 22, padding: "26px 30px" }}>
                <span className="flex shrink-0 items-center justify-center rounded-2xl" style={{ width: 52, height: 52, background: tint(LIME), color: LIME_TEXT }}>
                  <RotateCcw className="h-6 w-6" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Continue Practice</p>
                  <p className="truncate text-sm font-bold text-[var(--fg)]">{continueItem.exam.title}</p>
                  <div className="mt-2 overflow-hidden rounded-full bg-[var(--card-2)]" style={{ width: 220, maxWidth: "100%", height: 8 }}>
                    <div className="h-full rounded-full" style={{ width: `${continueItem.inProgressPct ?? 0}%`, background: LIME }} />
                  </div>
                  <p className="mt-1 text-[11px] text-[var(--muted)]">{continueItem.inProgressPct ?? 0}% of questions answered so far</p>
                </div>
                <button onClick={() => start(continueItem.registrationId)} disabled={starting === continueItem.registrationId} className="btn btn-primary shrink-0 disabled:opacity-50">
                  {starting === continueItem.registrationId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Continue
                </button>
              </div>
            )}

            {/* Statistics — 6-col grid, 18px radius, 22/18px padding */}
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              <StatCard icon={Dumbbell} label="Practice Exams" value={items.length} color={LIME} />
              <StatCard icon={CheckCircle2} label="Completed" value={completedCount} color={CYAN} />
              <StatCard icon={TrendingUp} label="Average Score" value={avgScore !== null ? `${avgScore}%` : "—"} color={PURPLE} />
              <StatCard icon={FileText} label="Total Questions" value={totalQuestions} color={AMBER} />
              <StatCard icon={Flame} label="Practice Streak" value={streak > 0 ? `${streak}d` : "—"} color={LIME} />
              <StatCard icon={HistoryIcon} label="Total Attempts" value={totalAttempts} color={CYAN} />
            </div>

            {/* Categories — 5-col grid, 18px radius, 22px padding, 40×40 icon, 6px bar */}
            {categories.length > 1 && (
              <div className="mt-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold text-[var(--fg)]">Course Categories</p>
                  {subject && <button onClick={() => setSubject(null)} className="text-xs font-semibold text-[var(--lime-text)] hover:underline">Clear filter</button>}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                  {categories.map((c) => (
                    <button key={c.subject} onClick={() => setSubject(subject === c.subject ? null : c.subject)}
                      className={clsx("card text-left transition hover:-translate-y-0.5", subject === c.subject ? "border-brand-500/50" : "")}
                      style={{ borderRadius: 18, padding: 22 }}>
                      <div className="flex items-center justify-between">
                        <span className="flex shrink-0 items-center justify-center rounded-xl" style={{ width: 40, height: 40, background: tint(c.color), color: c.color }}><ListChecks className="h-4.5 w-4.5" /></span>
                        <span className="text-[10px] font-semibold text-[var(--muted)]">{c.done}/{c.total} done</span>
                      </div>
                      <p className="mt-3 truncate text-sm font-semibold text-[var(--fg)]">{c.subject}</p>
                      <div className="mt-2 overflow-hidden rounded-full bg-[var(--card-2)]" style={{ height: 6 }}>
                        <div className="h-full rounded-full" style={{ width: `${c.pct}%`, background: c.color }} />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Score trend — real submitted-score series, not part of the spec but kept since it's real data already computed */}
            {trend.length > 1 && (
              <div className="card mt-4 rounded-[18px] p-5">
                <p className="flex items-center gap-1.5 text-sm font-bold text-[var(--fg)]"><LineChartIcon className="h-4 w-4 text-[var(--lime-text)]" /> Score Trend</p>
                <p className="text-[11px] text-[var(--muted)]">Your last {trend.length} scored attempts</p>
                <div className="mt-3 h-32 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trend} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                      <defs>
                        <linearGradient id="practiceScoreFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={LIME} stopOpacity={0.35} />
                          <stop offset="100%" stopColor={LIME} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <Tooltip formatter={((v: number) => [`${v}%`, "Score"]) as unknown as (v: unknown) => [string, string]} labelFormatter={(_l, p) => p?.[0]?.payload?.label ?? ""}
                        contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                      <Area type="monotone" dataKey="score" stroke={LIME} strokeWidth={2} fill="url(#practiceScoreFill)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Search + filters */}
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted)]" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search practice exams…" className="input h-9 pl-9 text-xs" />
              </div>
              <div className="flex rounded-lg border border-[var(--border)] p-0.5">
                {([["all", "All"], ["notStarted", "Not started"], ["completed", "Completed"]] as [StatusFilter, string][]).map(([k, label]) => (
                  <button key={k} onClick={() => setStatus(k)} className={clsx("rounded-md px-2.5 py-1 text-xs font-semibold transition", status === k ? "bg-brand-500 text-[var(--brand-ink)]" : "text-[var(--muted)] hover:text-[var(--fg)]")}>{label}</button>
                ))}
              </div>
            </div>

            {subjects.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button onClick={() => setSubject(null)} className={clsx("rounded-full px-3 py-1 text-xs font-medium transition", subject === null ? "bg-brand-500 text-[var(--brand-ink)]" : "bg-[var(--card-2)] text-[var(--muted)] hover:text-[var(--fg)]")}>All subjects</button>
                {subjects.map((s) => (
                  <button key={s} onClick={() => setSubject(s)} className={clsx("rounded-full px-3 py-1 text-xs font-medium transition", subject === s ? "bg-brand-500 text-[var(--brand-ink)]" : "bg-[var(--card-2)] text-[var(--muted)] hover:text-[var(--fg)]")}>{s}</button>
                ))}
              </div>
            )}

            {filtered.length === 0 ? (
              <EmptyState className="mt-6" icon={Target} title="No practice exams match" hint="Try a different search or filter." />
            ) : (
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                {filtered.map((it) => {
                  const color = it.exam.subject ? subjectColor.get(it.exam.subject) ?? LIME : LIME;
                  return (
                    <div key={it.exam.id} className="card flex flex-col rounded-[20px] p-5">
                      <div className="flex items-center gap-2">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: tint(color), color }}><Dumbbell className="h-4 w-4" /></div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{it.exam.title}</p>
                          <p className="text-xs text-[var(--muted)]">{it.exam.code}{it.exam.subject ? ` · ${it.exam.subject}` : ""}</p>
                        </div>
                        {it.inProgress && <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-500">In progress</span>}
                      </div>
                      {it.exam.description && <p className="mt-3 line-clamp-2 text-sm text-[var(--muted)]">{it.exam.description}</p>}
                      <div className="mt-3 flex items-center gap-3 text-xs text-[var(--muted)]">
                        <span className="inline-flex items-center gap-1"><FileText className="h-3.5 w-3.5" /> {t("prac.questions", { n: it.exam.questionCount })}</span>
                        <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {it.exam.durationMinutes} {t("exams.minutes")}</span>
                        {it.lastScore !== null && <span className="ml-auto font-semibold text-[var(--fg)]">{t("prac.last")}: {it.lastScore}%</span>}
                      </div>
                      <button onClick={() => start(it.registrationId)} disabled={starting === it.registrationId} className="btn btn-primary mt-4 disabled:opacity-50">
                        {starting === it.registrationId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                        {it.inProgress ? "Continue" : it.lastScore !== null ? t("prac.retake") : t("prac.start")}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Recent history — real submitted attempts, most recent first */}
            {history && history.length > 0 && (
              <div className="card mt-4 rounded-[22px] p-5">
                <p className="flex items-center gap-1.5 text-sm font-bold text-[var(--fg)]"><HistoryIcon className="h-4 w-4 text-[var(--lime-text)]" /> Recent History</p>
                <div className="mt-3 divide-y divide-[var(--border)]">
                  {history.map((h) => (
                    <div key={h.id} className="flex items-center gap-3 py-2.5 text-sm">
                      <span className={clsx("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", h.passed ? "bg-emerald-500/15 text-emerald-500" : "bg-rose-500/15 text-rose-500")}>
                        {h.passed ? <CheckCircle2 className="h-4 w-4" /> : <Target className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium text-[var(--fg)]">{h.examTitle}</span>
                      <span className="shrink-0 text-xs text-[var(--muted)]">{ago(h.submittedAt)}</span>
                      <span className={clsx("shrink-0 text-xs font-bold", h.passed ? "text-emerald-500" : "text-rose-500")}>{h.score ?? "—"}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Shell>
  );
}
