import { useEffect, useState } from "react";
import { Loader2, Check, KeyRound, Settings2, Building2, ShieldCheck, ShieldOff, AlertTriangle } from "lucide-react";
import { SuperAdminShell } from "@/components/SuperAdminShell";
import { PageHeader } from "@/components/PageHeader";
import { TableSkeleton, Modal, ErrorBanner } from "@/components/ui";
import { api } from "@/lib/api";
import { useSuperAdminAuth } from "@/lib/superAdminAuth";
import type { Plan } from "@shared/types";
import { clsx } from "clsx";

interface LicenseRow {
  tenantId: string; tenantName: string; tenantStatus: "active" | "suspended";
  planId: string | null; planName: string | null;
  licenseStatus: "trial" | "active" | "expired" | null; licenseExpiresAt: string | null;
  limits: { maxStudents: number | null; maxStaff: number | null; maxActiveExams: number | null } | null;
  usage: { students: number; staff: number; activeExams: number };
}

function nearAnyLimit(r: LicenseRow): boolean {
  if (!r.limits) return false;
  const dims: [number, number | null][] = [[r.usage.students, r.limits.maxStudents], [r.usage.staff, r.limits.maxStaff], [r.usage.activeExams, r.limits.maxActiveExams]];
  return dims.some(([used, limit]) => limit != null && used / Math.max(1, limit) >= 0.8);
}

function StatCard({ icon: Icon, label, value }: { icon: typeof Building2; label: string; value: string }) {
  return (
    <div className="card flex items-center gap-3 p-4">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#c6ff34]/10 text-[#c6ff34]"><Icon className="h-5 w-5" /></div>
      <div>
        <p className="text-xl font-bold tabular-nums">{value}</p>
        <p className="text-xs text-[var(--muted)]">{label}</p>
      </div>
    </div>
  );
}

function UsageBar({ used, limit }: { used: number; limit: number | null }) {
  if (limit === null) return <span className="tabular-nums text-[var(--muted)]">{used} / ∞</span>;
  const pct = Math.min(100, (used / Math.max(1, limit)) * 100);
  const near = used >= limit;
  const warn = pct >= 80;
  return (
    <div className="flex items-center gap-2">
      <span className={clsx("tabular-nums", near ? "font-semibold text-rose-400" : warn ? "text-amber-400" : "")}>{used} / {limit}</span>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/10">
        <div className={clsx("h-full rounded-full", near ? "bg-rose-400" : warn ? "bg-amber-400" : "bg-emerald-400")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

type LicenseFilter = "all" | "licensed" | "unlicensed" | "near-limit";

export function SuperAdminLicenses() {
  const { superAdmin } = useSuperAdminAuth();
  const isOwner = (superAdmin?.role ?? "owner") === "owner";
  const [rows, setRows] = useState<LicenseRow[] | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [managing, setManaging] = useState<LicenseRow | null>(null);
  const [filter, setFilter] = useState<LicenseFilter>("all");

  const load = () => {
    api.get<{ licenses: LicenseRow[] }>("/super-admin/licenses").then((d) => setRows(d.licenses)).catch((e) => setError(e.message));
    api.get<{ plans: Plan[] }>("/super-admin/plans").then((d) => setPlans(d.plans)).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const licensedCount = (rows ?? []).filter((r) => r.planId).length;
  const unlicensedCount = (rows ?? []).filter((r) => !r.planId).length;
  const nearLimitCount = (rows ?? []).filter(nearAnyLimit).length;
  const visible = (rows ?? []).filter((r) => {
    if (filter === "licensed") return !!r.planId;
    if (filter === "unlicensed") return !r.planId;
    if (filter === "near-limit") return nearAnyLimit(r);
    return true;
  });

  return (
    <SuperAdminShell>
      <div className="fade-in max-w-6xl">
        <PageHeader eyebrow="Licensing" title="Active Licenses" subtitle="Every school's assigned plan and live usage against its limits — assign a plan directly, or redeem a license key from Licensing → License Keys." />

        {error && <ErrorBanner className="mt-4">{error}</ErrorBanner>}

        {rows && (
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard icon={Building2} label="Total schools" value={String(rows.length)} />
            <StatCard icon={ShieldCheck} label="Licensed" value={String(licensedCount)} />
            <StatCard icon={ShieldOff} label="No plan" value={String(unlicensedCount)} />
            <StatCard icon={AlertTriangle} label="Near a limit" value={String(nearLimitCount)} />
          </div>
        )}

        <div className="mt-6 flex gap-1 border-b border-[var(--border)]">
          {([["all", "All schools"], ["licensed", "Licensed"], ["unlicensed", "No plan"], ["near-limit", "Near a limit"]] as [LicenseFilter, string][]).map(([f, label]) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={clsx(
                "border-b-2 px-3 py-2 text-sm font-medium",
                filter === f ? "border-[#c6ff34] text-[var(--fg)]" : "border-transparent text-[var(--muted)] hover:text-[var(--fg)]",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="card mt-4 overflow-hidden">
          {!rows ? (
            <TableSkeleton rows={3} cells={6} />
          ) : visible.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-[var(--muted)]">{filter === "all" ? "No schools yet." : "No schools match this filter."}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
                    <th className="px-4 py-3 font-semibold">School</th>
                    <th className="px-3 py-3 font-semibold">Plan</th>
                    <th className="px-3 py-3 font-semibold">Students</th>
                    <th className="px-3 py-3 font-semibold">Staff</th>
                    <th className="px-3 py-3 font-semibold">Active exams</th>
                    <th className="px-3 py-3 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => (
                    <tr key={r.tenantId} className="border-b border-[var(--border)] last:border-0 hover:bg-white/[0.02]">
                      <td className="px-4 py-3 font-medium">{r.tenantName}</td>
                      <td className="px-3 py-3">
                        {r.planName ? (
                          <span className="rounded-lg border border-[var(--border)] px-2 py-0.5 text-xs font-semibold">{r.planName}</span>
                        ) : (
                          <span className="text-xs text-[var(--muted)]">No plan assigned</span>
                        )}
                      </td>
                      <td className="px-3 py-3"><UsageBar used={r.usage.students} limit={r.limits?.maxStudents ?? null} /></td>
                      <td className="px-3 py-3"><UsageBar used={r.usage.staff} limit={r.limits?.maxStaff ?? null} /></td>
                      <td className="px-3 py-3"><UsageBar used={r.usage.activeExams} limit={r.limits?.maxActiveExams ?? null} /></td>
                      <td className="px-3 py-3 text-right">
                        {isOwner && (
                          <button onClick={() => setManaging(r)} title="Manage license" className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-white/[0.05] hover:text-[var(--fg)]">
                            <Settings2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {managing && <ManageLicenseModal row={managing} plans={plans} onClose={() => setManaging(null)} onDone={() => { setManaging(null); load(); }} />}
    </SuperAdminShell>
  );
}

function ManageLicenseModal({ row, plans, onClose, onDone }: { row: LicenseRow; plans: Plan[]; onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<"assign" | "redeem">("assign");
  const [planId, setPlanId] = useState(row.planId ?? "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const activePlans = plans.filter((p) => !p.archived || p.id === row.planId);

  async function assign() {
    setBusy(true); setErr(null);
    try {
      await api.patch(`/super-admin/tenants/${row.tenantId}/license`, { planId: planId || null, licenseStatus: planId ? "active" : undefined });
      onDone();
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  async function redeem() {
    if (!code.trim()) return;
    setBusy(true); setErr(null);
    try {
      await api.post(`/super-admin/tenants/${row.tenantId}/redeem-license`, { code: code.trim() });
      onDone();
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  return (
    <Modal title={`Manage license — ${row.tenantName}`} onClose={onClose}>
      <div className="mt-3 flex gap-1 rounded-lg border border-[var(--border)] bg-[var(--card-2)] p-1">
        <button onClick={() => setMode("assign")} className={clsx("flex-1 rounded-md px-3 py-1.5 text-sm font-medium", mode === "assign" ? "bg-[#c6ff34] text-[#111110]" : "text-[var(--muted)]")}>Assign plan directly</button>
        <button onClick={() => setMode("redeem")} className={clsx("flex-1 rounded-md px-3 py-1.5 text-sm font-medium", mode === "redeem" ? "bg-[#c6ff34] text-[#111110]" : "text-[var(--muted)]")}>Redeem a key</button>
      </div>

      {mode === "assign" ? (
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Plan</span>
            <select className="input h-10" value={planId} onChange={(e) => setPlanId(e.target.value)}>
              <option value="">No plan (unrestricted)</option>
              {activePlans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">License key code</span>
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 shrink-0 text-[var(--muted)]" />
              <input className="input h-10 flex-1" value={code} onChange={(e) => setCode(e.target.value)} placeholder="ORCL-XXXX-XXXX-XXXX" />
            </div>
          </label>
        </div>
      )}
      {err && <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">{err}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--fg)]">Cancel</button>
        <button onClick={mode === "assign" ? assign : redeem} disabled={busy || (mode === "redeem" && !code.trim())} className="btn btn-primary disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {mode === "assign" ? "Save" : "Redeem"}
        </button>
      </div>
    </Modal>
  );
}
