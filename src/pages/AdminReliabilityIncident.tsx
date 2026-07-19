import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Loader2, Sparkles, ShieldAlert, ShieldCheck, Users, BookOpen } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { ErrorBanner } from "@/components/ui";
import { PageHeader } from "@/components/PageHeader";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { clsx } from "clsx";
import { SeverityBadge } from "@/pages/AdminReliability";

interface ExamImpact { affectedExamIds: string[]; attemptsOverlapping: number; attemptsInterrupted: number; attemptsAutoRecovered: number; attemptsRequiringManualRecovery: number; attemptsLost: number; studentsAffected: number; examIntegrityVerdict: "maintained" | "review_recommended"; examIntegrityBasis: string; }
interface IncidentEvent { id: string; at: string; type: string; message: string; }
interface Incident { id: string; subsystem: string; severity: "minor" | "major" | "critical"; status: string; title: string; openedAt: string; resolvedAt: string | null; autoResolved: boolean; timeline: IncidentEvent[]; impact: ExamImpact | null; }

export function AdminReliabilityIncident() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [incident, setIncident] = useState<Incident | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  const load = () => api.get<{ incident: Incident }>(`/admin/reliability/incidents/${id}`).then((r) => setIncident(r.incident)).catch((e) => setError((e as Error).message));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const resolve = async () => {
    setResolving(true);
    try { await api.post(`/admin/reliability/incidents/${id}/resolve`); await load(); }
    catch (e) { alert((e as Error).message); }
    finally { setResolving(false); }
  };

  const summarize = async () => {
    setAiBusy(true); setAiText(null);
    try { const r = await api.post<{ narrative: string }>(`/admin/reliability/incidents/${id}/ai-summary`); setAiText(r.narrative); }
    catch (e) { setAiText((e as Error).message); }
    finally { setAiBusy(false); }
  };

  return (
    <AdminShell wide>
      <div className="fade-in max-w-4xl">
        <button onClick={() => navigate("/admin/reliability")} className="mb-3 flex items-center gap-1.5 text-xs font-medium text-[var(--muted)] hover:text-[var(--fg)]">
          <ArrowLeft className="h-3.5 w-3.5" /> {t("relc.backToDashboard")}
        </button>

        {error && <ErrorBanner>{error}</ErrorBanner>}
        {!incident && !error && <div className="mt-8 flex items-center gap-2 text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}</div>}

        {incident && (
          <>
            <PageHeader
              title={incident.title}
              crumbCurrent={incident.title}
              subtitle={`${t(`relc.sub.${incident.subsystem}`)} · ${t(`relc.incStatus.${incident.status}`)}`}
              actions={incident.status !== "resolved" ? (
                <button onClick={resolve} disabled={resolving} className="btn btn-primary h-8 text-xs disabled:opacity-50">
                  {resolving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} {t("relc.resolveNow")}
                </button>
              ) : undefined}
            />

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.2fr_1fr]">
              <div className="card p-5">
                <h2 className="text-sm font-semibold">{t("relc.timeline")}</h2>
                <div className="mt-3 space-y-3">
                  {incident.timeline.map((ev) => (
                    <div key={ev.id} className="flex gap-3">
                      <div className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-[#c6ff34]" />
                      <div className="min-w-0 flex-1 border-b border-[var(--border)] pb-3 last:border-0">
                        <p className="text-xs text-[var(--muted)]">{new Date(ev.at).toLocaleString()}</p>
                        <p className="text-sm">{ev.message}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-5">
                <div className="card p-5">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold">{t("relc.severity")}</h2>
                    <SeverityBadge severity={incident.severity} />
                  </div>
                  <div className="mt-3 space-y-2 text-sm">
                    <Row label={t("relc.colOpened")} value={new Date(incident.openedAt).toLocaleString()} />
                    <Row label={t("relc.resolved")} value={incident.resolvedAt ? new Date(incident.resolvedAt).toLocaleString() : t("relc.stillOpen")} />
                    <Row label={t("relc.resolution")} value={incident.resolvedAt ? (incident.autoResolved ? t("relc.autoResolved") : t("relc.manuallyResolved")) : "—"} />
                  </div>
                </div>

                <div className="card p-5">
                  <div className="flex items-center justify-between">
                    <h2 className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-brand-400" /> {t("relc.aiSummary")}</h2>
                    <button onClick={summarize} disabled={aiBusy} className="btn btn-outline h-7 text-xs disabled:opacity-50">
                      {aiBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : t("relc.generate")}
                    </button>
                  </div>
                  {aiText && <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">{aiText}</p>}
                </div>
              </div>
            </div>

            {incident.impact && (
              <div className="mt-5 card p-5">
                <h2 className="flex items-center gap-2 text-sm font-semibold"><BookOpen className="h-4 w-4 text-brand-400" /> {t("relc.examImpact")}</h2>
                <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <Stat label={t("relc.affectedExams")} value={incident.impact.affectedExamIds.length} />
                  <Stat icon={Users} label={t("relc.studentsAffected")} value={incident.impact.studentsAffected} />
                  <Stat label={t("relc.autoRecovered")} value={incident.impact.attemptsAutoRecovered} tone="ok" />
                  <Stat label={t("relc.manualRecovery")} value={incident.impact.attemptsRequiringManualRecovery} tone="warn" />
                  <Stat label={t("relc.lostAttempts")} value={incident.impact.attemptsLost} tone={incident.impact.attemptsLost > 0 ? "down" : "ok"} />
                </div>
                <div className={clsx("mt-4 flex items-start gap-2 rounded-lg border p-3 text-xs",
                  incident.impact.examIntegrityVerdict === "maintained" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-amber-500/30 bg-amber-500/10 text-amber-400")}>
                  {incident.impact.examIntegrityVerdict === "maintained" ? <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /> : <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />}
                  <div>
                    <p className="font-semibold">{t(`relc.verdict.${incident.impact.examIntegrityVerdict}`)}</p>
                    <p className="mt-0.5 opacity-90">{incident.impact.examIntegrityBasis}</p>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AdminShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-3"><span className="text-[var(--muted)]">{label}</span><span className="font-medium">{value}</span></div>;
}
function Stat({ icon: Icon, label, value, tone }: { icon?: typeof Users; label: string; value: number; tone?: "ok" | "warn" | "down" }) {
  const toneClass = tone === "ok" ? "text-emerald-400" : tone === "warn" ? "text-amber-400" : tone === "down" ? "text-rose-400" : "text-[var(--fg)]";
  return (
    <div>
      <p className="flex items-center gap-1 text-xs text-[var(--muted)]">{Icon && <Icon className="h-3 w-3" />} {label}</p>
      <p className={clsx("text-xl font-semibold tabular-nums", toneClass)}>{value}</p>
    </div>
  );
}
