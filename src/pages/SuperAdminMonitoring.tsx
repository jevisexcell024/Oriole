import { useEffect, useState } from "react";
import { Radio, Users, BookOpen, Clock, Building2, AlarmClock, Search } from "lucide-react";
import { SuperAdminShell } from "@/components/SuperAdminShell";
import { PageHeader } from "@/components/PageHeader";
import { TableSkeleton, ErrorBanner } from "@/components/ui";
import { api } from "@/lib/api";
import { clsx } from "clsx";

interface Session { attemptId: string; tenantName: string; examTitle: string; candidateName: string; startedAt: string; deadline: string; }
interface Monitoring { sessions: Session[]; activeUserCount: number; activeExamCount: number; }

const ENDING_SOON_MS = 15 * 60_000;

function minutesLeft(deadlineIso: string): number {
  return (new Date(deadlineIso).getTime() - Date.now()) / 60_000;
}
function fmtRemaining(deadlineIso: string): string {
  const mins = minutesLeft(deadlineIso);
  if (mins <= 0) return "overdue";
  const h = Math.floor(mins / 60), m = Math.floor(mins % 60);
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
}

function StatTile({ icon: Icon, label, value }: { icon: typeof Radio; label: string; value: number }) {
  return (
    <div className="card flex items-center gap-3 p-4">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#c6ff34]/10 text-[#c6ff34]"><Icon className="h-5 w-5" /></div>
      <div>
        <p className="text-2xl font-bold tabular-nums">{value}</p>
        <p className="text-xs text-[var(--muted)]">{label}</p>
      </div>
    </div>
  );
}

type SessionFilter = "all" | "ending-soon";

export function SuperAdminMonitoring() {
  const [data, setData] = useState<Monitoring | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const [filter, setFilter] = useState<SessionFilter>("all");
  const [search, setSearch] = useState("");

  const load = () => api.get<Monitoring>("/super-admin/monitoring").then(setData).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    const poll = setInterval(load, 15_000);
    const clock = setInterval(() => setTick((t) => t + 1), 30_000); // re-render remaining-time text
    return () => { clearInterval(poll); clearInterval(clock); };
  }, []);

  const schoolsActive = new Set((data?.sessions ?? []).map((s) => s.tenantName)).size;
  const endingSoonCount = (data?.sessions ?? []).filter((s) => minutesLeft(s.deadline) > 0 && minutesLeft(s.deadline) * 60_000 <= ENDING_SOON_MS).length;
  const q = search.trim().toLowerCase();
  const visible = (data?.sessions ?? [])
    .filter((s) => filter === "all" || (minutesLeft(s.deadline) > 0 && minutesLeft(s.deadline) * 60_000 <= ENDING_SOON_MS))
    .filter((s) => !q || s.tenantName.toLowerCase().includes(q) || s.examTitle.toLowerCase().includes(q) || s.candidateName.toLowerCase().includes(q));

  return (
    <SuperAdminShell>
      <div className="fade-in max-w-5xl">
        <PageHeader eyebrow="Platform" title="Live Platform" subtitle="Every candidate currently mid-exam, across every school at once — a tenant admin can only ever see their own school's live sessions." />

        {error && <ErrorBanner className="mt-4">{error}</ErrorBanner>}

        {!data ? (
          <div className="mt-6"><TableSkeleton rows={3} cells={3} /></div>
        ) : (
          <>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
              <StatTile icon={Radio} label="Live sessions" value={data.sessions.length} />
              <StatTile icon={Users} label="Active students" value={data.activeUserCount} />
              <StatTile icon={BookOpen} label="Active exams" value={data.activeExamCount} />
              <StatTile icon={Building2} label="Schools active" value={schoolsActive} />
              <StatTile icon={AlarmClock} label="Ending in 15 min" value={endingSoonCount} />
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-1 border-b border-[var(--border)]">
                {([["all", "All sessions"], ["ending-soon", "Ending soon"]] as [SessionFilter, string][]).map(([f, label]) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={clsx(
                      "border-b-2 px-3 py-2 text-sm font-medium",
                      filter === f ? "border-[#c6ff34] text-[var(--fg)]" : "border-transparent text-[var(--muted)] hover:text-[var(--fg)]",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted)]" />
                <input className="input h-9 w-56 pl-8 text-sm" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search school, exam, student..." />
              </div>
            </div>

            <div className="card mt-3 overflow-hidden">
              {data.sessions.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-[var(--muted)]">No one is currently taking an exam.</p>
              ) : visible.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-[var(--muted)]">No sessions match this filter.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
                        <th className="px-4 py-3 font-semibold">School</th>
                        <th className="px-3 py-3 font-semibold">Exam</th>
                        <th className="px-3 py-3 font-semibold">Candidate</th>
                        <th className="px-3 py-3 font-semibold">Started</th>
                        <th className="px-3 py-3 font-semibold">Time left</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((s) => (
                        <tr key={s.attemptId} className="border-b border-[var(--border)] last:border-0">
                          <td className="px-4 py-3 font-medium">{s.tenantName}</td>
                          <td className="px-3 py-3">{s.examTitle}</td>
                          <td className="px-3 py-3">{s.candidateName}</td>
                          <td className="px-3 py-3 text-[var(--muted)]">{new Date(s.startedAt).toLocaleTimeString()}</td>
                          <td className="px-3 py-3">
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted)]"><Clock className="h-3 w-3" /> {fmtRemaining(s.deadline)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </SuperAdminShell>
  );
}
