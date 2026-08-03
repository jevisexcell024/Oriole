import { useEffect, useState } from "react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { SuperAdminShell } from "@/components/SuperAdminShell";
import { PageHeader } from "@/components/PageHeader";
import { TableSkeleton, ErrorBanner } from "@/components/ui";
import { api } from "@/lib/api";

// Same data-ink palette as the tenant-side Analytics page (src/pages/AdminAnalytics.tsx)
// for visual consistency across the app's charts, wrapped in this console's own card style.
const LIME = "#c8f53d";
const CYAN = "#22d3ee";
const CARD = "#1A1A18";
const DIM = "#5a5a6a";
const PLAN_COLORS = ["#c8f53d", "#22d3ee", "#c084fc", "#fb923c", "#4ade80", "#f43f5e"];

interface TrendPoint { date: string; schools: number; exams: number; }
interface PlanSlice { planId: string | null; planName: string; count: number; }
interface TopInstitution { id: string; name: string; status: "active" | "suspended"; students: number; exams: number; createdAt: string; }
interface AnalyticsData { trend: TrendPoint[]; planDistribution: PlanSlice[]; topInstitutions: TopInstitution[]; }

function DarkTooltip({ active, payload, label }: { active?: boolean; payload?: { name?: string; value?: number | string; color?: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card-2)] px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }}>{p.name}: <span className="font-semibold">{p.value}</span></p>
      ))}
    </div>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function SuperAdminAnalytics() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<AnalyticsData>("/super-admin/analytics").then(setData).catch((e) => setError(e.message));
  }, []);

  const trendChartData = data?.trend.map((t) => ({ ...t, label: fmtDate(t.date) })) ?? [];
  const totalTenants = data?.planDistribution.reduce((sum, p) => sum + p.count, 0) ?? 0;

  return (
    <SuperAdminShell>
      <div className="fade-in max-w-6xl">
        <PageHeader eyebrow="Platform" title="Platform Analytics" subtitle="Cross-school trends and breakdowns — nothing here is scoped to one tenant, unlike every other analytics view in the app." />

        {error && <ErrorBanner className="mt-4">{error}</ErrorBanner>}

        {!data ? (
          <div className="mt-6"><TableSkeleton rows={4} cells={4} /></div>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="card p-5 lg:col-span-2">
              <p className="text-sm font-semibold">New schools & exams, last 30 days</p>
              <p className="mt-0.5 text-xs text-[var(--muted)]">Counted from each record's own creation date.</p>
              <div className="mt-4" style={{ height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trendChartData}>
                    <defs>
                      <linearGradient id="gSchools" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={LIME} stopOpacity={0.35} /><stop offset="100%" stopColor={LIME} stopOpacity={0} /></linearGradient>
                      <linearGradient id="gExams" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={CYAN} stopOpacity={0.25} /><stop offset="100%" stopColor={CYAN} stopOpacity={0} /></linearGradient>
                    </defs>
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: DIM, fontSize: 10 }} axisLine={false} tickLine={false} interval={Math.ceil(trendChartData.length / 8)} />
                    <YAxis allowDecimals={false} tick={{ fill: DIM, fontSize: 10 }} axisLine={false} tickLine={false} width={28} />
                    <Tooltip content={<DarkTooltip />} />
                    <Area type="monotone" dataKey="schools" name="New schools" stroke={LIME} strokeWidth={2} fill="url(#gSchools)" dot={false} />
                    <Area type="monotone" dataKey="exams" name="New exams" stroke={CYAN} strokeWidth={2} fill="url(#gExams)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 flex items-center gap-4 text-xs text-[var(--muted)]">
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: LIME }} /> New schools</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: CYAN }} /> New exams</span>
              </div>
            </div>

            <div className="card p-5">
              <p className="text-sm font-semibold">Plan distribution</p>
              <p className="mt-0.5 text-xs text-[var(--muted)]">{totalTenants} school{totalTenants === 1 ? "" : "s"} total.</p>
              {data.planDistribution.length === 0 ? (
                <p className="mt-6 text-xs text-[var(--muted)]">No schools yet.</p>
              ) : (
                <div className="mt-4" style={{ height: 180 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.planDistribution} layout="vertical" margin={{ left: 8 }}>
                      <XAxis type="number" allowDecimals={false} tick={{ fill: DIM, fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="planName" tick={{ fill: DIM, fontSize: 10 }} axisLine={false} tickLine={false} width={110} />
                      <Tooltip content={<DarkTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                      <Bar dataKey="count" name="Schools" radius={[0, 3, 3, 0]} maxBarSize={18}>
                        {data.planDistribution.map((slice, i) => (
                          <Cell key={slice.planId ?? "none"} fill={slice.planId === null ? DIM : PLAN_COLORS[i % PLAN_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="card overflow-hidden p-0 lg:col-span-3">
              <div className="p-5 pb-0">
                <p className="text-sm font-semibold">Largest schools</p>
                <p className="mt-0.5 text-xs text-[var(--muted)]">By student count, top 10.</p>
              </div>
              {data.topInstitutions.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-[var(--muted)]">No schools yet.</p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
                        <th className="px-5 py-3 font-semibold">School</th>
                        <th className="px-3 py-3 font-semibold">Status</th>
                        <th className="px-3 py-3 text-right font-semibold">Students</th>
                        <th className="px-3 py-3 text-right font-semibold">Exams</th>
                        <th className="px-3 py-3 font-semibold">Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.topInstitutions.map((row) => (
                        <tr key={row.id} className="border-b border-[var(--border)] last:border-0">
                          <td className="px-5 py-3 font-medium">{row.name}</td>
                          <td className="px-3 py-3">
                            <span className={row.status === "active" ? "text-emerald-400" : "text-rose-400"}>{row.status}</span>
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums">{row.students}</td>
                          <td className="px-3 py-3 text-right tabular-nums">{row.exams}</td>
                          <td className="px-3 py-3 text-[var(--muted)]">{new Date(row.createdAt).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </SuperAdminShell>
  );
}
