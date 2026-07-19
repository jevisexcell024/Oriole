import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity, AlertTriangle, CheckCircle2, Database, Gauge, Loader2, RefreshCw, Server, Shield,
  Sparkles, Zap, HardDrive, Mail, Radio,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { AdminShell } from "@/components/AdminShell";
import { ErrorBanner } from "@/components/ui";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { clsx } from "clsx";

const LIME = "#c6ff34";
const CYAN = "#22d3ee";
const ROSE = "#f43f5e";
const AMBER = "#f59e0b";
const DIM = "#5a5a6a";

type SubsystemKey = "api" | "database" | "examDelivery" | "auth" | "notifications" | "fileStorage" | "backgroundJobs";
type StatusValue = "operational" | "degraded" | "down";

const SUBSYSTEM_ICON: Record<SubsystemKey, typeof Server> = {
  api: Server, database: Database, examDelivery: Zap, auth: Shield, notifications: Mail, fileStorage: HardDrive, backgroundJobs: Activity,
};

interface Summary { overallStatus: StatusValue; uptimePct24h: number; avgResponseMs: number | null; activeIncidents: number; lastUpdated: string | null; }
interface SubsystemTile { subsystem: SubsystemKey; status: StatusValue; uptimePct30d: number; avgResponseMs: number | null; lastIncidentAt: string | null; lastCheckedAt: string | null; }
interface UptimeBar { period: string; uptimePct: number | null; avgLatencyMs: number | null; requestCount: number; incidents: number; }
interface ResponseTimePoint { at: string; avg: number | null; min: number | null; max: number | null; p95: number | null; p99: number | null; }
interface LiveMetrics { rssMb: number; heapUsedMb: number; loadavg1: number; cpuCount: number; activeAttempts: number; requestsLastMinute: number; errorRatePct: number; }
interface ScoreResult { score: number; breakdown: { uptimeComponent: number; latencyComponent: number; incidentComponent: number; examImpactComponent: number } }
interface IncidentEvent { id: string; at: string; type: string; message: string; }
interface ExamImpact { affectedExamIds: string[]; attemptsOverlapping: number; attemptsInterrupted: number; attemptsAutoRecovered: number; attemptsRequiringManualRecovery: number; attemptsLost: number; studentsAffected: number; examIntegrityVerdict: "maintained" | "review_recommended"; examIntegrityBasis: string; }
interface Incident { id: string; subsystem: SubsystemKey; severity: "minor" | "major" | "critical"; status: "investigating" | "identified" | "monitoring" | "resolved"; title: string; openedAt: string; resolvedAt: string | null; autoResolved: boolean; timeline: IncidentEvent[]; impact: ExamImpact | null; }

const UPTIME_RANGES = ["24h", "7d", "30d", "90d", "365d"] as const;
const RT_RANGES = ["1h", "24h", "7d", "30d"] as const;

function statusTone(s: StatusValue) { return s === "operational" ? "ok" : s === "degraded" ? "warn" : "down"; }

/** 5-tier classification for a single day's uptime bar, matching a standard status-page legend. */
function barColor(pct: number | null): string {
  if (pct === null) return "bg-[var(--card-2)]";
  if (pct >= 99.5) return "bg-emerald-500";
  if (pct >= 95) return "bg-amber-500";
  if (pct >= 80) return "bg-orange-500";
  return "bg-rose-500";
}
const LEGEND: { color: string; labelKey: string }[] = [
  { color: "bg-emerald-500", labelKey: "relc.status.operational" },
  { color: "bg-amber-500", labelKey: "relc.status.degraded" },
  { color: "bg-orange-500", labelKey: "relc.legendPartialOutage" },
  { color: "bg-rose-500", labelKey: "relc.legendMajorOutage" },
  { color: "bg-[var(--card-2)]", labelKey: "relc.legendNoData" },
];
/** "2026-05-08" → "May 8"; hourly periods ("14:00") pass through unchanged. */
function formatPeriodLabel(period: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(period)) return period;
  return new Date(`${period}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

export function AdminReliability() {
  const t = useT();
  const navigate = useNavigate();

  const [summary, setSummary] = useState<Summary | null>(null);
  const [subsystems, setSubsystems] = useState<SubsystemTile[] | null>(null);
  const [live, setLive] = useState<LiveMetrics | null>(null);
  const [score, setScore] = useState<ScoreResult | null>(null);
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [uptimeRange, setUptimeRange] = useState<(typeof UPTIME_RANGES)[number]>("30d");
  const [subsystemBars, setSubsystemBars] = useState<Record<string, UptimeBar[]>>({});
  const [rtRange, setRtRange] = useState<(typeof RT_RANGES)[number]>("24h");
  const [rtPoints, setRtPoints] = useState<ResponseTimePoint[]>([]);
  const [running, setRunning] = useState(false);
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCore = () => Promise.all([
    api.get<Summary>("/admin/reliability/summary").then(setSummary),
    api.get<{ subsystems: SubsystemTile[] }>("/admin/reliability/subsystems").then((r) => setSubsystems(r.subsystems)),
    api.get<ScoreResult>("/admin/reliability/score").then(setScore),
    api.get<{ incidents: Incident[] }>("/admin/reliability/incidents").then((r) => setIncidents(r.incidents)),
  ]).catch((e) => setError((e as Error).message));

  useEffect(() => {
    loadCore();
    const id = setInterval(loadCore, 15000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const load = () => api.get<LiveMetrics>("/admin/reliability/live").then(setLive).catch(() => {});
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, []);

  // Fetch each subsystem's own daily uptime history so every service row can
  // show its own bar strip (not just one combined platform-wide bar). Keyed on
  // whether subsystems has loaded yet (not the array itself, which gets a new
  // reference every 15s poll) so this only re-fetches on a real range change.
  useEffect(() => {
    if (!subsystems) return;
    let cancelled = false;
    Promise.all(
      subsystems.map((s) =>
        api.get<{ bars: UptimeBar[] }>(`/admin/reliability/uptime?range=${uptimeRange}&subsystem=${s.subsystem}`)
          .then((r) => [s.subsystem, r.bars] as const),
      ),
    ).then((entries) => { if (!cancelled) setSubsystemBars(Object.fromEntries(entries)); }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uptimeRange, subsystems !== null]);

  useEffect(() => {
    api.get<{ points: ResponseTimePoint[] }>(`/admin/reliability/response-time?range=${rtRange}`).then((r) => setRtPoints(r.points)).catch(() => {});
  }, [rtRange]);

  const runNow = async () => {
    setRunning(true);
    try { await api.post("/admin/reliability/run-now"); await loadCore(); }
    catch (e) { alert((e as Error).message); }
    finally { setRunning(false); }
  };

  const generateInsights = async () => {
    setAiBusy(true);
    setAiText(null);
    try {
      const r = await api.post<{ narrative: string }>("/admin/reliability/ai-insights");
      setAiText(r.narrative);
    } catch (e) { setAiText((e as Error).message); }
    finally { setAiBusy(false); }
  };

  const loading = !summary || !subsystems || !score || !incidents;

  return (
    <AdminShell wide>
      <div className="fade-in max-w-6xl">
        <PageHeader
          title={t("relc.title")}
          subtitle={t("relc.subtitle")}
          actions={(
            <>
              <a href="/api/admin/reliability/incidents.csv" className="btn btn-outline h-8 text-xs">{t("relc.exportCsv")}</a>
              <button onClick={runNow} disabled={running} className="btn btn-primary h-8 text-xs disabled:opacity-50">
                {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} {t("relc.runNow")}
              </button>
            </>
          )}
        />

        {error && <ErrorBanner className="mb-4">{error}</ErrorBanner>}
        {loading && !error && <div className="mt-8 flex items-center gap-2 text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}</div>}

        {summary && subsystems && score && incidents && (
          <>
            {/* Dashboard header */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Tile icon={summary.overallStatus === "operational" ? CheckCircle2 : AlertTriangle} tone={statusTone(summary.overallStatus)}
                label={t("relc.overallStatus")} value={t(`relc.status.${summary.overallStatus}`)} />
              <Tile icon={Gauge} tone="neutral" label={t("relc.uptime24h")} value={`${summary.uptimePct24h}%`} />
              <Tile icon={Zap} tone="neutral" label={t("relc.avgResponse")} value={summary.avgResponseMs != null ? `${summary.avgResponseMs} ms` : "—"} />
              <Tile icon={AlertTriangle} tone={summary.activeIncidents > 0 ? "warn" : "ok"} label={t("relc.activeIncidents")} value={String(summary.activeIncidents)} />
            </div>

            {/* Service Health — each subsystem's own uptime% + status + daily history bar */}
            <div className="mt-6 card p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold"><Server className="h-4 w-4 text-brand-400" /> {t("relc.serviceHealth")}</h2>
                <div className="flex gap-1">
                  {UPTIME_RANGES.map((r) => (
                    <button key={r} onClick={() => setUptimeRange(r)} className={clsx("rounded-md px-2.5 py-1 text-xs font-medium", uptimeRange === r ? "bg-[var(--fg)] text-[var(--bg)]" : "text-[var(--muted)] hover:bg-[var(--card-2)]")}>{r}</button>
                  ))}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                {LEGEND.map((l) => (
                  <span key={l.labelKey} className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
                    <span className={clsx("h-2 w-2 rounded-full", l.color)} /> {t(l.labelKey)}
                  </span>
                ))}
              </div>

              <div className="mt-5 divide-y divide-[var(--border)]">
                {subsystems.map((s) => {
                  const Icon = SUBSYSTEM_ICON[s.subsystem];
                  const bars = subsystemBars[s.subsystem] ?? [];
                  return (
                    <div key={s.subsystem} className="py-4 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-sm font-semibold">
                          <Icon className="h-4 w-4 text-[var(--muted)]" /> {t(`relc.sub.${s.subsystem}`)}
                          <span className="font-normal text-[var(--muted)]">
                            · {t("relc.uptime30d")} <span className="font-semibold tabular-nums text-[var(--fg)]">{s.uptimePct30d}%</span>
                            {s.avgResponseMs != null && <> · {t("relc.avgResponse")} <span className="font-semibold tabular-nums text-[var(--fg)]">{s.avgResponseMs}ms</span></>}
                          </span>
                        </div>
                        <span className={clsx("flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
                          s.status === "operational" ? "bg-emerald-500/15 text-emerald-400" : s.status === "degraded" ? "bg-amber-500/15 text-amber-400" : "bg-rose-500/15 text-rose-400")}>
                          <span className={clsx("h-1.5 w-1.5 rounded-full", s.status === "operational" ? "bg-emerald-500" : s.status === "degraded" ? "bg-amber-500" : "bg-rose-500")} />
                          {t(`relc.status.${s.status}`)}
                        </span>
                      </div>

                      {bars.length === 0 ? (
                        <p className="mt-3 text-xs text-[var(--muted)]">{t("relc.noData")}</p>
                      ) : (
                        <div className="mt-3 flex h-8 gap-[2px]">
                          {bars.map((b) => (
                            <div key={b.period} className="group relative flex-1">
                              <div className={clsx("h-full rounded-[2px]", barColor(b.uptimePct))} />
                              <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1.5 text-xs shadow-lg group-hover:block">
                                <p className="font-semibold">{formatPeriodLabel(b.period)}</p>
                                <p className="text-[var(--muted)]">
                                  {b.uptimePct === null ? t("relc.legendNoData") : `${t("relc.uptime")}: ${b.uptimePct}%`}
                                  {b.incidents ? ` · ${b.incidents} ${t("relc.incidentsLabel")}` : ""}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Response time */}
            <div className="mt-6 card p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold"><Zap className="h-4 w-4 text-brand-400" /> {t("relc.responseTime")}</h2>
                <div className="flex gap-1">
                  {RT_RANGES.map((r) => (
                    <button key={r} onClick={() => setRtRange(r)} className={clsx("rounded-md px-2.5 py-1 text-xs font-medium", rtRange === r ? "bg-[var(--fg)] text-[var(--bg)]" : "text-[var(--muted)] hover:bg-[var(--card-2)]")}>{r}</button>
                  ))}
                </div>
              </div>
              <div style={{ height: 220 }} className="mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={rtPoints} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="at" tick={{ fill: DIM, fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={(v: string) => v.slice(11, 16)} />
                    <YAxis tick={{ fill: DIM, fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip content={<RtTooltip />} />
                    <Line type="monotone" dataKey="avg" name={t("relc.avg")} stroke={LIME} strokeWidth={1.5} dot={false} activeDot={{ r: 4 }} />
                    <Line type="monotone" dataKey="p95" name="p95" stroke={CYAN} strokeWidth={1.5} dot={false} activeDot={{ r: 4 }} />
                    <Line type="monotone" dataKey="p99" name="p99" stroke={ROSE} strokeWidth={1.5} dot={false} activeDot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Live widgets + Score */}
            <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[1.1fr_1fr]">
              <div className="card p-5">
                <h2 className="flex items-center gap-2 text-sm font-semibold"><Radio className="h-4 w-4 text-brand-400" /> {t("relc.live")}</h2>
                {live ? (
                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <LiveStat label={t("relc.requestsPerMin")} value={String(live.requestsLastMinute)} />
                    <LiveStat label={t("relc.errorRate")} value={`${live.errorRatePct}%`} />
                    <LiveStat label={t("relc.activeExams")} value={String(live.activeAttempts)} />
                    <LiveStat label={t("relc.memory")} value={`${live.rssMb} MB`} />
                    <LiveStat label={t("relc.cpuLoad")} value={live.loadavg1.toFixed(2)} />
                    <LiveStat label={t("relc.cpuCores")} value={String(live.cpuCount)} />
                  </div>
                ) : <div className="mt-3 text-xs text-[var(--muted)]">{t("common.loading")}</div>}
              </div>

              <div className="card p-5">
                <div className="flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-sm font-semibold"><Gauge className="h-4 w-4 text-brand-400" /> {t("relc.reliabilityScore")}</h2>
                  <span className="font-display text-2xl font-bold tabular-nums text-[#c6ff34]">{score.score}</span>
                </div>
                <div className="mt-3 space-y-2">
                  <ScoreBar label={t("relc.scoreUptime")} value={score.breakdown.uptimeComponent} />
                  <ScoreBar label={t("relc.scoreLatency")} value={score.breakdown.latencyComponent} />
                  <ScoreBar label={t("relc.scoreIncidents")} value={score.breakdown.incidentComponent} />
                  <ScoreBar label={t("relc.scoreExamImpact")} value={score.breakdown.examImpactComponent} />
                </div>
                <button onClick={generateInsights} disabled={aiBusy} className="btn btn-outline mt-4 h-8 w-full text-xs disabled:opacity-50">
                  {aiBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} {t("relc.aiInsights")}
                </button>
                {aiText && <p className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--card-2)] p-3 text-xs leading-relaxed">{aiText}</p>}
              </div>
            </div>

            {/* Incident history */}
            <h2 className="mt-6 flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="h-4 w-4 text-brand-400" /> {t("relc.incidentHistory")}</h2>
            <div className="mt-3">
              <DataTable<Incident>
                rows={incidents}
                getId={(r) => r.id}
                searchText={(r) => `${r.title} ${r.subsystem} ${r.severity}`}
                searchPlaceholder={t("relc.searchIncidents")}
                exportName="reliability-incidents"
                onRowClick={(r) => navigate(`/admin/reliability/incidents/${r.id}`)}
                initialSort={{ key: "openedAt", dir: "desc" }}
                empty={<p className="py-8 text-center text-sm text-[var(--muted)]">{t("relc.noIncidents")}</p>}
                columns={columns(t)}
              />
            </div>
          </>
        )}
      </div>
    </AdminShell>
  );
}

function columns(t: ReturnType<typeof useT>): Column<Incident>[] {
  return [
    { key: "title", header: t("relc.colTitle"), render: (r) => <span className="font-medium">{r.title}</span>, sortValue: (r) => r.title, csv: (r) => r.title },
    { key: "subsystem", header: t("relc.colSubsystem"), render: (r) => t(`relc.sub.${r.subsystem}`), sortValue: (r) => r.subsystem, csv: (r) => r.subsystem },
    { key: "severity", header: t("relc.colSeverity"), render: (r) => <SeverityBadge severity={r.severity} />, sortValue: (r) => r.severity, csv: (r) => r.severity },
    { key: "status", header: t("relc.colStatus"), render: (r) => t(`relc.incStatus.${r.status}`), sortValue: (r) => r.status, csv: (r) => r.status },
    { key: "openedAt", header: t("relc.colOpened"), render: (r) => new Date(r.openedAt).toLocaleString(), sortValue: (r) => r.openedAt, csv: (r) => r.openedAt },
    {
      key: "duration", header: t("relc.colDuration"),
      render: (r) => r.resolvedAt ? `${Math.round((new Date(r.resolvedAt).getTime() - new Date(r.openedAt).getTime()) / 60000)}m` : "—",
      sortValue: (r) => r.resolvedAt ? new Date(r.resolvedAt).getTime() - new Date(r.openedAt).getTime() : -1,
      csv: (r) => r.resolvedAt ? String(Math.round((new Date(r.resolvedAt).getTime() - new Date(r.openedAt).getTime()) / 60000)) : "",
    },
    { key: "lost", header: t("relc.colLost"), render: (r) => String(r.impact?.attemptsLost ?? 0), sortValue: (r) => r.impact?.attemptsLost ?? 0, csv: (r) => String(r.impact?.attemptsLost ?? 0) },
  ];
}

function Tile({ icon: Icon, tone, label, value }: { icon: typeof Server; tone: "ok" | "warn" | "down" | "neutral"; label: string; value: string }) {
  const toneClass = tone === "ok" ? "bg-emerald-500/20 text-emerald-400" : tone === "warn" ? "bg-amber-500/20 text-amber-400" : tone === "down" ? "bg-rose-500/20 text-rose-400" : "bg-[var(--card-2)] text-[var(--muted)]";
  return (
    <div className="card flex items-center gap-3 p-4">
      <div className={clsx("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", toneClass)}><Icon className="h-5 w-5" /></div>
      <div className="min-w-0"><p className="truncate text-xs text-[var(--muted)]">{label}</p><p className="text-lg font-semibold tabular-nums">{value}</p></div>
    </div>
  );
}
function LiveStat({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[11px] text-[var(--muted)]">{label}</p><p className="font-semibold tabular-nums">{value}</p></div>;
}
function ScoreBar({ label, value }: { label: string; value: number }) {
  const color = value >= 90 ? "bg-emerald-500" : value >= 70 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div>
      <div className="flex items-center justify-between text-xs"><span className="text-[var(--muted)]">{label}</span><span className="font-medium tabular-nums">{Math.round(value)}</span></div>
      <div className="mt-1 h-1.5 rounded-full bg-[var(--card-2)]"><div className={clsx("h-1.5 rounded-full", color)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div>
    </div>
  );
}
export function SeverityBadge({ severity }: { severity: "minor" | "major" | "critical" }) {
  const cls = severity === "critical" ? "bg-rose-500/15 text-rose-400" : severity === "major" ? "bg-orange-500/15 text-orange-400" : "bg-amber-500/15 text-amber-400";
  return <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize", cls)}>{severity}</span>;
}
function RtTooltip({ active, payload, label }: { active?: boolean; payload?: { name?: string; value?: number; color?: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ backgroundColor: "#1e1e1e", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "10px 12px", boxShadow: "0 8px 24px rgba(0,0,0,0.6)" }}>
      {label && <p style={{ fontSize: 11, fontWeight: 600, color: "#f0f0f0", marginBottom: 6 }}>{new Date(label).toLocaleTimeString()}</p>}
      {payload.map((p, i) => (
        <p key={i} style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: p.color, display: "inline-block" }} />
          <span style={{ color: "#888" }}>{p.name}:</span>
          <span style={{ color: "#f0f0f0", fontWeight: 600 }}>{Math.round(p.value ?? 0)}ms</span>
        </p>
      ))}
    </div>
  );
}
