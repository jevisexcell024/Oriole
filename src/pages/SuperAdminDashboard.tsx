import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import {
  Building2, Users, GraduationCap, ShieldCheck, Eye, BookOpen, CalendarClock, Radio, Clock,
  DollarSign, KeyRound, PauseCircle, PlusCircle, ShieldAlert, Activity, Fingerprint, ScrollText,
} from "lucide-react";
import { SuperAdminShell } from "@/components/SuperAdminShell";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton, ErrorBanner } from "@/components/ui";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { clsx } from "clsx";

const LIME = "#c8f53d";
const CYAN = "#22d3ee";
const DIM = "#5a5a6a";
const MONO = "'DM Mono', monospace";
const PLAN_COLORS = [LIME, CYAN, "#c084fc", "#fb923c", "#4ade80", "#f43f5e"];

interface DashboardData {
  institutions: { total: number; active: number; suspended: number };
  users: { total: number; students: number; facilitators: number; proctors: number; administrators: number };
  exams: { active: number; today: number };
  liveSessions: number;
  platformUptimeSeconds: number;
  mfaAdoptionPct: number;
}
interface TrendPoint { date: string; schools: number; exams: number; }
interface PlanSlice { planId: string | null; planName: string; count: number; }
interface AnalyticsData { trend: TrendPoint[]; planDistribution: PlanSlice[]; }
interface PlansSummary { totalPlans: number; activePlans: number; totalInstitutions: number; mrr: number; arr: number; }
interface LicenseRow { tenantId: string; tenantName: string; tenantStatus: "active" | "suspended"; tenantCreatedAt: string; planName: string | null; usage: { students: number } }
interface AuditLog { id: string; at: string; actorName: string; action: string; target: string; }

function fmtUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}
function fmtMoney(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDate(iso: string): string {
  const d = new Date(iso + (iso.includes("T") ? "" : "T00:00:00Z"));
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  const m = s / 60; if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60; if (h < 24) return `${Math.floor(h)}h ago`;
  const d = h / 24; return `${Math.floor(d)}d ago`;
}
function quarterLabel(): string {
  const d = new Date();
  return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
}

function StatCard({ icon: Icon, label, value, hint }: { icon: typeof Building2; label: string; value: string | number; hint?: string }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: `${LIME}1a`, color: LIME }}><Icon className="h-4 w-4" /></span>
      </div>
      <p className="mt-3 text-2xl font-bold tabular-nums leading-none">{value}</p>
      <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]" style={{ fontFamily: MONO }}>{label}</p>
      {hint && <p className="mt-0.5 text-xs text-[var(--muted)]">{hint}</p>}
    </div>
  );
}

function DarkTooltip({ active, payload, label }: { active?: boolean; payload?: { name?: string; value?: number | string; color?: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card-2)] px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold">{label}</p>
      {payload.map((p, i) => <p key={i} style={{ color: p.color }}>{p.name}: <span className="font-semibold">{p.value}</span></p>)}
    </div>
  );
}

function PlanDonut({ slices }: { slices: PlanSlice[] }) {
  const total = slices.reduce((s, p) => s + p.count, 0);
  const r = 52, c = 2 * Math.PI * r, gap = 3;
  let offset = 0;
  const segs = slices.filter((s) => s.count > 0);
  return (
    <svg width="150" height="150" viewBox="0 0 150 150">
      <circle cx="75" cy="75" r={r} fill="none" stroke="var(--card-2)" strokeWidth="16" />
      {segs.map((s, i) => {
        const pct = total ? s.count / total : 0;
        const len = pct * c;
        const dash = Math.max(0, len - gap);
        const el = (
          <circle key={s.planId ?? "none"} cx="75" cy="75" r={r} fill="none" stroke={s.planId === null ? DIM : PLAN_COLORS[i % PLAN_COLORS.length]} strokeWidth="16"
            strokeLinecap="round" strokeDasharray={`${dash} ${c - dash}`} strokeDashoffset={-offset} transform="rotate(-90 75 75)" />
        );
        offset += len;
        return el;
      })}
      <text x="75" y="80" textAnchor="middle" fill="var(--fg)" fontSize="28" fontWeight="700">{total}</text>
    </svg>
  );
}

const ACTION_ICON: Record<string, typeof KeyRound> = {
  license_key: KeyRound, redeemed: KeyRound, suspended: PauseCircle, created: PlusCircle,
  login_failed: ShieldAlert, login: Fingerprint,
};

export function SuperAdminDashboard() {
  const t = useT();
  const [data, setData] = useState<DashboardData | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [plansSummary, setPlansSummary] = useState<PlansSummary | null>(null);
  const [licenses, setLicenses] = useState<LicenseRow[] | null>(null);
  const [logs, setLogs] = useState<AuditLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<DashboardData>("/super-admin/dashboard").then(setData).catch((e) => setError(e.message));
    api.get<AnalyticsData>("/super-admin/analytics").then(setAnalytics).catch(() => {});
    api.get<{ plans: unknown[]; summary: PlansSummary }>("/super-admin/plans").then((d) => setPlansSummary(d.summary)).catch(() => {});
    api.get<{ licenses: LicenseRow[] }>("/super-admin/licenses").then((d) => setLicenses(d.licenses)).catch(() => {});
    api.get<{ logs: AuditLog[] }>("/super-admin/audit-logs").then((d) => setLogs(d.logs)).catch(() => {});
  }, []);

  const trendChartData = analytics?.trend.map((p) => ({ ...p, label: fmtDate(p.date) })) ?? [];
  const recentOrgs = licenses ? [...licenses].sort((a, b) => b.tenantCreatedAt.localeCompare(a.tenantCreatedAt)).slice(0, 5) : null;
  const recentActivity = logs ? [...logs].slice(0, 6) : null;
  const failedLogins24h = logs ? logs.filter((l) => l.action === "superadmin.login_failed" && Date.now() - new Date(l.at).getTime() < 86_400_000).length : null;

  return (
    <SuperAdminShell>
      <div className="fade-in max-w-[1400px]" style={{ fontFamily: "'DM Sans', sans-serif" }}>
        <PageHeader
          eyebrow={<span style={{ fontFamily: MONO }}>{t("sad.dashEyebrow")} · {quarterLabel()}</span>}
          title={t("sad.dashTitle")}
          subtitle={t("sad.dashSubtitle")}
          actions={
            <>
              <Link to="/super-admin/institutions" className="btn btn-outline h-9"><PlusCircle className="h-4 w-4" /> Create Organization</Link>
              <Link to="/super-admin/license-keys" className="btn btn-outline h-9"><KeyRound className="h-4 w-4" /> Generate License</Link>
              <Link to="/super-admin/maintenance" className="btn btn-outline h-9"><CalendarClock className="h-4 w-4" /> Schedule Maintenance</Link>
            </>
          }
        />

        {error && <ErrorBanner className="mt-6">{error}</ErrorBanner>}

        {!data && !error && (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
          </div>
        )}

        {data && (
          <>
            {/* Revenue — real, from operator-entered plan prices × actual assignments (no payment processor backs this platform). */}
            {plansSummary && (
              <div className="mt-6 flex flex-wrap items-center gap-5 rounded-2xl p-5" style={{ background: "#111110", border: "1px solid var(--border)" }}>
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl" style={{ background: `${LIME}1f`, color: LIME }}><DollarSign className="h-6 w-6" /></span>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-[#9FA096]" style={{ fontFamily: MONO }}>Platform Revenue (MRR)</p>
                  <p className="text-2xl font-bold text-white tabular-nums">{fmtMoney(plansSummary.mrr)}</p>
                </div>
                <div className="ml-auto text-right">
                  <p className="text-[11px] uppercase tracking-wider text-[#9FA096]" style={{ fontFamily: MONO }}>Annualized (ARR)</p>
                  <p className="text-lg font-semibold text-white tabular-nums">{fmtMoney(plansSummary.arr)}</p>
                </div>
              </div>
            )}

            {/* KPI grid — every number below comes straight from the platform's own
                data (institutions/users/exams/plans), nothing is a fabricated trend. */}
            <p className="mb-3 mt-6 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]" style={{ fontFamily: MONO }}>{t("sad.secInstitutions")}</p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
              <StatCard icon={Building2} label={t("sad.totalInstitutions")} value={data.institutions.total} hint={`${data.institutions.active} active`} />
              <StatCard icon={BookOpen} label={t("sad.activeExams")} value={data.exams.active} />
              <StatCard icon={Radio} label={t("sad.liveSessions")} value={data.liveSessions} />
              <StatCard icon={Clock} label="API Uptime (this run)" value={fmtUptime(data.platformUptimeSeconds)} />
            </div>

            <p className="mb-3 mt-6 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]" style={{ fontFamily: MONO }}>{t("sad.secUsers")}</p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
              <StatCard icon={GraduationCap} label={t("sad.students")} value={data.users.students} />
              <StatCard icon={Users} label={t("sad.facilitators")} value={data.users.facilitators} />
              <StatCard icon={Eye} label={t("sad.proctors")} value={data.users.proctors} />
              <StatCard icon={ShieldCheck} label={t("sad.administrators")} value={data.users.administrators} />
            </div>

            {/* Chart + plan allocation — same real /analytics data as the Platform Analytics page. */}
            <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="card p-5 lg:col-span-2">
                <p className="text-sm font-semibold">Platform Activity</p>
                <p className="mt-0.5 text-xs text-[var(--muted)]">New schools vs. new exams, last 30 days.</p>
                <div className="mt-4" style={{ height: 200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trendChartData}>
                      <defs>
                        <linearGradient id="dashSchools" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={LIME} stopOpacity={0.35} /><stop offset="100%" stopColor={LIME} stopOpacity={0} /></linearGradient>
                        <linearGradient id="dashExams" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={CYAN} stopOpacity={0.25} /><stop offset="100%" stopColor={CYAN} stopOpacity={0} /></linearGradient>
                      </defs>
                      <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" tick={{ fill: DIM, fontSize: 10 }} axisLine={false} tickLine={false} interval={Math.ceil(trendChartData.length / 8)} />
                      <YAxis allowDecimals={false} tick={{ fill: DIM, fontSize: 10 }} axisLine={false} tickLine={false} width={28} />
                      <Tooltip content={<DarkTooltip />} />
                      <Area type="monotone" dataKey="schools" name="New schools" stroke={LIME} strokeWidth={2} fill="url(#dashSchools)" dot={false} />
                      <Area type="monotone" dataKey="exams" name="New exams" stroke={CYAN} strokeWidth={2} fill="url(#dashExams)" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-3 flex items-center gap-4 text-xs text-[var(--muted)]">
                  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: LIME }} /> New schools</span>
                  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: CYAN }} /> New exams</span>
                </div>
              </div>

              <div className="card p-5">
                <p className="text-sm font-semibold">Plan Allocation</p>
                <p className="mt-0.5 text-xs text-[var(--muted)]">Organizations by plan tier.</p>
                <div className="mt-3 flex justify-center">
                  {analytics ? <PlanDonut slices={analytics.planDistribution} /> : <Skeleton className="h-[150px] w-[150px] rounded-full" />}
                </div>
                <div className="mt-3 space-y-1.5">
                  {(analytics?.planDistribution ?? []).map((s, i) => (
                    <div key={s.planId ?? "none"} className="flex items-center gap-2 text-xs">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.planId === null ? DIM : PLAN_COLORS[i % PLAN_COLORS.length] }} />
                      <span className="truncate text-[var(--muted)]">{s.planName}</span>
                      <span className="ml-auto font-semibold tabular-nums">{s.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Security snapshot + recent activity — real audit log + MFA adoption,
                no fabricated severities or source IPs. */}
            <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="card p-5">
                <div className="flex items-center gap-2 text-sm font-semibold"><ShieldAlert className="h-4 w-4 text-brand-400" /> Security Snapshot</div>
                <div className="mt-4 grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-xl font-bold tabular-nums">{failedLogins24h ?? "—"}</p>
                    <p className="mt-0.5 text-[10px] uppercase tracking-wide text-[var(--muted)]">Failed console logins (24h)</p>
                  </div>
                  <div>
                    <p className="text-xl font-bold tabular-nums">{data.mfaAdoptionPct}%</p>
                    <p className="mt-0.5 text-[10px] uppercase tracking-wide text-[var(--muted)]">Staff MFA adoption</p>
                  </div>
                  <div>
                    <p className={clsx("text-xl font-bold tabular-nums", data.institutions.suspended > 0 && "text-amber-400")}>{data.institutions.suspended}</p>
                    <p className="mt-0.5 text-[10px] uppercase tracking-wide text-[var(--muted)]">Suspended schools</p>
                  </div>
                </div>
                <Link to="/super-admin/security" className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-400 hover:underline">
                  <ScrollText className="h-3.5 w-3.5" /> Open Security Center
                </Link>
              </div>

              <div className="card p-5">
                <div className="flex items-center gap-2 text-sm font-semibold"><Activity className="h-4 w-4 text-brand-400" /> Recent Platform Activity</div>
                {!recentActivity ? (
                  <div className="mt-3 space-y-2"><Skeleton className="h-5 w-full" /><Skeleton className="h-5 w-full" /><Skeleton className="h-5 w-full" /></div>
                ) : recentActivity.length === 0 ? (
                  <p className="mt-3 text-xs text-[var(--muted)]">No platform activity recorded yet.</p>
                ) : (
                  <div className="mt-3 divide-y divide-[var(--border)]">
                    {recentActivity.map((l) => {
                      const verb = l.action.split(".")[1] ?? l.action;
                      const Icon = ACTION_ICON[verb] ?? Activity;
                      return (
                        <div key={l.id} className="flex items-center gap-2.5 py-2 text-xs">
                          <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
                          <span className="min-w-0 flex-1 truncate"><span className="font-medium">{l.actorName}</span> <span className="text-[var(--muted)]">{verb.replace(/_/g, " ")}</span> {l.target && <span className="text-[var(--muted)]">— {l.target}</span>}</span>
                          <span className="shrink-0 text-[var(--muted)]">{ago(l.at)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Recent organizations — real, from the same Active Licenses data (name, plan, status, seats used). */}
            <div className="card mt-6 overflow-hidden p-0">
              <div className="flex items-center justify-between p-5 pb-0">
                <div>
                  <p className="text-sm font-semibold">Recent Organizations</p>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">Newest schools on the platform.</p>
                </div>
                <Link to="/super-admin/institutions" className="text-xs font-semibold text-brand-400 hover:underline">View all</Link>
              </div>
              {!recentOrgs ? (
                <div className="p-5"><Skeleton className="h-32 w-full" /></div>
              ) : recentOrgs.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-[var(--muted)]">No schools yet.</p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wide text-[var(--muted)]" style={{ fontFamily: MONO }}>
                        <th className="px-5 py-3 font-semibold">Name</th>
                        <th className="px-3 py-3 font-semibold">Tier</th>
                        <th className="px-3 py-3 font-semibold">Status</th>
                        <th className="px-3 py-3 text-right font-semibold">Students</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentOrgs.map((r) => (
                        <tr key={r.tenantId} className="border-b border-[var(--border)] last:border-0">
                          <td className="px-5 py-3 font-medium">{r.tenantName}</td>
                          <td className="px-3 py-3">{r.planName ? <span className="rounded-lg border border-[var(--border)] px-2 py-0.5 text-xs font-semibold">{r.planName}</span> : <span className="text-xs text-[var(--muted)]">No plan</span>}</td>
                          <td className="px-3 py-3"><span className={r.tenantStatus === "active" ? "text-emerald-400" : "text-rose-400"}>{r.tenantStatus}</span></td>
                          <td className="px-3 py-3 text-right tabular-nums">{r.usage.students}</td>
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
