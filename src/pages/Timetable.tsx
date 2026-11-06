import { useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  CalendarClock, ShieldAlert, ChevronRight, ChevronLeft, Search, Download,
  MapPin, X, Megaphone, CalendarDays, GraduationCap,
} from "lucide-react";
import { Shell } from "@/components/Shell";
import { Skeleton, EmptyState, ErrorBanner } from "@/components/ui";
import { PageHeader } from "@/components/PageHeader";
import { api } from "@/lib/api";
import type { ExamListItem } from "@shared/types";
import { clsx } from "clsx";

// ── Real fields only ──────────────────────────────────────────────────────
// Oriole's schedule data is exam-based — there's no lecturer/venue/department
// or distinct "class type" concept in the data model, so this view doesn't
// invent one. What genuinely differs per exam: practice vs proctored vs
// regular (color), and registration/attempt status (the pill).
function startIso(it: ExamListItem): string | null {
  return it.registration.scheduledStart || it.exam.availableFrom || null;
}
function sameDay(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function startOfWeek(d: Date) { const x = new Date(d); x.setDate(x.getDate() - x.getDay()); x.setHours(0, 0, 0, 0); return x; }
function eventKind(exam: ExamListItem["exam"]): "practice" | "proctored" | "regular" {
  return exam.practice ? "practice" : exam.proctored ? "proctored" : "regular";
}
const KIND_COLOR: Record<ReturnType<typeof eventKind>, string> = {
  proctored: "#f43f5e",
  practice: "var(--muted)",
  regular: "var(--color-brand-500)",
};
const KIND_LABEL: Record<ReturnType<typeof eventKind>, string> = {
  proctored: "Proctored", practice: "Practice", regular: "Exam",
};

const GRID_START_HOUR = 6;
const GRID_END_HOUR = 22;
const HOUR_PX = 56;
const GRID_HEIGHT = (GRID_END_HOUR - GRID_START_HOUR) * HOUR_PX;

function toIcsStamp(d: Date) { return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z"; }
function exportIcs(items: ExamListItem[]) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Oriole//Timetable//EN"];
  for (const it of items) {
    const iso = startIso(it);
    if (!iso) continue;
    const start = new Date(iso);
    const end = new Date(start.getTime() + it.exam.durationMinutes * 60_000);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${it.registration.id}@oriole`,
      `DTSTAMP:${toIcsStamp(new Date())}`,
      `DTSTART:${toIcsStamp(start)}`,
      `DTEND:${toIcsStamp(end)}`,
      `SUMMARY:${it.exam.title.replace(/\r?\n/g, " ")}`,
      `DESCRIPTION:${(it.exam.subject ?? it.exam.code).replace(/\r?\n/g, " ")}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "oriole-timetable.ics";
  a.click();
  URL.revokeObjectURL(a.href);
}

interface Ann { id: string; title: string; message: string; sentAt: string; priority: string; }

export function Timetable() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ExamListItem[] | null>(null);
  const [anns, setAnns] = useState<Ann[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"week" | "day">("week");
  const [cursor, setCursor] = useState(() => new Date());
  const [search, setSearch] = useState("");
  const [active, setActive] = useState<ExamListItem | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => { api.get<{ items: ExamListItem[] }>("/exams").then((d) => setItems(d.items)).catch((e) => setError(e.message)); }, []);
  useEffect(() => { api.get<{ announcements: Ann[] }>("/announcements").then((d) => setAnns(d.announcements.slice(0, 3))).catch(() => setAnns([])); }, []);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(id); }, []);

  const scheduled = useMemo(() => (items ?? []).filter((it) => startIso(it)), [items]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return scheduled;
    return scheduled.filter((it) =>
      it.exam.title.toLowerCase().includes(q) || it.exam.code.toLowerCase().includes(q) || (it.exam.subject ?? "").toLowerCase().includes(q));
  }, [scheduled, search]);

  const upcoming = useMemo(
    () => [...scheduled].filter((it) => new Date(startIso(it)!).getTime() >= now)
      .sort((a, b) => startIso(a)!.localeCompare(startIso(b)!)).slice(0, 5),
    [scheduled, now],
  );

  const weekStart = useMemo(() => startOfWeek(cursor), [cursor]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d; }), [weekStart]);
  const dayList = view === "week" ? weekDays : [cursor];

  const eventsOn = (day: Date) => filtered.filter((it) => sameDay(new Date(startIso(it)!), day));
  const todaysCount = eventsOn(new Date()).length;

  const step = (dir: 1 | -1) => setCursor((c) => { const d = new Date(c); d.setDate(d.getDate() + dir * (view === "week" ? 7 : 1)); return d; });

  const rangeLabel = view === "week"
    ? `${weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${weekDays[6].toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
    : cursor.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const loading = !items;

  return (
    <Shell>
      <div className="fade-in">
        <PageHeader
          title="Timetable"
          subtitle={loading ? "Your academic schedule at a glance." : todaysCount > 0 ? `You have ${todaysCount} exam${todaysCount === 1 ? "" : "s"} today.` : "Nothing scheduled today — enjoy the free time."}
          actions={
            <>
              <Link to="/calendar" className="btn btn-outline h-9"><CalendarDays className="h-4 w-4" /> Month view</Link>
              <button onClick={() => exportIcs(scheduled)} disabled={scheduled.length === 0} className="btn btn-outline h-9 disabled:opacity-50">
                <Download className="h-4 w-4" /> Export .ics
              </button>
            </>
          }
        />

        {error && <ErrorBanner className="mt-4">{error}</ErrorBanner>}

        {loading ? (
          <div className="mt-4 space-y-3">
            <Skeleton className="h-10 w-full rounded-xl" />
            <Skeleton className="h-[500px] w-full rounded-2xl" />
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_300px]">
            <div className="min-w-0">
              {/* Controls */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button onClick={() => step(-1)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)]"><ChevronLeft className="h-4 w-4" /></button>
                  <button onClick={() => setCursor(new Date())} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--muted)] hover:text-[var(--fg)]">Today</button>
                  <button onClick={() => step(1)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)]"><ChevronRight className="h-4 w-4" /></button>
                  <span className="ml-1 text-sm font-semibold text-[var(--fg)]">{rangeLabel}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted)]" />
                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search course, code, subject…" className="input h-9 w-56 pl-8 text-xs" />
                  </div>
                  <div className="flex rounded-lg border border-[var(--border)] p-0.5">
                    {(["week", "day"] as const).map((v) => (
                      <button key={v} onClick={() => setView(v)}
                        className={clsx("rounded-md px-3 py-1 text-xs font-semibold capitalize transition", view === v ? "bg-brand-500 text-[var(--brand-ink)]" : "text-[var(--muted)] hover:text-[var(--fg)]")}>
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Grid */}
              {filtered.length === 0 ? (
                <EmptyState className="mt-4" icon={CalendarClock} title="No exams scheduled"
                  hint={search ? "No exams match your search." : "Your timetable will fill up here once exams are scheduled."} />
              ) : (
                <div className="card mt-4 overflow-hidden">
                  <div className={clsx("grid border-b border-[var(--border)]", view === "week" ? "grid-cols-[52px_repeat(7,1fr)]" : "grid-cols-[52px_1fr]")}>
                    <div />
                    {dayList.map((d, i) => (
                      <div key={i} className={clsx("border-l border-[var(--border)] px-2 py-2.5 text-center", sameDay(d, new Date()) && "bg-[color-mix(in_oklch,var(--color-brand-500)_8%,transparent)]")}>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">{d.toLocaleDateString(undefined, { weekday: "short" })}</p>
                        <p className={clsx("mt-0.5 text-sm font-bold", sameDay(d, new Date()) ? "text-[var(--lime-text)]" : "text-[var(--fg)]")}>{d.getDate()}</p>
                      </div>
                    ))}
                  </div>

                  <div className="overflow-x-auto">
                    <div className={clsx("relative grid", view === "week" ? "grid-cols-[52px_repeat(7,1fr)]" : "grid-cols-[52px_1fr]")} style={{ minWidth: view === "week" ? 760 : 320 }}>
                      {/* Hour labels */}
                      <div className="relative">
                        {Array.from({ length: GRID_END_HOUR - GRID_START_HOUR }, (_, i) => (
                          <div key={i} className="border-t border-[var(--border)] pr-2 text-right text-[10px] text-[var(--muted)]" style={{ height: HOUR_PX }}>
                            <span className="relative -top-2 block">{String(GRID_START_HOUR + i).padStart(2, "0")}:00</span>
                          </div>
                        ))}
                      </div>

                      {/* Day columns */}
                      {dayList.map((day, di) => {
                        const dayEvents = eventsOn(day);
                        const isToday = sameDay(day, new Date());
                        const nowMin = (now - new Date(day).setHours(0, 0, 0, 0)) / 60_000;
                        const nowTop = ((nowMin / 60) - GRID_START_HOUR) * HOUR_PX;
                        return (
                          <div key={di} className="relative border-l border-[var(--border)]" style={{ height: GRID_HEIGHT }}>
                            {Array.from({ length: GRID_END_HOUR - GRID_START_HOUR }, (_, i) => (
                              <div key={i} className="border-t border-[var(--border)]" style={{ height: HOUR_PX }} />
                            ))}
                            {isToday && nowTop >= 0 && nowTop <= GRID_HEIGHT && (
                              <div className="absolute inset-x-0 z-10 flex items-center" style={{ top: nowTop }}>
                                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" />
                                <span className="h-px flex-1 bg-rose-500" />
                              </div>
                            )}
                            {dayEvents.map((it) => {
                              const iso = startIso(it)!;
                              const d = new Date(iso);
                              const startMin = d.getHours() * 60 + d.getMinutes();
                              const top = Math.max(0, ((startMin / 60) - GRID_START_HOUR) * HOUR_PX);
                              const height = Math.max(24, Math.min((it.exam.durationMinutes / 60) * HOUR_PX, GRID_HEIGHT - top));
                              const kind = eventKind(it.exam);
                              const color = KIND_COLOR[kind];
                              return (
                                <button key={it.registration.id} onClick={() => setActive(it)}
                                  className="absolute left-1 right-1 overflow-hidden rounded-lg px-2 py-1 text-left transition hover:brightness-95"
                                  style={{ top, height, background: `color-mix(in oklch, ${color} 16%, var(--card))`, borderLeft: `3px solid ${color}` }}>
                                  <p className="truncate text-[11px] font-bold leading-tight text-[var(--fg)]">{it.exam.title}</p>
                                  <p className="truncate text-[10px] text-[var(--muted)]">{d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</p>
                                </button>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Right rail */}
            <div className="space-y-4">
              <div className="card p-4">
                <p className="text-sm font-bold">Upcoming</p>
                <div className="mt-3 space-y-2">
                  {upcoming.length === 0 && <p className="text-xs text-[var(--muted)]">Nothing coming up.</p>}
                  {upcoming.map((it) => {
                    const d = new Date(startIso(it)!);
                    const color = KIND_COLOR[eventKind(it.exam)];
                    return (
                      <button key={it.registration.id} onClick={() => setActive(it)}
                        className="flex w-full items-center gap-2.5 rounded-lg p-2 text-left transition hover:bg-[var(--card-2)]">
                        <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: color }} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-[var(--fg)]">{it.exam.title}</p>
                          <p className="truncate text-[11px] text-[var(--muted)]">{d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="card p-4">
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-1.5 text-sm font-bold"><Megaphone className="h-4 w-4 text-[var(--lime-text)]" /> Announcements</p>
                  <Link to="/announcements" className="text-[11px] font-semibold text-[var(--lime-text)] hover:underline">View all</Link>
                </div>
                <div className="mt-3 space-y-2.5">
                  {anns && anns.length === 0 && <p className="text-xs text-[var(--muted)]">No announcements yet.</p>}
                  {(anns ?? []).map((a) => (
                    <div key={a.id}>
                      <p className="truncate text-xs font-semibold text-[var(--fg)]">{a.title}</p>
                      <p className="line-clamp-2 text-[11px] text-[var(--muted)]">{a.message}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card p-4">
                <p className="mb-3 text-sm font-bold">Legend</p>
                <div className="space-y-1.5">
                  {(Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[]).map((k) => (
                    <div key={k} className="flex items-center gap-2 text-xs text-[var(--muted)]">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: KIND_COLOR[k] }} /> {KIND_LABEL[k]}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {active && <EventModal it={active} onClose={() => setActive(null)} onNavigate={(to) => navigate(to)} />}
    </Shell>
  );
}

function EventModal({ it, onClose, onNavigate }: { it: ExamListItem; onClose: () => void; onNavigate: (to: string) => void }) {
  const iso = startIso(it)!;
  const d = new Date(iso);
  const done = it.attempt?.status === "submitted";
  const ready = it.registration.approval === "confirmed" && it.registration.systemCheckPassed;
  const kind = eventKind(it.exam);
  const color = KIND_COLOR[kind];
  const statusMeta = done ? { label: "Completed", bg: "rgba(14,165,233,0.15)", color: "#0EA5E9" }
    : ready ? { label: "Ready", bg: "rgba(22,163,74,0.15)", color: "#16A34A" }
    : { label: "Setup needed", bg: "rgba(233,185,73,0.15)", color: "#E9B949" };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 p-5" style={{ background: `color-mix(in oklch, ${color} 10%, transparent)`, borderBottom: `1px solid color-mix(in oklch, ${color} 25%, transparent)` }}>
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ background: `color-mix(in oklch, ${color} 18%, transparent)`, color }}>
              {kind === "proctored" && <ShieldAlert className="h-3 w-3" />} {KIND_LABEL[kind]}
            </span>
            <h2 className="mt-2 text-lg font-bold leading-tight text-[var(--fg)]">{it.exam.title}</h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">{it.exam.code}{it.exam.subject ? ` · ${it.exam.subject}` : ""}</p>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-lg p-1.5 text-[var(--muted)] hover:bg-white/[0.05]"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-5">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Date</p>
              <p className="mt-0.5 font-medium text-[var(--fg)]">{d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Time</p>
              <p className="mt-0.5 font-medium text-[var(--fg)]">{d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} · {it.exam.durationMinutes} min</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Status</p>
              <span className="mt-0.5 inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: statusMeta.bg, color: statusMeta.color }}>{statusMeta.label}</span>
            </div>
            {it.exam.proctored && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Proctoring</p>
                <p className="mt-0.5 flex items-center gap-1 font-medium text-[var(--fg)]"><ShieldAlert className="h-3.5 w-3.5" /> Required</p>
              </div>
            )}
          </div>

          <div className="mt-5 flex items-center justify-end gap-2">
            <button onClick={onClose} className="btn btn-outline h-9">Close</button>
            <button onClick={() => onNavigate(done && it.attempt ? `/attempts/${it.attempt.id}/result` : `/exams/${it.registration.id}/checkin`)} className="btn btn-primary h-9">
              {done ? <><GraduationCap className="h-4 w-4" /> View Result</> : <><MapPin className="h-4 w-4" /> Check In</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
