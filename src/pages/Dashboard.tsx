import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  BookOpen, CalendarCheck, FileClock, TrendingUp, Flame, ChevronRight, ChevronLeft,
  Clock, MonitorCheck, CalendarDays, Bell, CheckCircle2, Megaphone, ClipboardCheck, FileText,
  Dumbbell, History, Library, MessageCircle, BarChart3,
} from "lucide-react";
import { Shell } from "@/components/Shell";
import { Skeleton } from "@/components/ui";
import { SegmentDonut } from "@/components/Charts";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import type { ExamListItem } from "@shared/types";
import { clsx } from "clsx";

const LIME = "#c6ff34";
const PINK = "#fe3bed";
const BLUE = "#0EA5E9";
const AMBER = "#E9B949";

interface Summary { enrolled: number; completed: number; pending: number; awaitingApproval: number; avgScore: number | null; passed: number; streak: number; }
interface Notif { id: string; type: string; title: string; body: string; at: string; link: string; }

function startIso(it: ExamListItem): string | null {
  return it.registration.scheduledStart || it.exam.availableFrom || null;
}
function fmtDate(iso: string | null) {
  if (!iso) return "TBD";
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
function daysLeft(iso: string, now: number) {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 86_400_000));
}
function ago(iso: string) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  const m = s / 60; if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60; if (h < 24) return `${Math.floor(h)}h ago`;
  const d = h / 24; if (d < 7) return `${Math.floor(d)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
function initials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

const NOTIF_ICON: Record<string, typeof Bell> = { result: CheckCircle2, reminder: Clock, announcement: Megaphone, grading: ClipboardCheck, submission: FileText };
const NOTIF_TINT: Record<string, string> = { result: "#16A34A", reminder: LIME, announcement: BLUE, grading: AMBER, submission: LIME };

export function Dashboard() {
  const { user } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [exams, setExams] = useState<ExamListItem[] | null>(null);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    api.get<Summary>("/my/summary").then(setSummary).catch(() => {});
    api.get<{ items: ExamListItem[] }>("/exams").then((d) => setExams(d.items)).catch(() => setExams([]));
    api.get<{ notifications: Notif[] }>("/notifications").then((d) => setNotifs(d.notifications)).catch(() => {});
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const upcoming = useMemo(() => {
    if (!exams) return [];
    return exams
      .filter((it) => it.attempt?.status !== "submitted" && startIso(it) && new Date(startIso(it)!).getTime() > now)
      .sort((a, b) => startIso(a)!.localeCompare(startIso(b)!));
  }, [exams, now]);

  const upcomingWithin7d = useMemo(() => upcoming.filter((it) => daysLeft(startIso(it)!, now) <= 7).length, [upcoming, now]);

  const myExams = useMemo(() => {
    if (!exams) return [];
    return [...exams].sort((a, b) => (startIso(a) ?? "9999").localeCompare(startIso(b) ?? "9999")).slice(0, 5);
  }, [exams]);

  const progress = useMemo(() => {
    if (!exams) return { completed: 0, inProgress: 0, notStarted: 0, total: 0 };
    const completed = exams.filter((it) => it.attempt?.status === "submitted").length;
    const inProgress = exams.filter((it) => it.attempt?.status === "in_progress").length;
    const notStarted = exams.length - completed - inProgress;
    return { completed, inProgress, notStarted, total: exams.length };
  }, [exams]);

  const isReady = (it: ExamListItem) => it.registration.approval === "confirmed" && it.registration.systemCheckPassed;
  const setupNeeded = upcoming.find((it) => !isReady(it));

  const firstName = user?.name?.split(" ")[0] ?? "Student";
  const greeting = now < 0 ? "" : new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 18 ? "Good afternoon" : "Good evening";

  const loading = !summary || !exams;

  return (
    <Shell>
      <div className="fade-in">
        {loading ? (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
            </div>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-80 rounded-2xl" />)}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-5">

            {/* Header */}
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-[var(--fg)] sm:text-3xl">{greeting}, {firstName}! 👋</h1>
                <p className="mt-1 text-sm text-[var(--muted)]">Here's what's happening with your exams today.</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-[#111110]" style={{ background: LIME }}>
                {initials(user?.name ?? "S")}
              </div>
            </div>

            {/* Action-required banner */}
            {setupNeeded && (
              <Link to={`/exams/${setupNeeded.registration.id}/checkin`}
                className="flex flex-wrap items-center gap-4 rounded-2xl border-2 p-4 transition hover:opacity-90"
                style={{ borderColor: PINK, background: `${PINK}12` }}>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ background: PINK }}>
                  <Clock className="h-5 w-5 text-black" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-[var(--fg)]">System check required — {setupNeeded.exam.title}</p>
                  <p className="text-xs text-[var(--muted)]">Complete your browser & webcam check before {fmtDate(startIso(setupNeeded))}.</p>
                </div>
                <span className="flex shrink-0 items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold" style={{ background: PINK, color: "#000" }}>
                  <MonitorCheck className="h-4 w-4" /> Run check
                </span>
              </Link>
            )}

            {/* Stat row */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              <StatTile icon={BookOpen} color={LIME} label="Enrolled Exams" value={summary!.enrolled} sub="Active exams" linkTo="/exams" linkLabel="View all exams" />
              <StatTile icon={CalendarCheck} color={BLUE} label="Upcoming" value={upcomingWithin7d} sub="In the next 7 days" linkTo="/timetable" linkLabel="View schedule" />
              <StatTile icon={FileClock} color={AMBER} label="Pending" value={summary!.pending} sub="Awaiting completion" linkTo="/exams" linkLabel="View exams" />
              <StatTile icon={TrendingUp} color={LIME} label="Average Score" value={summary!.avgScore !== null ? `${summary!.avgScore}%` : "—"} sub="Across all exams" linkTo="/results" linkLabel="View results" />
              <StatTile icon={Flame} color={PINK} label="Day Streak" value={summary!.streak} sub="Keep it going" linkTo="/results" linkLabel="View badges" />
            </div>

            {/* Row 2: My Exams / Upcoming Exams / Calendar */}
            <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-3">
              <Panel title="My Exams" linkTo="/exams" linkLabel="View all">
                {myExams.length === 0 ? (
                  <EmptyRow icon={BookOpen} text="No exams yet." />
                ) : (
                  <div className="space-y-1">
                    {myExams.map((it) => <MyExamRow key={it.registration.id} it={it} />)}
                  </div>
                )}
              </Panel>

              <Panel title="Upcoming Exams" linkTo="/timetable" linkLabel="View all">
                {upcoming.length === 0 ? (
                  <EmptyRow icon={CalendarDays} text="Nothing scheduled." />
                ) : (
                  <div className="space-y-2.5">
                    {upcoming.slice(0, 3).map((it) => <UpcomingRow key={it.registration.id} it={it} now={now} />)}
                  </div>
                )}
              </Panel>

              <MiniCalendar exams={exams ?? []} />
            </div>

            {/* Row 3: Recent Activity / Study Progress / Quick Actions */}
            <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-3">
              <Panel title="Recent Activity" linkTo="/inbox" linkLabel="View all">
                {notifs.length === 0 ? (
                  <EmptyRow icon={Bell} text="Nothing new." />
                ) : (
                  <div className="space-y-3">
                    {notifs.slice(0, 4).map((n) => {
                      const Icon = NOTIF_ICON[n.type] ?? Bell;
                      const tint = NOTIF_TINT[n.type] ?? LIME;
                      return (
                        <Link key={n.id} to={n.link} className="flex items-start gap-2.5 rounded-xl p-1.5 transition hover:bg-[var(--card-2)]">
                          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: `${tint}20` }}>
                            <Icon className="h-3.5 w-3.5" style={{ color: tint }} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-semibold text-[var(--fg)]">{n.title}</p>
                            <p className="text-[10px] text-[var(--muted)]">{ago(n.at)}</p>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </Panel>

              <Panel title="Study Progress" linkTo="/results" linkLabel="View analytics">
                <div className="flex items-center gap-5">
                  <SegmentDonut
                    size={110} thickness={12}
                    segments={[
                      { value: progress.completed, color: LIME },
                      { value: progress.inProgress, color: BLUE },
                      { value: progress.notStarted, color: "var(--card-2)" },
                    ]}
                    centerTop="Overall"
                    centerMain={progress.total ? `${Math.round((progress.completed / progress.total) * 100)}%` : "—"}
                  />
                  <div className="space-y-2 text-xs">
                    <LegendRow color={LIME} label="Completed" value={progress.completed} />
                    <LegendRow color={BLUE} label="In Progress" value={progress.inProgress} />
                    <LegendRow color="var(--muted)" label="Not Started" value={progress.notStarted} />
                  </div>
                </div>
                {summary!.streak > 0 && (
                  <div className="mt-4 flex items-center gap-2 rounded-xl p-3" style={{ background: `${LIME}15` }}>
                    <Flame className="h-4 w-4 shrink-0" style={{ color: LIME }} />
                    <p className="text-xs font-bold" style={{ color: LIME }}>{summary!.streak}-day streak — keep it up!</p>
                  </div>
                )}
              </Panel>

              <Panel title="Quick Actions">
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: "Take an Exam", icon: BookOpen, to: "/exams", color: LIME },
                    { label: "View Results", icon: BarChart3, to: "/results", color: BLUE },
                    { label: "Practice Test", icon: Dumbbell, to: "/practice", color: PINK },
                    { label: "Visit Library", icon: Library, to: "/library", color: LIME },
                    { label: "Chat", icon: MessageCircle, to: "/chat", color: BLUE },
                    { label: "Timetable", icon: History, to: "/timetable", color: PINK },
                  ].map((q) => (
                    <Link key={q.label} to={q.to}
                      className="flex flex-col items-center gap-2 rounded-xl border border-[var(--border)] p-3 text-center text-[11px] font-semibold text-[var(--fg)] transition hover:-translate-y-0.5 hover:border-[var(--border-strong)]"
                      style={{ background: `${q.color}0f` }}>
                      <q.icon className="h-5 w-5" style={{ color: q.color }} />
                      {q.label}
                    </Link>
                  ))}
                </div>
              </Panel>
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}

// ── Stat tile ──────────────────────────────────────────────────────────────
function StatTile({ icon: Icon, color, label, value, sub, linkTo, linkLabel }: {
  icon: typeof BookOpen; color: string; label: string; value: string | number; sub: string; linkTo: string; linkLabel: string;
}) {
  return (
    <div className="card flex flex-col gap-3 rounded-2xl p-4">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: `${color}20` }}>
        <Icon className="h-[18px] w-[18px]" style={{ color }} />
      </span>
      <div>
        <p className="text-[11px] font-medium text-[var(--muted)]">{label}</p>
        <p className="text-2xl font-bold leading-tight text-[var(--fg)]">{value}</p>
        <p className="text-[10px] text-[var(--muted)]">{sub}</p>
      </div>
      <Link to={linkTo} className="mt-auto flex items-center gap-1 text-[11px] font-semibold hover:underline" style={{ color }}>
        {linkLabel} <ChevronRight className="h-3 w-3" />
      </Link>
    </div>
  );
}

// ── Panel wrapper ─────────────────────────────────────────────────────────
function Panel({ title, linkTo, linkLabel, children }: { title: string; linkTo?: string; linkLabel?: string; children: ReactNode }) {
  return (
    <div className="card rounded-2xl p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-[var(--fg)]">{title}</h2>
        {linkTo && (
          <Link to={linkTo} className="flex items-center gap-1 text-xs font-semibold hover:underline" style={{ color: LIME }}>
            {linkLabel} <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function EmptyRow({ icon: Icon, text }: { icon: typeof BookOpen; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <Icon className="h-6 w-6 text-[var(--muted)]" />
      <p className="text-xs text-[var(--muted)]">{text}</p>
    </div>
  );
}

function LegendRow({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
      <span className="text-[var(--muted)]">{label}</span>
      <span className="font-bold text-[var(--fg)]">{value}</span>
    </div>
  );
}

// ── My Exams row (status-accurate: score / progress / not started) ────────
function MyExamRow({ it }: { it: ExamListItem }) {
  const done = it.attempt?.status === "submitted";
  const active = it.attempt?.status === "in_progress";
  const pct = done ? (it.attempt?.score ?? 0) : active ? 50 : 0;
  const barColor = done ? LIME : active ? BLUE : "var(--card-2)";
  return (
    <Link to={done && it.attempt ? `/attempts/${it.attempt.id}/result` : `/exams/${it.registration.id}/checkin`}
      className="flex items-center gap-3 rounded-xl p-2 transition hover:bg-[var(--card-2)]">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: "rgba(198,255,52,0.14)" }}>
        <BookOpen className="h-4 w-4" style={{ color: LIME }} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-bold text-[var(--fg)]">{it.exam.title}</p>
        <p className="truncate text-[10px] text-[var(--muted)]">{it.exam.code}</p>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--card-2)]">
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: barColor }} />
        </div>
      </div>
      <span className="shrink-0 text-[11px] font-bold text-[var(--muted)]">
        {done ? `${it.attempt?.score ?? 0}%` : active ? "In progress" : "Not started"}
      </span>
    </Link>
  );
}

// ── Upcoming exam row ───────────────────────────────────────────────────────
function UpcomingRow({ it, now }: { it: ExamListItem; now: number }) {
  const iso = startIso(it)!;
  const d = new Date(iso);
  const left = daysLeft(iso, now);
  return (
    <Link to={`/exams/${it.registration.id}/checkin`} className="flex items-center gap-3 rounded-xl p-2 transition hover:bg-[var(--card-2)]">
      <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg border border-[var(--border)]">
        <span className="text-[9px] font-bold uppercase text-[var(--muted)]">{d.toLocaleDateString(undefined, { month: "short" })}</span>
        <span className="text-sm font-bold text-[var(--fg)]">{d.getDate()}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-bold text-[var(--fg)]">{it.exam.title}</p>
        <p className="truncate text-[10px] text-[var(--muted)]">{it.exam.code} · {fmtDate(iso)}</p>
      </div>
      <span className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold" style={{ background: `${LIME}20`, color: LIME }}>
        {left === 0 ? "Today" : `${left}d left`}
      </span>
    </Link>
  );
}

// ── Compact mini calendar (dashboard widget — not the full Calendar page) ──
function MiniCalendar({ exams }: { exams: ExamListItem[] }) {
  const navigate = useNavigate();
  const today = new Date();
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState<Date | null>(today);

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
    return Array.from({ length: 35 }, (_, i) => {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      return d;
    });
  }, [cursor]);

  const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const selectedItems = selected ? byDay.get(key(selected)) ?? [] : [];

  return (
    <div className="card rounded-2xl p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-[var(--fg)]">{cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h2>
        <div className="flex items-center gap-1">
          <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--card-2)]"><ChevronLeft className="h-3.5 w-3.5" /></button>
          <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--card-2)]"><ChevronRight className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[9px] font-semibold uppercase text-[var(--muted)]">
        {["S", "M", "T", "W", "T", "F", "S"].map((w, i) => <div key={i}>{w}</div>)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          const inMonth = d.getMonth() === cursor.getMonth();
          const isToday = sameDay(d, today);
          const isSel = selected && sameDay(d, selected);
          const has = (byDay.get(key(d))?.length ?? 0) > 0;
          return (
            <button key={i} onClick={() => setSelected(d)}
              className={clsx("flex h-7 flex-col items-center justify-center gap-0.5 rounded-md text-[10px] transition",
                isSel ? "bg-[var(--card-2)]" : "hover:bg-[var(--card-2)]",
                !inMonth && "opacity-30")}>
              <span className={clsx("flex h-5 w-5 items-center justify-center rounded-full font-semibold", isToday ? "text-[#111110]" : "text-[var(--fg)]")}
                style={isToday ? { background: LIME } : undefined}>
                {d.getDate()}
              </span>
              {has && <span className="h-1 w-1 rounded-full" style={{ background: isToday ? LIME : PINK }} />}
            </button>
          );
        })}
      </div>
      <div className="mt-3 border-t border-[var(--border)] pt-3">
        {selectedItems.length === 0 ? (
          <p className="text-xs text-[var(--muted)]">{selected ? "Nothing scheduled." : "Select a day."}</p>
        ) : (
          <div className="space-y-1.5">
            {selectedItems.map((it) => (
              <button key={it.registration.id} onClick={() => navigate(`/exams/${it.registration.id}/checkin`)}
                className="flex w-full items-center gap-2 rounded-lg p-1.5 text-left transition hover:bg-[var(--card-2)]">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: LIME }} />
                <span className="truncate text-xs font-medium text-[var(--fg)]">{it.exam.title}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <Link to="/calendar" className="mt-3 flex items-center gap-1 text-xs font-semibold hover:underline" style={{ color: LIME }}>
        View full calendar <ChevronRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
