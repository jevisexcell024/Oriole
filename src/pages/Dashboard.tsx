import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  BookOpen, CheckCircle2, BarChart3, Clock, Megaphone, TrendingUp, TrendingDown,
  MonitorCheck, CalendarClock, Flame, ShieldAlert, Dumbbell, History,
  CalendarDays, ShieldCheck, ChevronRight, Star, Timer,
} from "lucide-react";
import { Shell } from "@/components/Shell";
import { Skeleton } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import type { ExamListItem } from "@shared/types";
import { clsx } from "clsx";

// ── Brand colours (full saturation — never toned) ─────────────────────────────
const PINK = "#fe3bed";
const LIME = "#c6ff34";

const CARD_PALETTES = [
  { bg: PINK,      text: "#000000" },
  { bg: LIME,      text: "#000000" },
  { bg: "#ffffff", text: "#000000" },
];

function hashCard(id: string) {
  let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return CARD_PALETTES[h % CARD_PALETTES.length];
}

// ── Interfaces ─────────────────────────────────────────────────────────────────
interface Summary { enrolled: number; completed: number; pending: number; awaitingApproval: number; avgScore: number | null; passed: number; streak: number; }
interface Ann { id: string; title: string; message: string; priority: string; sentAt: string; }
interface Result { attemptId: string; examTitle: string; examCode: string; score: number; passed: boolean; gradingStatus: string; submittedAt: string | null; passingScore: number; }

// ── Helpers ────────────────────────────────────────────────────────────────────
function startIso(it: ExamListItem): string | null {
  return it.registration.scheduledStart || it.exam.availableFrom || null;
}
function cdParts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { days: Math.floor(s / 86400), hours: Math.floor((s % 86400) / 3600), minutes: Math.floor((s % 3600) / 60), seconds: s % 60 };
}
function cdShort(ms: number): string {
  const { days, hours, minutes, seconds } = cdParts(ms);
  if (days > 0)  return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${seconds}s`;
}
function gradeOf(p: number) {
  if (p >= 93) return "A"; if (p >= 90) return "A-"; if (p >= 87) return "B+"; if (p >= 83) return "B";
  if (p >= 80) return "B-"; if (p >= 77) return "C+"; if (p >= 73) return "C"; if (p >= 70) return "C-";
  if (p >= 60) return "D"; return "F";
}
function ago(iso: string | null) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  const m = s / 60; if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60; if (h < 24) return `${Math.floor(h)}h ago`;
  const d = h / 24; if (d < 7) return `${Math.floor(d)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
function fmtDate(iso: string | null) {
  if (!iso) return "TBD";
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
function initials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

// ── Main component ─────────────────────────────────────────────────────────────
export function Dashboard() {
  const t = useT();
  const { user } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [exams, setExams] = useState<ExamListItem[]>([]);
  const [anns, setAnns] = useState<Ann[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [subjectFilter, setSubjectFilter] = useState("All");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    api.get<Summary>("/my/summary").then(setSummary).catch(() => {});
    api.get<{ items: ExamListItem[] }>("/exams").then((d) => setExams(d.items)).catch(() => {});
    api.get<{ announcements: Ann[] }>("/announcements").then((d) => setAnns(d.announcements)).catch(() => {});
    api.get<{ results: Result[] }>("/my/results").then((d) => setResults(d.results)).catch(() => {});
  }, []);

  // Tick every second so countdowns update live.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const upcoming = useMemo(
    () => exams
      .filter((it) => !it.attempt || it.attempt.status !== "submitted")
      .sort((a, b) => (startIso(a) ?? "9999").localeCompare(startIso(b) ?? "9999")),
    [exams],
  );

  const subjects = useMemo(() => {
    const set = new Set<string>();
    for (const it of upcoming) if (it.exam.subject) set.add(it.exam.subject);
    return ["All", ...set];
  }, [upcoming]);

  const filteredExams = useMemo(
    () => subjectFilter === "All" ? upcoming : upcoming.filter((it) => it.exam.subject === subjectFilter),
    [upcoming, subjectFilter],
  );

  const isReady = (it: ExamListItem) => it.registration.approval === "confirmed" && it.registration.systemCheckPassed;
  const setupNeeded = upcoming.find((it) => !isReady(it));

  // The soonest upcoming exam that hasn't opened yet.
  const nextScheduled = filteredExams.find((it) => {
    const s = startIso(it);
    return s && new Date(s).getTime() > now;
  }) ?? null;

  const trend = useMemo(() => {
    if (results.length < 2) return null;
    return Math.round((results[0].score - results[1].score) * 10) / 10;
  }, [results]);

  const series = useMemo(() => {
    const ordered = [...results].reverse().slice(-8);
    return ordered.map((r) => ({
      label: r.examCode || (r.submittedAt ? new Date(r.submittedAt).toLocaleDateString(undefined, { month: "short" }) : ""),
      score: r.score, pass: r.passingScore,
    }));
  }, [results]);

  const firstName = user?.name?.split(" ")[0] ?? "Student";

  return (
    <Shell>
      <div className="fade-in">
        {!summary ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <Skeleton className="h-[600px] w-full rounded-2xl" />
            <Skeleton className="h-[600px] w-full rounded-2xl" />
          </div>
        ) : (
          <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">

            {/* ══ MAIN COLUMN ══════════════════════════════════════════════════ */}
            <div className="flex flex-col gap-5">

              {/* Action-required banner */}
              {setupNeeded && (
                <div className="flex flex-wrap items-center gap-4 rounded-2xl border-2 p-4"
                  style={{ borderColor: PINK, background: `${PINK}15` }}>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                    style={{ background: PINK }}>
                    <Clock className="h-5 w-5 text-black" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold">System check required — {setupNeeded.exam.title}</p>
                    <p className="text-xs text-[var(--muted)]">
                      Complete your browser & webcam check before {startIso(setupNeeded) ? fmtDate(startIso(setupNeeded)) : "the exam"}.
                    </p>
                  </div>
                  <Link to={`/exams/${setupNeeded.registration.id}/checkin`}
                    className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition hover:opacity-90"
                    style={{ background: PINK, color: "#000" }}>
                    <MonitorCheck className="h-4 w-4" /> Run check
                  </Link>
                </div>
              )}

              {/* Hero heading */}
              <div>
                <h1 className="font-display text-4xl font-bold leading-tight lg:text-5xl">
                  {t("greeting.morning") && <>
                    Hi, {firstName}.<br />
                  </>}
                  <span style={{ color: LIME }}>Prepare.</span>{" "}
                  <span style={{ color: PINK }}>Take.</span>{" "}
                  Succeed.
                </h1>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  {summary.enrolled} exam{summary.enrolled !== 1 ? "s" : ""} enrolled · {summary.completed} completed · {summary.streak} day streak
                </p>
              </div>

              {/* Stat pills */}
              <div className="flex flex-wrap gap-3">
                <StatPill label="Avg Score" value={summary.avgScore !== null ? `${gradeOf(summary.avgScore)} · ${summary.avgScore}%` : "—"} color={LIME} />
                <StatPill label="Passed" value={`${summary.passed}`} color={LIME} />
                <StatPill label="Streak" value={`${summary.streak}d`} color={PINK} />
                <StatPill label="Pending" value={`${summary.pending}`} color={summary.pending > 0 ? PINK : "var(--muted)"} />
              </div>

              {/* Subject filter pills */}
              {subjects.length > 1 && (
                <div className="flex flex-wrap gap-2">
                  {subjects.map((s) => (
                    <button key={s} onClick={() => setSubjectFilter(s)}
                      className="rounded-full border px-4 py-1.5 text-xs font-semibold transition"
                      style={subjectFilter === s
                        ? { background: LIME, color: "#000", borderColor: LIME }
                        : { background: "transparent", color: "var(--muted)", borderColor: "var(--border)" }}>
                      {s}
                    </button>
                  ))}
                </div>
              )}

              {/* Countdown hero — next scheduled exam */}
              {nextScheduled && (
                <CountdownHero it={nextScheduled} now={now} ready={isReady(nextScheduled)} />
              )}

              {/* Section heading */}
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold uppercase tracking-widest" style={{ color: "var(--muted)" }}>
                  Upcoming exams
                </h2>
                <Link to="/exams" className="flex items-center gap-1 text-xs font-semibold hover:underline" style={{ color: LIME }}>
                  View all <ChevronRight className="h-3.5 w-3.5" />
                </Link>
              </div>

              {/* Exam cards — 2-col grid */}
              {filteredExams.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-[var(--border)] py-16 text-center">
                  <BookOpen className="h-10 w-10 text-[var(--muted)]" />
                  <p className="text-sm font-medium text-[var(--muted)]">No exams scheduled right now.</p>
                  <p className="text-xs text-[var(--muted)]">Check back later or contact your administrator.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {filteredExams.slice(0, 4).map((it, idx) => {
                    const pal = hashCard(it.exam.id);
                    const when = startIso(it);
                    const ready = isReady(it);
                    return (
                      <ExamCard key={it.registration.id} it={it} pal={pal} when={when} ready={ready} idx={idx} now={now} />
                    );
                  })}
                </div>
              )}

              {/* Performance trend chart */}
              {series.length >= 2 && (
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold">Score Trend</h2>
                    <Link to="/results" className="flex items-center gap-1 text-xs font-semibold hover:underline" style={{ color: LIME }}>
                      All results <ChevronRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                  <div className="mt-4"><TrendChart data={series} /></div>
                  <div className="mt-3 flex items-center justify-center gap-5 text-[11px] text-[var(--muted)]">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-0.5 w-5 rounded" style={{ background: LIME }} /> Your score
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-0.5 w-5 rounded border-t border-dashed border-[var(--muted)]" /> Pass mark
                    </span>
                  </div>
                </div>
              )}

            </div>

            {/* ══ RIGHT RAIL ═══════════════════════════════════════════════════ */}
            <aside className="flex flex-col gap-4">

              {/* Profile card */}
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
                <div className="flex flex-col items-center gap-3 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full text-lg font-bold text-black"
                    style={{ background: LIME }}>
                    {initials(user?.name ?? "S")}
                  </div>
                  <div>
                    <p className="font-bold">{user?.name}</p>
                    <p className="text-xs text-[var(--muted)]">{user?.email}</p>
                  </div>
                  <div className="flex w-full justify-center gap-6 border-t border-[var(--border)] pt-3">
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-lg font-bold" style={{ color: LIME }}>{summary.enrolled}</span>
                      <span className="text-[10px] text-[var(--muted)]">Enrolled</span>
                    </div>
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-lg font-bold" style={{ color: LIME }}>{summary.completed}</span>
                      <span className="text-[10px] text-[var(--muted)]">Completed</span>
                    </div>
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-lg font-bold" style={{ color: PINK }}>{summary.streak}</span>
                      <span className="text-[10px] text-[var(--muted)]">Streak</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Activity bar chart */}
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold">Activity</p>
                  {trend !== null && (
                    <span className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold"
                      style={{ background: trend >= 0 ? `${LIME}25` : `${PINK}25`, color: trend >= 0 ? LIME : PINK }}>
                      {trend >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                      {trend >= 0 ? "+" : ""}{trend}%
                    </span>
                  )}
                </div>
                {series.length === 0 ? (
                  <p className="mt-4 py-8 text-center text-xs text-[var(--muted)]">Complete exams to see your activity.</p>
                ) : (
                  <div className="mt-4"><ActivityBars data={series} /></div>
                )}
                {summary.avgScore !== null && (
                  <div className="mt-3 flex items-center gap-2 rounded-xl p-3" style={{ background: `${LIME}20` }}>
                    <TrendingUp className="h-4 w-4 shrink-0" style={{ color: LIME }} />
                    <div>
                      <p className="text-xs font-bold" style={{ color: LIME }}>Avg {summary.avgScore}% · {gradeOf(summary.avgScore)}</p>
                      <p className="text-[10px] text-[var(--muted)]">Keep it up</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Recent results */}
              {results.length > 0 && (
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold">My results</p>
                    <Link to="/results" className="text-xs font-semibold hover:underline" style={{ color: LIME }}>See all</Link>
                  </div>
                  <div className="mt-3 space-y-2">
                    {results.slice(0, 3).map((r) => {
                      const pal = hashCard(r.attemptId);
                      return (
                        <Link key={r.attemptId} to={`/results/${r.attemptId}`}
                          className="flex items-center gap-3 rounded-xl p-3 transition hover:opacity-90"
                          style={{ background: pal.bg, color: pal.text }}>
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-bold text-sm"
                            style={{ background: "rgba(0,0,0,0.15)", color: pal.text }}>
                            {gradeOf(r.score)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-bold">{r.examTitle}</p>
                            <p className="text-[10px] opacity-70">{ago(r.submittedAt)}</p>
                          </div>
                          <span className="shrink-0 text-sm font-bold">{r.score}%</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Announcements */}
              {anns.length > 0 && (
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold">Announcements</p>
                    <Link to="/announcements" className="text-xs font-semibold hover:underline" style={{ color: LIME }}>All</Link>
                  </div>
                  <div className="mt-3 space-y-2">
                    {anns.slice(0, 3).map((a) => (
                      <div key={a.id} className="flex items-start gap-2.5 rounded-xl border border-[var(--border)] p-3">
                        <Megaphone className="h-4 w-4 shrink-0 mt-0.5" style={{ color: PINK }} />
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold">{a.title}</p>
                          <p className="text-[10px] text-[var(--muted)]">{ago(a.sentAt)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Quick actions */}
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
                <p className="text-sm font-bold">Quick actions</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {[
                    { label: "Practice Test", icon: Dumbbell, to: "/practice", color: LIME },
                    { label: "Past Papers", icon: History, to: "/results", color: PINK },
                    { label: "My Exams", icon: BookOpen, to: "/exams", color: LIME },
                    { label: "Calendar", icon: CalendarDays, to: "/calendar", color: PINK },
                  ].map((q) => (
                    <Link key={q.label} to={q.to}
                      className="flex flex-col items-center gap-2 rounded-xl border border-[var(--border)] p-3 text-center text-xs font-semibold transition hover:-translate-y-0.5 hover:border-[var(--border-strong)]"
                      style={{ background: `${q.color}12` }}>
                      <q.icon className="h-5 w-5" style={{ color: q.color }} />
                      {q.label}
                    </Link>
                  ))}
                </div>
              </div>

            </aside>
          </div>
        )}
      </div>
    </Shell>
  );
}

// ── Exam Card ──────────────────────────────────────────────────────────────────
function ExamCard({ it, pal, when, ready, idx, now }: {
  it: ExamListItem;
  pal: { bg: string; text: string };
  when: string | null;
  ready: boolean;
  idx: number;
  now: number;
}) {
  const t = useT();
  const msLeft = when ? new Date(when).getTime() - now : null;
  const pending = msLeft !== null && msLeft > 0;
  return (
    <div className="relative flex flex-col justify-between overflow-hidden rounded-2xl p-5 transition hover:-translate-y-0.5"
      style={{ background: pal.bg, color: pal.text, minHeight: 180 }}>
      {/* Subject badge + score pill */}
      <div className="flex items-start justify-between gap-2">
        <span className="rounded-full px-3 py-1 text-[11px] font-bold"
          style={{ background: "rgba(0,0,0,0.18)", color: pal.text }}>
          {it.exam.subject || it.exam.code || "Exam"}
        </span>
        <span className="flex items-center gap-0.5 rounded-full px-2.5 py-1 text-[11px] font-bold"
          style={{ background: "rgba(0,0,0,0.18)", color: pal.text }}>
          <Star className="h-3 w-3" />
          {it.exam.passingScore ?? 50}% pass
        </span>
      </div>

      {/* Title */}
      <div className="mt-3 flex-1">
        <h3 className="font-bold leading-tight" style={{ color: pal.text, fontSize: "1.05rem" }}>
          {it.exam.title}
        </h3>
        {it.exam.code && (
          <p className="mt-0.5 font-mono text-[11px] opacity-70">{it.exam.code}</p>
        )}
      </div>

      {/* Mini countdown badge */}
      {pending && msLeft !== null && (
        <div className="mt-3 inline-flex items-center gap-1.5 self-start rounded-lg px-2.5 py-1.5 text-xs font-bold tabular-nums"
          style={{ background: "rgba(0,0,0,0.22)", color: pal.text }}>
          <Timer className="h-3 w-3 shrink-0" />
          {cdShort(msLeft)}
        </div>
      )}

      {/* Footer */}
      <div className="mt-3 flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] opacity-75">
          <span className="flex items-center gap-1">
            <CalendarClock className="h-3 w-3" /> {when ? fmtDate(when) : "Not scheduled"}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" /> {it.exam.durationMinutes} min
          </span>
          {it.exam.proctored && (
            <span className="flex items-center gap-1">
              <ShieldAlert className="h-3 w-3" /> Proctored
            </span>
          )}
        </div>
        <Link to={`/exams/${it.registration.id}/checkin`}
          className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition hover:opacity-80"
          style={{ background: "rgba(0,0,0,0.22)", color: pal.text }}>
          {ready ? "View" : "Prepare"} <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* Ready indicator */}
      <div className="absolute right-3 top-3 h-2 w-2 rounded-full"
        style={{ background: ready ? "#00ff88" : "#ffaa00", boxShadow: `0 0 6px ${ready ? "#00ff88" : "#ffaa00"}` }} />
    </div>
  );
}

// ── Countdown Hero ─────────────────────────────────────────────────────────────
function CountdownHero({ it, now, ready }: { it: ExamListItem; now: number; ready: boolean }) {
  const start = startIso(it)!;
  const msLeft = Math.max(0, new Date(start).getTime() - now);
  const { days, hours, minutes, seconds } = cdParts(msLeft);
  const urgent = msLeft < 3_600_000; // < 1 hour
  const color = urgent ? PINK : LIME;

  return (
    <div className="overflow-hidden rounded-2xl border-2 p-6" style={{ borderColor: color, background: `${color}0c` }}>
      {/* Header row */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest" style={{ color }}>
            <Timer className="h-3.5 w-3.5" />
            {urgent ? "Starting soon" : "Next exam starts in"}
          </p>
          <h3 className="mt-1.5 text-xl font-bold leading-tight">{it.exam.title}</h3>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            {it.exam.subject && <span className="mr-2">{it.exam.subject}</span>}
            {fmtDate(start)}
          </p>
        </div>
        <Link
          to={`/exams/${it.registration.id}/checkin`}
          className="flex shrink-0 items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-bold transition hover:opacity-90"
          style={{ background: color, color: "#000" }}>
          <MonitorCheck className="h-4 w-4" />
          {ready ? "Go to exam" : "Prepare now"}
        </Link>
      </div>

      {/* Big digit countdown */}
      <div className="mt-6 flex flex-wrap items-end gap-2">
        {days > 0 && (
          <>
            <CountUnit value={days} label="days" color={color} />
            <Colon color={color} />
          </>
        )}
        <CountUnit value={hours} label="hours" color={color} pulse={urgent} />
        <Colon color={color} />
        <CountUnit value={minutes} label="min" color={color} pulse={urgent} />
        <Colon color={color} />
        <CountUnit value={seconds} label="sec" color={color} pulse={urgent} />
      </div>

      {urgent && (
        <p className="mt-4 text-xs font-semibold" style={{ color: PINK }}>
          Your exam opens very soon — make sure you are ready to begin.
        </p>
      )}
    </div>
  );
}

function CountUnit({ value, label, color, pulse }: { value: number; label: string; color: string; pulse?: boolean }) {
  return (
    <div className="flex min-w-[4rem] flex-col items-center">
      <span
        className={clsx("font-display text-6xl font-black leading-none tabular-nums sm:text-7xl", pulse && "animate-pulse")}
        style={{ color }}>
        {String(value).padStart(2, "0")}
      </span>
      <span className="mt-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">{label}</span>
    </div>
  );
}

function Colon({ color }: { color: string }) {
  return (
    <span className="mb-7 self-end font-display text-4xl font-black leading-none sm:text-5xl" style={{ color, opacity: 0.45 }}>:</span>
  );
}

// ── Stat Pill ──────────────────────────────────────────────────────────────────
function StatPill({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-2">
      <span className="h-2 w-2 rounded-full shrink-0" style={{ background: color }} />
      <span className="text-xs text-[var(--muted)]">{label}</span>
      <span className="text-xs font-bold">{value}</span>
    </div>
  );
}

// ── Trend Line Chart ───────────────────────────────────────────────────────────
function TrendChart({ data }: { data: { label: string; score: number; pass: number }[] }) {
  const W = 700, H = 220, padL = 28, padR = 12, padT = 10, padB = 26;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const yMin = 40, yMax = 100;
  const clamp = (v: number) => Math.max(yMin, Math.min(yMax, v));
  const x = (i: number) => padL + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v: number) => padT + innerH - ((clamp(v) - yMin) / (yMax - yMin)) * innerH;
  const path = (key: "score" | "pass") => data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(d[key])}`).join(" ");
  const ticks = [60, 80, 100];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 220 }}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} y1={y(t)} x2={W - padR} y2={y(t)} stroke="var(--border)" strokeWidth="1" />
          <text x={padL - 6} y={y(t) + 3} textAnchor="end" className="fill-[var(--muted)]" fontSize="10">{t}</text>
        </g>
      ))}
      <path d={path("pass")} fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="5 5" opacity="0.6" />
      <path d={path("score")} fill="none" stroke={LIME} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {data.map((d, i) => (
        <circle key={i} cx={x(i)} cy={y(d.score)} r="4" fill={LIME} stroke="var(--card)" strokeWidth="2" />
      ))}
      {data.map((d, i) => (
        <text key={i} x={x(i)} y={H - 6} textAnchor="middle" className="fill-[var(--muted)]" fontSize="9">
          {d.label.length > 7 ? d.label.slice(0, 6) + "…" : d.label}
        </text>
      ))}
    </svg>
  );
}

// ── Activity Bar Chart (right rail) ──────────────────────────────────────────
function ActivityBars({ data }: { data: { label: string; score: number }[] }) {
  const H = 80;
  const max = Math.max(...data.map((d) => d.score), 1);
  const barW = Math.floor(100 / data.length);
  return (
    <div className="flex items-end gap-1" style={{ height: H }}>
      {data.map((d, i) => {
        const h = Math.round((d.score / max) * H);
        const isLast = i === data.length - 1;
        return (
          <div key={i} className="flex flex-1 flex-col items-center gap-1">
            <div className="w-full rounded-t-md transition-all"
              style={{ height: h, background: isLast ? LIME : `${LIME}55`, minHeight: 4 }} />
            <span className="text-[9px] text-[var(--muted)] truncate w-full text-center">{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}
