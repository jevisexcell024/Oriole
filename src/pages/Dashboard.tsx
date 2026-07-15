import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  BookOpen, Calendar as CalendarIcon, Clock, TrendingUp, TrendingDown, ChevronRight, ChevronLeft, CheckCircle2, Circle, Search,
} from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, CartesianGrid, XAxis, Tooltip } from "recharts";
import { Shell } from "@/components/Shell";
import { Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { ExamListItem } from "@shared/types";
import { clsx } from "clsx";

// ── Design tokens ── theme-aware: these track the app's light/dark CSS
// variables (src/index.css) instead of a fixed dark palette, so the toggle
// in the header actually changes this page. Accent colors stay fixed. ──
const BG = "var(--bg)";
const CARD = "var(--card)";
const SURFACE = "var(--card-2)";
const DEEP = "var(--border-strong)";
const LIME = "#c8f000";
const CYAN = "#22d3ee";
const PURPLE = "#c084fc";
const AMBER = "#f59e0b";
const BLUE = "#3b82f6";
const FG = "var(--fg)";
const DIM = "var(--muted)";
const DESTRUCTIVE = "#ef4444";
const BORDER = "var(--border)";
const FONT = "'Inter', sans-serif";
const BARLOW = "'Barlow Condensed', sans-serif";
const MONO = "'DM Mono', monospace";
const SUBJECT_COLORS = [LIME, CYAN, PURPLE, AMBER];

interface Summary { enrolled: number; completed: number; pending: number; awaitingApproval: number; avgScore: number | null; passed: number; streak: number; }

function startIso(it: ExamListItem): string | null {
  return it.registration.scheduledStart || it.exam.availableFrom || null;
}
function sameCalendarDay(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function greetingFor(d: Date) { const h = d.getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; }
function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  const m = s / 60; if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60; if (h < 24) return `${Math.floor(h)}h ago`;
  const d = h / 24; return `${Math.floor(d)}d ago`;
}

// Cards-per-page for the New Courses carousel: 1 below 640px, 3 at/above (matches the spec's mobile breakpoint).
function useCardsPerPage() {
  const [n, setN] = useState(() => (typeof window !== "undefined" && window.innerWidth < 640 ? 1 : 3));
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const onChange = () => setN(mq.matches ? 3 : 1);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return n;
}

export function Dashboard() {
  const { user } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [exams, setExams] = useState<ExamListItem[] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [search, setSearch] = useState("");
  const [coursePage, setCoursePage] = useState(0);
  const [activeOnly, setActiveOnly] = useState(true);

  useEffect(() => {
    api.get<Summary>("/my/summary").then(setSummary).catch(() => {});
    api.get<{ items: ExamListItem[] }>("/exams").then((d) => setExams(d.items)).catch(() => setExams([]));
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const loading = !summary || !exams;

  // ── New Courses: search + paginate over every published exam ──
  const courses = useMemo(() => {
    const list = exams ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((it) => it.exam.title.toLowerCase().includes(q) || it.exam.code.toLowerCase().includes(q) || (it.exam.subject ?? "").toLowerCase().includes(q));
  }, [exams, search]);
  useEffect(() => { setCoursePage(0); }, [search]);
  const cardsPerPage = useCardsPerPage();
  const coursePageCount = Math.max(1, Math.ceil(courses.length / cardsPerPage));
  const clampedCoursePage = Math.min(coursePage, coursePageCount - 1);
  const visibleCourses = courses.slice(clampedCoursePage * cardsPerPage, clampedCoursePage * cardsPerPage + cardsPerPage);

  // ── Today's sessions (real: exams scheduled/available today) ──
  const todaysSessions = useMemo(() => {
    const today = new Date();
    return (exams ?? [])
      .filter((it) => { const s = startIso(it); return s && sameCalendarDay(new Date(s), today); })
      .sort((a, b) => startIso(a)!.localeCompare(startIso(b)!));
  }, [exams]);

  // ── Hours Activity: real hours spent per day, derived from attempt timestamps ──
  const hoursActivity = useMemo(() => {
    const days: { day: string; hours: number; ts: number }[] = [];
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today); d.setDate(today.getDate() - i); d.setHours(0, 0, 0, 0);
      days.push({ day: d.toLocaleDateString(undefined, { weekday: "short" }), hours: 0, ts: d.getTime() });
    }
    for (const it of exams ?? []) {
      const a = it.attempt;
      if (!a) continue;
      const start = new Date(a.startedAt).getTime();
      const end = a.submittedAt ? new Date(a.submittedAt).getTime() : now;
      const startDay = new Date(a.startedAt); startDay.setHours(0, 0, 0, 0);
      const bucket = days.find((d) => d.ts === startDay.getTime());
      if (bucket) bucket.hours += Math.max(0, (end - start) / 3_600_000);
    }
    return days.map((d) => ({ ...d, hours: Math.round(d.hours * 10) / 10 }));
  }, [exams, now]);
  const weekTotalHours = useMemo(() => Math.round(hoursActivity.reduce((s, d) => s + d.hours, 0) * 10) / 10, [hoursActivity]);
  // Real week-over-week comparison — omitted (no pill) when there's no prior-week baseline to compare against.
  const weekOverWeekPct = useMemo(() => {
    if (!exams) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const thisWeekStart = today.getTime() - 6 * 86_400_000;
    const lastWeekStart = thisWeekStart - 7 * 86_400_000;
    let thisWeek = 0, lastWeek = 0;
    for (const it of exams) {
      const a = it.attempt; if (!a) continue;
      const start = new Date(a.startedAt).getTime();
      const end = a.submittedAt ? new Date(a.submittedAt).getTime() : now;
      const hrs = Math.max(0, (end - start) / 3_600_000);
      if (start >= thisWeekStart) thisWeek += hrs;
      else if (start >= lastWeekStart) lastWeek += hrs;
    }
    if (lastWeek <= 0) return null;
    return Math.round(((thisWeek - lastWeek) / lastWeek) * 100);
  }, [exams, now]);

  // ── In Progress list ──
  const inProgressRows = useMemo(() => {
    const list = exams ?? [];
    return activeOnly ? list.filter((it) => it.attempt?.status === "in_progress") : list.slice(0, 8);
  }, [exams, activeOnly]);

  // ── Assignments checklist — every enrolled exam, nearest deadline first ──
  const checklist = useMemo(() => {
    return (exams ?? [])
      .map((it) => {
        const done = it.attempt?.status === "submitted";
        const started = it.attempt?.status === "in_progress";
        const status: "completed" | "in_progress" | "upcoming" = done ? "completed" : started ? "in_progress" : "upcoming";
        const due = it.exam.availableUntil || startIso(it);
        return { it, status, due };
      })
      .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"))
      .slice(0, 6);
  }, [exams]);

  const today = new Date();
  const firstName = user?.name?.split(" ")[0] ?? "";

  return (
    <Shell>
      <div className="fade-in -m-4 sm:-m-6 px-6 py-6 lg:px-10 lg:py-8" style={{ background: BG, fontFamily: FONT, minHeight: "calc(100vh - 69px)" }}>
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-24 rounded-2xl" />
            <Skeleton className="h-56 rounded-2xl" />
            <Skeleton className="h-72 rounded-2xl" />
            <Skeleton className="h-72 rounded-2xl" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* ── Section 1: Greeting + Quick Stats ── */}
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="uppercase" style={{ fontFamily: BARLOW, fontWeight: 700, fontSize: 34, lineHeight: 1.05, color: FG, letterSpacing: "0.01em" }}>
                  {greetingFor(today)}, {firstName}
                </h1>
                <p className="mt-1.5" style={{ fontSize: 13, color: DIM }}>
                  {today.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })} · {todaysSessions.length} session{todaysSessions.length === 1 ? "" : "s"} today
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatPill label="Enrolled" value={summary!.enrolled} />
                <StatPill label="Completed" value={summary!.completed} />
                <StatPill label="Avg Score" value={summary!.avgScore !== null ? `${summary!.avgScore}%` : "—"} />
              </div>
            </div>

            {/* ── Hero banner ── deliberately fixed light card (not theme-tracking) so
                the illustration's white background reads cleanly in both light and
                dark mode — same treatment a bright promotional block gets on any
                site regardless of the page's own theme. ── */}
            <div className="overflow-hidden rounded-2xl" style={{ background: "linear-gradient(135deg, #EAF1FF 0%, #F4F8FF 100%)" }}>
              <div className="grid grid-cols-1 items-center gap-4 px-6 py-8 sm:px-10 sm:py-10 md:grid-cols-[1fr_auto] md:gap-10">
                <div>
                  <h2 className="uppercase" style={{ fontFamily: BARLOW, fontWeight: 700, fontSize: 30, lineHeight: 1.1, color: "#0f172a", letterSpacing: "0.01em" }}>
                    Your Study Toolkit
                  </h2>
                  <p className="mt-2 max-w-sm" style={{ fontSize: 13.5, color: "#475569", lineHeight: 1.6 }}>
                    Everything for this term lives here — track your exams, review results, and jump into your study materials whenever you need them.
                  </p>
                  <Link to="/library" className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold transition hover:opacity-70" style={{ color: "#1d4ed8" }}>
                    Browse the library <ChevronRight className="h-4 w-4" />
                  </Link>
                </div>
                <img src="/Bluen.png" alt="" aria-hidden="true" className="h-[150px] w-auto justify-self-center object-contain sm:h-[190px] md:justify-self-end" />
              </div>
            </div>

            {/* ── Section 2: New Courses ── */}
            <Panel>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <PanelTitle title="New Courses" />
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: DIM }} />
                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search exams…"
                      className="rounded-lg py-1.5 pl-8 pr-3 text-xs outline-none"
                      style={{ background: SURFACE, border: `1px solid ${BORDER}`, color: FG, width: 180 }} />
                  </div>
                  <Link to="/exams" style={{ color: LIME, fontSize: 12 }} className="whitespace-nowrap hover:opacity-70">View all →</Link>
                </div>
              </div>

              {courses.length === 0 ? (
                <p className="mt-6" style={{ color: DIM, fontSize: 12 }}>No exams match your search.</p>
              ) : (
                <>
                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {visibleCourses.map((it, i) => <CourseCard key={it.registration.id} it={it} color={SUBJECT_COLORS[i % SUBJECT_COLORS.length]} />)}
                  </div>
                  {coursePageCount > 1 && (
                    <div className="mt-4 flex items-center justify-center gap-3">
                      <button onClick={() => setCoursePage((p) => Math.max(0, p - 1))} disabled={clampedCoursePage === 0}
                        className="flex h-7 w-7 items-center justify-center rounded-full transition disabled:opacity-30" style={{ border: `1px solid ${BORDER}`, color: FG }}>
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </button>
                      <span style={{ fontFamily: MONO, fontSize: 11, color: DIM }}>{clampedCoursePage + 1} / {coursePageCount}</span>
                      <button onClick={() => setCoursePage((p) => Math.min(coursePageCount - 1, p + 1))} disabled={clampedCoursePage >= coursePageCount - 1}
                        className="flex h-7 w-7 items-center justify-center rounded-full transition disabled:opacity-30" style={{ border: `1px solid ${BORDER}`, color: FG }}>
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </>
              )}
            </Panel>

            {/* ── Section 3: Hours Activity + Today's Schedule ── */}
            <div className="grid grid-cols-1 gap-4 min-[1024px]:grid-cols-[1.6fr_1fr]">
              <Panel>
                <div className="flex items-start justify-between">
                  <PanelTitle title="Hours Activity" sub="Time spent in exams · last 7 days" />
                  {weekOverWeekPct !== null && (
                    <span className="flex items-center gap-1 rounded-md" style={{ fontSize: 10, fontWeight: 600, color: weekOverWeekPct >= 0 ? LIME : DESTRUCTIVE, background: `${weekOverWeekPct >= 0 ? LIME : DESTRUCTIVE}18`, padding: "3px 8px" }}>
                      {weekOverWeekPct >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />} {weekOverWeekPct >= 0 ? "+" : ""}{weekOverWeekPct}% vs last week
                    </span>
                  )}
                </div>
                <p className="mt-3" style={{ fontFamily: BARLOW, fontWeight: 700, fontSize: 40, color: FG, lineHeight: 1 }}>
                  {weekTotalHours}<span style={{ fontSize: 16, color: DIM, fontFamily: FONT, fontWeight: 400 }}> hrs</span>
                </p>
                <div style={{ height: 140, marginTop: 10 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={hoursActivity} margin={{ left: -20, top: 6 }}>
                      <defs>
                        <linearGradient id="hoursGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={LIME} stopOpacity={0.35} /><stop offset="100%" stopColor={LIME} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke={BORDER} strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="day" tick={{ fill: DIM, fontSize: 11, fontFamily: MONO }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ background: SURFACE, border: `1px solid ${LIME}`, borderRadius: 8, fontFamily: MONO, fontSize: 12 }} labelStyle={{ color: FG }}
                        formatter={(v) => [`${v} hrs`, "Time"]} />
                      <Area type="monotone" dataKey="hours" stroke={LIME} strokeWidth={2} fill="url(#hoursGrad)" dot={{ r: 3, fill: LIME }} activeDot={{ r: 5 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </Panel>

              <Panel>
                <PanelTitle title="Today's Schedule" />
                <div className="mt-4 space-y-2">
                  {todaysSessions.length === 0 && <p style={{ color: DIM, fontSize: 12 }}>Nothing scheduled today.</p>}
                  {todaysSessions.slice(0, 4).map((it, i) => {
                    const color = SUBJECT_COLORS[i % SUBJECT_COLORS.length];
                    const d = new Date(startIso(it)!);
                    return (
                      <Link key={it.registration.id} to={`/exams/${it.registration.id}/checkin`}
                        className="group flex items-center gap-3 rounded-xl p-3 transition hover:bg-[var(--card-2)]" style={{ border: `1px solid ${BORDER}` }}>
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: `${color}18` }}>
                          <BookOpen className="h-4 w-4" style={{ color }} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate transition group-hover:text-[#c8f000]" style={{ fontSize: 12.5, fontWeight: 500, color: FG }}>{it.exam.title}</p>
                          <p className="mt-0.5 truncate" style={{ fontFamily: MONO, fontSize: 10.5, color: DIM }}>{it.exam.subject ?? "General"}</p>
                        </div>
                        <span className="shrink-0" style={{ fontFamily: MONO, fontSize: 11, color: DIM }}>
                          {d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0" style={{ color: DIM }} />
                      </Link>
                    );
                  })}
                </div>
              </Panel>
            </div>

            {/* ── Section 4: In Progress + Assignments + Mini Calendar ── */}
            <div className="grid grid-cols-1 gap-4 min-[1024px]:grid-cols-3">
              <Panel>
                <div className="flex items-center justify-between">
                  <PanelTitle title="In Progress" />
                  <div className="flex" style={{ gap: 2 }}>
                    {([["active", "Active"], ["all", "All"]] as const).map(([key, label]) => (
                      <button key={key} onClick={() => setActiveOnly(key === "active")} className="transition"
                        style={{ padding: "4px 10px", borderRadius: 999, fontSize: 11, background: (activeOnly ? "active" : "all") === key ? "rgba(200,240,0,0.12)" : "transparent", color: (activeOnly ? "active" : "all") === key ? LIME : DIM }}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mt-4 space-y-2.5">
                  {inProgressRows.length === 0 && <p style={{ color: DIM, fontSize: 12 }}>{activeOnly ? "Nothing in progress right now." : "No exams yet."}</p>}
                  {inProgressRows.map((it, i) => {
                    const color = SUBJECT_COLORS[i % SUBJECT_COLORS.length];
                    const a = it.attempt;
                    const done = a?.status === "submitted";
                    const active = a?.status === "in_progress";
                    const pct = done ? 100 : active ? Math.min(100, Math.round(((now - new Date(a!.startedAt).getTime()) / 60000 / a!.durationMinutes) * 100)) : 0;
                    const subLabel = done ? `Completed ${ago(a!.submittedAt!)}` : active ? `Started ${ago(a!.startedAt)}` : "Not started";
                    return (
                      <Link key={it.registration.id} to={done && a ? `/attempts/${a.id}/result` : `/exams/${it.registration.id}/checkin`}
                        className="group flex items-center gap-3 rounded-xl p-3 transition hover:bg-[var(--card-2)]" style={{ border: `1px solid ${BORDER}` }}>
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: `${color}18` }}>
                          <BookOpen className="h-4 w-4" style={{ color }} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate transition group-hover:text-[#c8f000]" style={{ fontSize: 12.5, fontWeight: 500, color: FG }}>{it.exam.title}</p>
                          <p className="mt-0.5 truncate" style={{ fontFamily: MONO, fontSize: 10.5, color: DIM }}>{it.exam.subject ?? "General"} · {subLabel}</p>
                          <div className="mt-1.5 h-1 w-full" style={{ background: DEEP, borderRadius: 2 }}>
                            <div className="h-full transition-[width] duration-500" style={{ width: `${pct}%`, background: color, borderRadius: 2 }} />
                          </div>
                        </div>
                        <span className="shrink-0" style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, color }}>{pct}%</span>
                      </Link>
                    );
                  })}
                </div>
              </Panel>

              <Panel>
                <PanelTitle title="Assignments" />
                <div className="mt-4 space-y-2.5">
                  {checklist.length === 0 && <p style={{ color: DIM, fontSize: 12 }}>Nothing due.</p>}
                  {checklist.map(({ it, status, due }) => {
                    const meta = CHECKLIST_META[status];
                    const StatusIcon = meta.icon;
                    return (
                      <Link key={it.registration.id} to={status === "completed" && it.attempt ? `/attempts/${it.attempt.id}/result` : `/exams/${it.registration.id}/checkin`}
                        className="flex items-center gap-3 rounded-xl p-3 transition hover:bg-[var(--card-2)]" style={{ border: `1px solid ${BORDER}` }}>
                        <StatusIcon className="h-4 w-4 shrink-0" style={{ color: meta.color }} />
                        <div className="min-w-0 flex-1">
                          <p className={clsx("truncate", status === "completed" && "line-through")} style={{ fontSize: 12.5, fontWeight: 500, color: status === "completed" ? DIM : FG }}>{it.exam.title}</p>
                          {due && <p className="mt-0.5" style={{ fontFamily: MONO, fontSize: 10.5, color: DIM }}>{new Date(due).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</p>}
                        </div>
                        <span className="shrink-0 px-2 py-1" style={{ fontSize: 10, fontWeight: 600, borderRadius: 999, background: `${meta.color}18`, color: meta.color }}>{meta.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </Panel>

              <MiniCalendar exams={exams!} />
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}

const CHECKLIST_META: Record<"completed" | "in_progress" | "upcoming", { label: string; color: string; icon: typeof CheckCircle2 }> = {
  completed: { label: "Completed", color: LIME, icon: CheckCircle2 },
  in_progress: { label: "In progress", color: AMBER, icon: Clock },
  upcoming: { label: "Upcoming", color: BLUE, icon: Circle },
};

// ── Shared panel shell ──────────────────────────────────────────────────
function Panel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div className="rounded-2xl p-5" style={{ background: CARD, border: `1px solid ${BORDER}`, ...style }}>{children}</div>;
}
function PanelTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div>
      <h2 style={{ color: FG, fontSize: 14, fontWeight: 600 }}>{title}</h2>
      {sub && <p className="mt-0.5" style={{ color: DIM, fontSize: 11 }}>{sub}</p>}
    </div>
  );
}
function StatPill({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl px-4 py-2.5" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
      <p style={{ fontSize: 10, color: DIM, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</p>
      <p style={{ fontFamily: BARLOW, fontWeight: 700, fontSize: 22, color: FG, lineHeight: 1.2 }}>{value}</p>
    </div>
  );
}

// ── New Courses card ─────────────────────────────────────────────────────
function CourseCard({ it, color }: { it: ExamListItem; color: string }) {
  const done = it.attempt?.status === "submitted";
  const active = it.attempt?.status === "in_progress";
  const statusMeta = done ? { label: "Completed", color: LIME } : active ? { label: "In progress", color: AMBER } : { label: "Not started", color: DIM };
  return (
    <Link to={done && it.attempt ? `/attempts/${it.attempt.id}/result` : `/exams/${it.registration.id}/checkin`}
      className="group flex h-[188px] flex-col justify-between rounded-xl p-4 transition hover:-translate-y-0.5"
      style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
      <div>
        <span className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: `${color}18` }}>
          <BookOpen className="h-4 w-4" style={{ color }} />
        </span>
        <p className="mt-3 line-clamp-2 transition group-hover:text-[#c8f000]" style={{ fontSize: 13.5, fontWeight: 600, color: FG, lineHeight: 1.3 }}>{it.exam.title}</p>
        <p className="mt-1" style={{ fontFamily: MONO, fontSize: 10.5, color: DIM }}>{it.exam.subject ?? "General"}</p>
      </div>
      <div className="flex items-center justify-between">
        <span style={{ fontFamily: MONO, fontSize: 10.5, color: DIM }}>
          {it.questionCount ?? "—"} Qs · {it.exam.durationMinutes} min
        </span>
        <span className="px-2 py-0.5" style={{ fontSize: 9.5, fontWeight: 600, borderRadius: 999, background: `${statusMeta.color}18`, color: statusMeta.color }}>{statusMeta.label}</span>
      </div>
    </Link>
  );
}

// ── Mini Calendar ────────────────────────────────────────────────────────
function MiniCalendar({ exams }: { exams: ExamListItem[] }) {
  const today = new Date();
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));

  const byDay = useMemo(() => {
    const map = new Map<string, ExamListItem[]>();
    for (const it of exams) {
      const iso = startIso(it);
      if (!iso) continue;
      const d = new Date(iso);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      map.set(key, [...(map.get(key) ?? []), it]);
    }
    return map;
  }, [exams]);

  const cells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const gridStart = new Date(first);
    gridStart.setDate(1 - first.getDay());
    return Array.from({ length: 35 }, (_, i) => { const d = new Date(gridStart); d.setDate(gridStart.getDate() + i); return d; });
  }, [cursor]);

  const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  return (
    <Panel>
      <div className="flex items-center justify-between">
        <h2 style={{ color: FG, fontSize: 14, fontWeight: 600 }}>{cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h2>
        <div className="flex items-center gap-1">
          <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
            className="flex items-center justify-center transition hover:opacity-70" style={{ width: 24, height: 24, color: DIM }}><ChevronLeft className="h-3.5 w-3.5" /></button>
          <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
            className="flex items-center justify-center transition hover:opacity-70" style={{ width: 24, height: 24, color: DIM }}><ChevronRight className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-7 text-center" style={{ fontFamily: MONO, fontSize: 10.5, color: DIM }}>
        {["S", "M", "T", "W", "T", "F", "S"].map((w, i) => <div key={i}>{w}</div>)}
      </div>
      <div className="mt-1.5 grid grid-cols-7 gap-y-1.5">
        {cells.map((d, i) => {
          const inMonth = d.getMonth() === cursor.getMonth();
          const isToday = sameDay(d, today);
          const has = (byDay.get(key(d))?.length ?? 0) > 0;
          return (
            <Link key={i} to={byDay.get(key(d))?.[0] ? `/exams/${byDay.get(key(d))![0].registration.id}/checkin` : "/calendar"}
              className="flex flex-col items-center justify-center gap-1 transition hover:opacity-80">
              <span className="flex items-center justify-center font-medium transition" style={{ fontFamily: MONO, width: 26, height: 26, borderRadius: "50%", fontSize: 11, background: isToday ? LIME : "transparent", color: isToday ? "#0c0c0c" : has ? LIME : inMonth ? FG : "color-mix(in oklch, var(--muted) 55%, transparent)", fontWeight: isToday ? 700 : 400 }}>
                {d.getDate()}
              </span>
            </Link>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between pt-3" style={{ borderTop: `1px solid ${BORDER}` }}>
        <span className="flex items-center gap-1.5" style={{ fontSize: 11, color: DIM }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: LIME }} /> {[...byDay.values()].reduce((s, v) => s + v.length, 0)} exam day{[...byDay.values()].length === 1 ? "" : "s"}
        </span>
        <Link to="/calendar" style={{ color: LIME, fontSize: 11 }} className="hover:opacity-70">Full calendar →</Link>
      </div>
    </Panel>
  );
}
