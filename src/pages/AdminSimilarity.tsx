import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Loader2, ArrowLeft, Copy, ShieldAlert, CheckCircle2, ExternalLink } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { ErrorBanner } from "@/components/ui";
import { PageHeader } from "@/components/PageHeader";
import { api } from "@/lib/api";
import { clsx } from "clsx";

interface Pair { questionId: string; prompt: string; type: string; a: string; b: string; aAttempt: string; bAttempt: string; similarity: number }
interface Resp { exam: { id: string; title: string; code: string }; scannedQuestions: number; attempts: number; threshold: number; pairs: Pair[] }

export function AdminSimilarity() {
  const { examId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.get<Resp>(`/admin/exams/${examId}/similarity`).then(setData).catch((e) => setError(e.message)); }, [examId]);

  return (
    <AdminShell wide>
      <div className="fade-in max-w-3xl">
        <PageHeader
          title={<span className="inline-flex items-center gap-2"><Copy className="h-6 w-6" /> Answer similarity</span>}
          subtitle={data ? `${data.exam.title}${data.exam.code ? ` · ${data.exam.code}` : ""}` : "Detecting near-duplicate written answers"}
          actions={<button onClick={() => navigate("/admin/results")} className="btn btn-ghost-teal"><ArrowLeft className="h-4 w-4" /> Back to Results</button>}
        />

        {error && <ErrorBanner className="mt-6">{error}</ErrorBanner>}
        {!data && !error && <div className="mt-8 flex items-center gap-2 text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> Comparing answers…</div>}

        {data && (
          <>
            <div className="mt-5 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm">
              <ShieldAlert className="h-4 w-4 text-[#c6ff34]" />
              Compared written answers across <span className="font-semibold">{data.scannedQuestions}</span> question{data.scannedQuestions === 1 ? "" : "s"} and <span className="font-semibold">{data.attempts}</span> submission{data.attempts === 1 ? "" : "s"}.
              <span className="text-xs text-[var(--muted)]">Pairs at or above {data.threshold}% character similarity are flagged.</span>
            </div>

            {data.pairs.length === 0 ? (
              <div className="card mt-4 flex flex-col items-center gap-2 py-16 text-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                <p className="text-sm font-medium">No suspiciously similar answers found.</p>
                <p className="text-xs text-[var(--muted)]">Nothing crossed the {data.threshold}% similarity threshold.</p>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <p className="text-xs text-[var(--muted)]"><span className="font-semibold text-[var(--fg)]">{data.pairs.length}</span> flagged pair{data.pairs.length === 1 ? "" : "s"} — review before alleging misconduct.</p>
                {data.pairs.map((p, i) => (
                  <div key={i} className="card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <p className="line-clamp-2 text-sm font-medium">{p.prompt || "(no prompt)"}</p>
                      <span className={clsx("shrink-0 rounded-full px-2.5 py-1 text-xs font-bold",
                        p.similarity >= 85 ? "bg-rose-500/15 text-rose-400" : p.similarity >= 70 ? "bg-amber-500/15 text-amber-400" : "bg-[var(--card-2)] text-[var(--muted)]")}>{p.similarity}% match</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                      <Link to={`/admin/attempts/${p.aAttempt}`} className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--card-2)]">{p.a} <ExternalLink className="h-3 w-3 text-[var(--muted)]" /></Link>
                      <Copy className="h-3.5 w-3.5 text-[var(--muted)]" />
                      <Link to={`/admin/attempts/${p.bAttempt}`} className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--card-2)]">{p.b} <ExternalLink className="h-3 w-3 text-[var(--muted)]" /></Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </AdminShell>
  );
}
