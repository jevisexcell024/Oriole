import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ShieldAlert, Loader2, ArrowRight, ShieldCheck } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { useT } from "@/lib/i18n";
import { clsx } from "clsx";

interface ByType { type: string; severity: string; count: number; }
interface Flagged {
  attemptId: string; candidate: string; exam: string; integrity: number;
  flags: number; highFlags: number; submittedAt: string | null;
}
interface CalcUsage { candidate: string; opens: number; minutes: number; }
interface MediaUsage { candidate: string; plays: number; replays: number; minutes: number; }
interface Resp {
  kpis: { attempts: number; avgIntegrity: number | null; totalFlags: number; highFlags: number; cleanSessions: number; flaggedSessions: number };
  byType: ByType[];
  calculatorUsage: CalcUsage[];
  mediaUsage: MediaUsage[];
  flagged: Flagged[];
}

const fmt = (s: string | null) => (s ? new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const tone = (n: number | null) => (n === null ? "text-[var(--muted)]" : n >= 80 ? "text-emerald-400" : n >= 60 ? "text-amber-400" : "text-rose-400");

export function AdminIntegrity() {
  const t = useT();
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.get<Resp>("/admin/integrity").then(setData).catch((e) => setError(e.message)); }, []);

  if (error) return <AdminShell wide><p className="text-sm text-rose-400">{error}</p></AdminShell>;
  if (!data) return <AdminShell wide><div className="flex items-center gap-2 text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}</div></AdminShell>;

  const { kpis, byType, calculatorUsage, mediaUsage, flagged } = data;
  const maxCount = Math.max(1, ...byType.map((b) => b.count));

  return (
    <AdminShell wide>
      <div className="fade-in max-w-5xl">
        <div className="flex items-center gap-2.5">
          <PageHeader title={t("aint.title")} subtitle={t("aint.subtitle")} />
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Kpi label={t("aint.kpiAvg")} value={kpis.avgIntegrity === null ? "—" : `${kpis.avgIntegrity}`} tone={tone(kpis.avgIntegrity)} />
          <Kpi label={t("aint.kpiClean")} value={`${kpis.cleanSessions}/${kpis.attempts}`} tone="text-emerald-400" />
          <Kpi label={t("aint.kpiFlagged")} value={kpis.flaggedSessions} tone={kpis.flaggedSessions ? "text-amber-400" : undefined} />
          <Kpi label={t("aint.kpiHigh")} value={kpis.highFlags} tone={kpis.highFlags ? "text-rose-400" : undefined} />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* Flag types */}
          <div className="card p-5">
            <h2 className="text-sm font-semibold">{t("aint.flagsByType")}</h2>
            {byType.length === 0 ? (
              <p className="mt-3 flex items-center gap-2 text-sm text-emerald-400"><ShieldCheck className="h-4 w-4" /> {t("aint.noFlags")}</p>
            ) : (
              <div className="mt-3 space-y-2.5">
                {byType.map((b) => (
                  <div key={b.type}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="capitalize">{b.type.replace(/_/g, " ")}</span>
                      <span className="flex items-center gap-2">
                        <span className={clsx("font-semibold", b.severity === "high" ? "text-rose-400" : "text-amber-400")}>{b.severity === "high" ? t("common.high") : t("common.warning")}</span>
                        <span className="tabular-nums text-[var(--muted)]">{b.count}</span>
                      </span>
                    </div>
                    <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
                      <div className={clsx("h-full rounded-full", b.severity === "high" ? "bg-rose-500" : "bg-amber-500")} style={{ width: `${(b.count / maxCount) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick stats */}
          <div className="card p-5">
            <h2 className="text-sm font-semibold">{t("aint.sessionIntegrity")}</h2>
            <div className="mt-3 space-y-2 text-sm">
              <Row label={t("aint.sittingsAnalysed")} value={kpis.attempts} />
              <Row label={t("aint.totalFlags")} value={kpis.totalFlags} />
              <Row label={t("aint.cleanNoFlags")} value={`${kpis.cleanSessions} (${kpis.attempts ? Math.round((kpis.cleanSessions / kpis.attempts) * 100) : 0}%)`} />
              <Row label={t("aint.highEvents")} value={kpis.highFlags} />
            </div>
          </div>
        </div>

        {/* Flagged attempts */}
        <h2 className="mt-6 text-sm font-semibold">{t("aint.sessionsByIntegrity")}</h2>
        <div className="card mt-3 overflow-hidden">
          {flagged.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-[var(--muted)]">{t("aint.noSittings")}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
                  <th className="px-4 py-2.5 font-semibold">{t("ares.colCandidate")}</th>
                  <th className="px-3 py-2.5 font-semibold">{t("acls.exam")}</th>
                  <th className="px-3 py-2.5 text-center font-semibold">{t("ares.colIntegrity")}</th>
                  <th className="px-3 py-2.5 text-center font-semibold">{t("ares.colFlags")}</th>
                  <th className="px-3 py-2.5 text-center font-semibold">{t("aint.colHigh")}</th>
                  <th className="px-3 py-2.5 font-semibold">{t("ares.colSubmitted")}</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {flagged.map((f) => (
                  <tr key={f.attemptId} className="border-b border-[var(--border)] last:border-0 hover:bg-white/[0.02]">
                    <td className="px-4 py-3 font-medium">{f.candidate}</td>
                    <td className="px-3 py-3 text-[var(--muted)]">{f.exam}</td>
                    <td className={clsx("px-3 py-3 text-center font-semibold tabular-nums", tone(f.integrity))}>{f.integrity}</td>
                    <td className="px-3 py-3 text-center tabular-nums">{f.flags || "—"}</td>
                    <td className={clsx("px-3 py-3 text-center tabular-nums", f.highFlags ? "font-semibold text-rose-400" : "")}>{f.highFlags || "—"}</td>
                    <td className="px-3 py-3 text-xs text-[var(--muted)]">{fmt(f.submittedAt)}</td>
                    <td className="px-3 py-3 text-right">
                      <Link to={`/admin/attempts/${f.attemptId}`} className="inline-flex items-center text-[var(--muted)] hover:text-[var(--fg)]"><ArrowRight className="h-4 w-4" /></Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Calculator usage — reporting only, never a violation indicator */}
        {calculatorUsage.length > 0 && (
          <>
            <h2 className="mt-6 text-sm font-semibold">{t("aint.calculatorUsage")}</h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">{t("aint.calculatorUsageHint")}</p>
            <div className="card mt-3 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
                    <th className="px-4 py-2.5 font-semibold">{t("ares.colCandidate")}</th>
                    <th className="px-3 py-2.5 text-center font-semibold">{t("aint.calculatorOpens")}</th>
                    <th className="px-3 py-2.5 text-center font-semibold">{t("aint.calculatorMinutes")}</th>
                  </tr>
                </thead>
                <tbody>
                  {calculatorUsage.map((c) => (
                    <tr key={c.candidate} className="border-b border-[var(--border)] last:border-0 hover:bg-white/[0.02]">
                      <td className="px-4 py-3 font-medium">{c.candidate}</td>
                      <td className="px-3 py-3 text-center tabular-nums">{c.opens}</td>
                      <td className="px-3 py-3 text-center tabular-nums">{c.minutes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Media usage — reporting only, never a violation indicator */}
        {mediaUsage.length > 0 && (
          <>
            <h2 className="mt-6 text-sm font-semibold">{t("aint.mediaUsage")}</h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">{t("aint.mediaUsageHint")}</p>
            <div className="card mt-3 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
                    <th className="px-4 py-2.5 font-semibold">{t("ares.colCandidate")}</th>
                    <th className="px-3 py-2.5 text-center font-semibold">{t("aint.mediaPlays")}</th>
                    <th className="px-3 py-2.5 text-center font-semibold">{t("aint.mediaReplays")}</th>
                    <th className="px-3 py-2.5 text-center font-semibold">{t("aint.mediaMinutes")}</th>
                  </tr>
                </thead>
                <tbody>
                  {mediaUsage.map((m) => (
                    <tr key={m.candidate} className="border-b border-[var(--border)] last:border-0 hover:bg-white/[0.02]">
                      <td className="px-4 py-3 font-medium">{m.candidate}</td>
                      <td className="px-3 py-3 text-center tabular-nums">{m.plays}</td>
                      <td className="px-3 py-3 text-center tabular-nums">{m.replays || "—"}</td>
                      <td className="px-3 py-3 text-center tabular-nums">{m.minutes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </AdminShell>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className={clsx("mt-1 text-2xl font-bold tabular-nums", tone)}>{value}</p>
    </div>
  );
}
function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--border)] pb-2 last:border-0 last:pb-0">
      <span className="text-[var(--muted)]">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}
