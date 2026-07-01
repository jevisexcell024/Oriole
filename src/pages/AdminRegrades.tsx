import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, MessageSquareWarning, Check, X, ExternalLink, Inbox } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { PageHeader } from "@/components/PageHeader";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { clsx } from "clsx";

interface RegradeRow {
  id: string; attemptId: string; examId: string; examTitle: string; candidateName: string;
  reason: string; status: "open" | "resolved" | "rejected"; response: string | null;
  scoreBefore: number | null; scoreAfter: number | null; currentScore: number | null;
  createdAt: string; resolvedAt: string | null; resolvedBy: string | null;
}

const fmt = (s: string | null) => (s ? new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const STATUS_KEY: Record<string, string> = { open: "areg.statusOpen", resolved: "areg.statusResolved", rejected: "areg.statusRejected" };

export function AdminRegrades() {
  const t = useT();
  const [rows, setRows] = useState<RegradeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.get<{ requests: RegradeRow[] }>("/admin/regrades").then((d) => setRows(d.requests)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const open = (rows ?? []).filter((r) => r.status === "open");

  return (
    <AdminShell wide>
      <div className="fade-in max-w-3xl">
        <PageHeader title={t("areg.title")} subtitle={t("areg.subtitle")} />

        {error && <p className="mt-6 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</p>}
        {!rows && !error && <div className="mt-10 flex items-center gap-2 text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}</div>}

        {rows && rows.length === 0 && (
          <div className="card mt-6 flex flex-col items-center gap-2 py-16 text-center text-sm text-[var(--muted)]">
            <Inbox className="h-8 w-8" /> {t("areg.none")}
          </div>
        )}

        {rows && rows.length > 0 && (
          <>
            <p className="mt-6 text-xs text-[var(--muted)]">{t("areg.openTotal", { open: open.length, total: rows.length })}</p>
            <div className="mt-3 space-y-3">
              {rows.map((r) => <RegradeCard key={r.id} r={r} onDone={load} />)}
            </div>
          </>
        )}
      </div>
    </AdminShell>
  );
}

function RegradeCard({ r, onDone }: { r: RegradeRow; onDone: () => void }) {
  const t = useT();
  const [response, setResponse] = useState("");
  const [newScore, setNewScore] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const resolve = async (status: "resolved" | "rejected") => {
    setBusy(status);
    try {
      await api.post(`/admin/regrades/${r.id}/resolve`, { status, response, newScore: status === "resolved" && newScore !== "" ? Number(newScore) : undefined });
      onDone();
    } catch (e) { alert((e as Error).message); }
    finally { setBusy(null); }
  };
  const badge = r.status === "open" ? "bg-amber-500/15 text-amber-400" : r.status === "resolved" ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400";
  return (
    <div className={clsx("card p-4", r.status === "open" && "ring-1 ring-amber-300/40")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{r.candidateName} <span className="font-normal text-[var(--muted)]">· {r.examTitle}</span></p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">{t("areg.submittedLine", { when: fmt(r.createdAt), score: r.currentScore ?? "—" })}{r.scoreAfter != null ? t("areg.wasSuffix", { before: r.scoreBefore ?? "—" }) : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-semibold", badge)}>{t(STATUS_KEY[r.status] ?? r.status)}</span>
          <Link to={`/admin/attempts/${r.attemptId}`} title={t("areg.openAttempt")} className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--card-2)] hover:text-[var(--fg)]"><ExternalLink className="h-4 w-4" /></Link>
        </div>
      </div>
      <p className="mt-2 rounded-md bg-[var(--bg)] px-3 py-2 text-sm"><span className="font-semibold text-[var(--muted)]">{t("areg.reason")}</span> {r.reason}</p>

      {r.status === "open" ? (
        <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
          <textarea className="input min-h-[60px] w-full resize-y text-sm" value={response} onChange={(e) => setResponse(e.target.value)} placeholder={t("areg.responsePlaceholder")} />
          <div className="flex flex-wrap items-center gap-2">
            <input type="number" min={0} max={100} value={newScore} onChange={(e) => setNewScore(e.target.value)} placeholder={t("areg.newScore")} className="input h-9 w-28 text-sm" />
            <span className="text-xs text-[var(--muted)]">{t("areg.leaveBlankScore")}</span>
            <div className="ml-auto flex gap-2">
              <button onClick={() => resolve("rejected")} disabled={!!busy} className="btn btn-outline h-9 disabled:opacity-50">{busy === "rejected" ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />} {t("areg.decline")}</button>
              <button onClick={() => resolve("resolved")} disabled={!!busy} className="btn btn-primary h-9 disabled:opacity-50">{busy === "resolved" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {t("areg.resolve")}</button>
            </div>
          </div>
        </div>
      ) : (
        (r.response || r.resolvedBy) && (
          <div className="mt-2 border-t border-[var(--border)] pt-2 text-xs text-[var(--muted)]">
            {r.response && <p><span className="font-semibold">{t("areg.response")}</span> {r.response}</p>}
            {r.resolvedBy && <p className="mt-0.5">{t("areg.resolvedByLine", { who: r.resolvedBy, when: fmt(r.resolvedAt) })}{r.scoreAfter != null ? t("areg.scoreSetSuffix", { score: r.scoreAfter }) : ""}</p>}
          </div>
        )
      )}
    </div>
  );
}
