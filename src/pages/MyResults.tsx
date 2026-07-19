import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, XCircle, Hourglass, BarChart3, ChevronRight } from "lucide-react";
import { Shell } from "@/components/Shell";
import { TableSkeleton, EmptyState, ErrorBanner } from "@/components/ui";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { useT } from "@/lib/i18n";
import { clsx } from "clsx";

interface Result {
  attemptId: string; examTitle: string; examCode: string; score: number | null; passed: boolean | null;
  gradingStatus: string; submittedAt: string | null; integrity: number; passingScore: number; certNumber: string | null;
  held?: boolean; releaseAt?: string | null; letter?: string | null;
}
const fmt = (s: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");
const tone = (n: number) => (n >= 80 ? "text-emerald-400" : n >= 60 ? "text-amber-400" : "text-rose-400");

export function MyResults() {
  const t = useT();
  const [results, setResults] = useState<Result[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.get<{ results: Result[] }>("/my/results").then((d) => setResults(d.results)).catch((e) => setError(e.message)); }, []);

  return (
    <Shell>
      <div className="fade-in">
        <PageHeader title={t("nav.myResults")} subtitle={t("res.subtitle")} />

        {error && <ErrorBanner className="mt-6">{error}</ErrorBanner>}
        {!results && !error && <div className="card mt-6"><TableSkeleton rows={4} cells={2} /></div>}

        {results && results.length === 0 && (
          <EmptyState
            className="mt-6"
            icon={BarChart3}
            title={t("res.none")}
            hint={t("res.noneHint")}
          />
        )}

        {results && results.length > 0 && (
          <div className="mt-6 space-y-3">
            {results.map((r) => {
              const awaiting = r.gradingStatus === "pending_review";
              const hide = awaiting || !!r.held;
              return (
                <Link key={r.attemptId} to={`/attempts/${r.attemptId}/result`} className="card flex items-center justify-between gap-4 p-4 transition hover:shadow-md">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{r.examTitle}</p>
                    <p className="text-xs text-[var(--muted)]">{r.examCode} · {fmt(r.submittedAt)} · {t("res.passMark")} {r.passingScore}%</p>
                    <div className="mt-1.5 flex items-center gap-2 text-xs">
                      {r.held ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 font-semibold text-amber-400"><Hourglass className="h-3 w-3" /> {t("res.pendingRelease")}{r.releaseAt ? ` · ${fmt(r.releaseAt)}` : ""}</span>
                      ) : awaiting ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 font-semibold text-amber-400"><Hourglass className="h-3 w-3" /> {t("res.awaitingGrading")}</span>
                      ) : r.passed ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 font-semibold text-emerald-400"><CheckCircle2 className="h-3 w-3" /> {t("res.passed")}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 font-semibold text-rose-400"><XCircle className="h-3 w-3" /> {t("res.notPassed")}</span>
                      )}
                      {!hide && r.letter && <span className="inline-flex items-center gap-1 rounded-full bg-brand-500/15 px-2 py-0.5 font-semibold text-brand-400">{t("res.grade")} {r.letter}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className={clsx("font-display text-2xl font-semibold tabular-nums", hide ? "text-[var(--muted)]" : tone(r.score ?? 0))}>{hide ? "—" : `${r.score}%`}</p>
                      <p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{t("res.score")}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-[var(--muted)]" />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </Shell>
  );
}
