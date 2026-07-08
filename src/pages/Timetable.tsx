import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarClock, Clock, ShieldAlert, ChevronRight } from "lucide-react";
import { Shell } from "@/components/Shell";
import { Skeleton, EmptyState } from "@/components/ui";
import { PageHeader } from "@/components/PageHeader";
import { api } from "@/lib/api";
import type { ExamListItem } from "@shared/types";

function startIso(it: ExamListItem): string | null {
  return it.registration.scheduledStart || it.exam.availableFrom || null;
}
function dayKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function dayLabel(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}
function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

// Same schedule data as Calendar, but as a chronological day-by-day agenda
// instead of a month grid — "what do I have and when" rather than "what does
// the month look like at a glance".
export function Timetable() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ExamListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.get<{ items: ExamListItem[] }>("/exams").then((d) => setItems(d.items)).catch((e) => setError(e.message)); }, []);

  const days = useMemo(() => {
    if (!items) return [];
    const scheduled = items.filter((it) => startIso(it));
    scheduled.sort((a, b) => startIso(a)!.localeCompare(startIso(b)!));
    const map = new Map<string, { label: string; items: ExamListItem[] }>();
    for (const it of scheduled) {
      const iso = startIso(it)!;
      const key = dayKey(iso);
      const g = map.get(key) ?? { label: dayLabel(iso), items: [] };
      g.items.push(it);
      map.set(key, g);
    }
    return [...map.values()];
  }, [items]);

  return (
    <Shell>
      <div className="fade-in max-w-2xl">
        <PageHeader title="Timetable" subtitle="Your exam schedule, day by day." />

        {error && <p className="mt-6 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</p>}

        {!items && !error && (
          <div className="mt-6 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="card p-5"><Skeleton className="h-4 w-1/3" /><Skeleton className="mt-3 h-3 w-full" /></div>
            ))}
          </div>
        )}

        {items && (
          days.length === 0 ? (
            <EmptyState className="mt-6" icon={CalendarClock} title="Nothing scheduled" hint="Your exam timetable will show up here once dates are set." />
          ) : (
            <div className="mt-6 space-y-6">
              {days.map((day) => (
                <div key={day.label}>
                  <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--muted)]">{day.label}</h2>
                  <div className="card mt-2 divide-y divide-[var(--border)] overflow-hidden">
                    {day.items.map((it) => {
                      const iso = startIso(it)!;
                      const done = it.attempt?.status === "submitted";
                      const ready = it.registration.approval === "confirmed" && it.registration.systemCheckPassed;
                      return (
                        <button key={it.registration.id}
                          onClick={() => navigate(done && it.attempt ? `/attempts/${it.attempt.id}/result` : `/exams/${it.registration.id}/checkin`)}
                          className="flex w-full items-center gap-3 p-4 text-left transition hover:bg-[var(--card-2)]">
                          <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg" style={{ background: "rgba(198,255,52,0.14)" }}>
                            <Clock className="h-4 w-4" style={{ color: "#c6ff34" }} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-bold text-[var(--fg)]">{it.exam.title}</p>
                            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--muted)]">
                              <span>{timeLabel(iso)} · {it.exam.durationMinutes} min</span>
                              {it.exam.proctored && <span className="flex items-center gap-1"><ShieldAlert className="h-3 w-3" /> Proctored</span>}
                            </p>
                          </div>
                          <span className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold"
                            style={{ background: done ? "rgba(14,165,233,0.15)" : ready ? "rgba(22,163,74,0.15)" : "rgba(233,185,73,0.15)", color: done ? "#0EA5E9" : ready ? "#16A34A" : "#E9B949" }}>
                            {done ? "Completed" : ready ? "Ready" : "Setup needed"}
                          </span>
                          <ChevronRight className="h-4 w-4 shrink-0 text-[var(--muted)]" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </Shell>
  );
}
