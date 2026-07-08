import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { GraduationCap, Globe, ChevronRight, Timer } from "lucide-react";
import { Shell } from "@/components/Shell";
import { Skeleton, EmptyState } from "@/components/ui";
import { PageHeader } from "@/components/PageHeader";
import { api } from "@/lib/api";
import type { ExamListItem } from "@shared/types";

function startIso(it: ExamListItem): string | null {
  return it.registration.scheduledStart || it.exam.availableFrom || null;
}
function fmtDate(iso: string | null) {
  if (!iso) return "Not scheduled";
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

// Same underlying data as Library (Exam.resources), but scoped to exams that
// aren't submitted yet — "what should I be studying right now" rather than
// Library's full historical archive, so the two pages don't just duplicate.
export function LearningMaterials() {
  const [items, setItems] = useState<ExamListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.get<{ items: ExamListItem[] }>("/exams").then((d) => setItems(d.items)).catch((e) => setError(e.message)); }, []);

  const upcoming = useMemo(() => {
    if (!items) return [];
    return items
      .filter((it) => it.attempt?.status !== "submitted")
      .sort((a, b) => (startIso(a) ?? "9999").localeCompare(startIso(b) ?? "9999"));
  }, [items]);

  return (
    <Shell>
      <div className="fade-in max-w-3xl">
        <PageHeader title="Learning Materials" subtitle="Study resources for your upcoming and in-progress exams." />

        {error && <p className="mt-6 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</p>}

        {!items && !error && (
          <div className="mt-6 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="card p-5"><Skeleton className="h-4 w-1/3" /><Skeleton className="mt-3 h-3 w-full" /></div>
            ))}
          </div>
        )}

        {items && (
          upcoming.length === 0 ? (
            <EmptyState className="mt-6" icon={GraduationCap} title="Nothing to prepare for right now" hint="Materials for your next exam will show up here once you're registered." />
          ) : (
            <div className="mt-6 space-y-4">
              {upcoming.map((it) => {
                const resources = it.exam.resources ?? [];
                return (
                  <div key={it.registration.id} className="card p-5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-bold text-[var(--fg)]">{it.exam.title}</h3>
                        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--muted)]">
                          <Timer className="h-3.5 w-3.5" /> {fmtDate(startIso(it))}
                        </p>
                      </div>
                      <Link to={`/exams/${it.registration.id}/checkin`}
                        className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold text-[#111110] transition hover:opacity-90"
                        style={{ background: "#c6ff34" }}>
                        Prepare <ChevronRight className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                    {resources.length === 0 ? (
                      <p className="mt-3 text-xs text-[var(--muted)]">No study materials attached to this exam yet.</p>
                    ) : (
                      <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                        {resources.map((r, i) => (
                          <a key={i} href={r.url} target="_blank" rel="noreferrer"
                            className="flex items-center gap-2 rounded-xl border border-[var(--border)] p-3 text-sm font-semibold text-[var(--fg)] transition hover:bg-[var(--card-2)]">
                            <Globe className="h-4 w-4 shrink-0 text-[#c6ff34]" /> <span className="truncate">{r.label || r.url}</span>
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>
    </Shell>
  );
}
