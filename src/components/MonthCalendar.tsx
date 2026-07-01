import { useMemo, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { clsx } from "clsx";

export interface CalEvent {
  id: string;
  date: Date;
  title: string;
  sub?: string;
  color: string;       // hex accent for the event
  onClick?: () => void;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);

/** Reusable month grid. Pass events with a Date; the grid plots them on their day. */
export function MonthCalendar({ events, empty }: { events: CalEvent[]; empty?: ReactNode }) {
  const today = new Date();
  const [cursor, setCursor] = useState(() => startOfMonth(events[0]?.date ?? today));
  const [selected, setSelected] = useState<Date | null>(null);

  const cells = useMemo(() => {
    const first = startOfMonth(cursor);
    const gridStart = new Date(first);
    gridStart.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + i);
      return date;
    });
  }, [cursor]);

  const eventsOn = (d: Date) => events.filter((e) => sameDay(e.date, d));
  const monthLabel = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const selectedEvents = selected ? eventsOn(selected) : [];

  return (
    <div className="card rounded-2xl p-4 sm:p-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold">{monthLabel}</h2>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)]"><ChevronLeft className="h-4 w-4" /></button>
          <button onClick={() => { setCursor(startOfMonth(today)); setSelected(null); }} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--muted)] hover:text-[var(--fg)]">Today</button>
          <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} className="flex h-8 w-8 items-center justify-center rounded-lg text-white" style={{ background: "#111110" }}><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>

      {/* Weekday row */}
      <div className="mt-4 grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
        {WEEKDAYS.map((w) => <div key={w} className="py-1">{w}</div>)}
      </div>

      {/* Day grid */}
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((date, i) => {
          const inMonth = date.getMonth() === cursor.getMonth();
          const isToday = sameDay(date, today);
          const isSel = selected && sameDay(date, selected);
          const dayEvents = eventsOn(date);
          return (
            <button key={i} onClick={() => setSelected(date)}
              className={clsx("flex min-h-[78px] flex-col gap-1 rounded-lg border p-1.5 text-left transition",
                isSel ? "border-[#c6ff34] bg-[var(--card-2)]" : "border-[var(--border)] hover:bg-[var(--card-2)]",
                !inMonth && "opacity-40")}>
              <span className={clsx("flex h-5 w-5 items-center justify-center self-start rounded-full text-[11px] font-semibold",
                isToday ? "bg-[#c6ff34] text-[#111110]" : "text-[var(--muted)]")}>{date.getDate()}</span>
              <div className="space-y-0.5">
                {dayEvents.slice(0, 2).map((e) => (
                  <span key={e.id} onClick={(ev) => { ev.stopPropagation(); e.onClick?.(); }}
                    className="block truncate rounded px-1 py-0.5 text-[10px] font-medium" style={{ background: `${e.color}22`, color: e.color }} title={e.title}>
                    {e.title}
                  </span>
                ))}
                {dayEvents.length > 2 && <span className="block px-1 text-[10px] text-[var(--muted)]">+{dayEvents.length - 2} more</span>}
              </div>
            </button>
          );
        })}
      </div>

      {/* Selected day detail */}
      {selected && (
        <div className="mt-4 border-t border-[var(--border)] pt-3">
          <p className="text-xs font-semibold text-[var(--muted)]">{selected.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</p>
          <div className="mt-2 space-y-1.5">
            {selectedEvents.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">{empty ?? "Nothing scheduled on this day."}</p>
            ) : selectedEvents.map((e) => (
              <button key={e.id} onClick={() => e.onClick?.()} className="flex w-full items-center gap-2.5 rounded-lg border border-[var(--border)] p-2.5 text-left transition hover:bg-[var(--card-2)]">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: e.color }} />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{e.title}</span>{e.sub && <span className="block truncate text-xs text-[var(--muted)]">{e.sub}</span>}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
