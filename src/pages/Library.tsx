import { useEffect, useMemo, useState } from "react";
import { Library as LibraryIcon, Globe, Search } from "lucide-react";
import { Shell } from "@/components/Shell";
import { Skeleton, EmptyState } from "@/components/ui";
import { PageHeader } from "@/components/PageHeader";
import { api } from "@/lib/api";
import type { ExamListItem } from "@shared/types";

interface Resource { label: string; url: string; examTitle: string; examCode: string; examId: string; }

// Every exam a student is registered for can carry admin-attached study
// resources (Exam.resources). This page aggregates all of them into one
// searchable archive, grouped by exam — real data, not a fabricated document store.
export function Library() {
  const [items, setItems] = useState<ExamListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => { api.get<{ items: ExamListItem[] }>("/exams").then((d) => setItems(d.items)).catch((e) => setError(e.message)); }, []);

  const resources = useMemo<Resource[]>(() => {
    if (!items) return [];
    const out: Resource[] = [];
    for (const it of items) {
      for (const r of it.exam.resources ?? []) {
        out.push({ label: r.label || r.url, url: r.url, examTitle: it.exam.title, examCode: it.exam.code, examId: it.exam.id });
      }
    }
    return out;
  }, [items]);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? resources.filter((r) => r.label.toLowerCase().includes(q) || r.examTitle.toLowerCase().includes(q) || r.examCode.toLowerCase().includes(q))
      : resources;
    const map = new Map<string, { examTitle: string; examCode: string; items: Resource[] }>();
    for (const r of filtered) {
      const g = map.get(r.examId) ?? { examTitle: r.examTitle, examCode: r.examCode, items: [] };
      g.items.push(r);
      map.set(r.examId, g);
    }
    return [...map.values()];
  }, [resources, query]);

  return (
    <Shell>
      <div className="fade-in max-w-3xl">
        <PageHeader title="Library" subtitle="Study resources attached to your exams, in one place." />

        {error && <p className="mt-6 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</p>}

        {!items && !error && (
          <div className="mt-6 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="card p-5"><Skeleton className="h-4 w-1/3" /><Skeleton className="mt-3 h-3 w-full" /></div>
            ))}
          </div>
        )}

        {items && (
          <>
            <div className="relative mt-6">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search resources or exams…"
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--card)] py-2.5 pl-9 pr-3 text-sm text-[var(--fg)] outline-none transition focus:border-[#c6ff34]"
              />
            </div>

            {grouped.length === 0 ? (
              <EmptyState
                className="mt-6"
                icon={LibraryIcon}
                title={resources.length === 0 ? "No resources yet" : "No matches"}
                hint={resources.length === 0 ? "Your instructors haven't attached any study materials to your exams yet." : "Try a different search term."}
              />
            ) : (
              <div className="mt-6 space-y-4">
                {grouped.map((g) => (
                  <div key={g.examTitle + g.examCode} className="card p-5">
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="text-sm font-bold text-[var(--fg)]">{g.examTitle}</h3>
                      {g.examCode && <span className="font-mono text-[11px] text-[var(--muted)]">{g.examCode}</span>}
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      {g.items.map((r, i) => (
                        <a key={i} href={r.url} target="_blank" rel="noreferrer"
                          className="flex items-center gap-2 rounded-xl border border-[var(--border)] p-3 text-sm font-semibold text-[var(--fg)] transition hover:bg-[var(--card-2)]">
                          <Globe className="h-4 w-4 shrink-0 text-[#c6ff34]" /> <span className="truncate">{r.label}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Shell>
  );
}
