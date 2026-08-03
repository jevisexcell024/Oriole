import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, ShieldCheck, PauseCircle, LogIn, Download, Trash2, Loader2, Search } from "lucide-react";
import { SuperAdminShell } from "@/components/SuperAdminShell";
import { PageHeader } from "@/components/PageHeader";
import { TableSkeleton, Modal, ErrorBanner } from "@/components/ui";
import { api } from "@/lib/api";
import { useSuperAdminAuth } from "@/lib/superAdminAuth";
import type { Tenant, Plan } from "@shared/types";
import { clsx } from "clsx";

interface Admin { id: string; name: string; email: string; }
interface ActivityEntry { id: string; at: string; actorName: string; action: string; target: string; }
interface Detail {
  tenant: Tenant; plan: Plan | null;
  usage: { students: number; staff: number; activeExams: number }; totalExams: number;
  admins: Admin[]; recentActivity: ActivityEntry[];
}

function UsageStat({ label, used, limit }: { label: string; used: number; limit: number | null | undefined }) {
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{used}{limit != null ? <span className="text-sm font-normal text-[var(--muted)]"> / {limit}</span> : null}</p>
    </div>
  );
}

function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

export function SuperAdminTenantDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { superAdmin } = useSuperAdminAuth();
  const isOwner = (superAdmin?.role ?? "owner") === "owner";
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [activitySearch, setActivitySearch] = useState("");

  const load = () => api.get<Detail>(`/super-admin/tenants/${id}`).then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [id]);

  async function toggleStatus() {
    if (!data) return;
    setBusy(true); setError(null);
    try {
      await api.patch(`/super-admin/tenants/${id}`, { status: data.tenant.status === "active" ? "suspended" : "active" });
      setConfirmSuspend(false);
      load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function loginAs() {
    setBusy(true); setError(null);
    try {
      await api.post(`/super-admin/tenants/${id}/impersonate`);
      window.location.href = "/admin/dashboard";
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  async function exportData() {
    setError(null);
    try {
      const res = await fetch(`/api/super-admin/tenants/${id}/export`, { credentials: "include" });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${data?.tenant.name.replace(/[^a-z0-9]+/gi, "-") ?? "export"}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { setError((e as Error).message); }
  }

  async function deleteData() {
    if (!data) return;
    setBusy(true); setError(null);
    try {
      await api.del(`/super-admin/tenants/${id}`, { confirmName: typedName });
      navigate("/super-admin/institutions");
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  if (!data) {
    return (
      <SuperAdminShell>
        <div className="fade-in max-w-4xl">
          {error ? <ErrorBanner>{error}</ErrorBanner> : <TableSkeleton rows={4} cells={3} />}
        </div>
      </SuperAdminShell>
    );
  }

  const { tenant, plan, usage, totalExams, admins, recentActivity } = data;
  const q = activitySearch.trim().toLowerCase();
  const visibleActivity = q ? recentActivity.filter((h) => h.target.toLowerCase().includes(q) || h.actorName.toLowerCase().includes(q) || h.action.toLowerCase().includes(q)) : recentActivity;

  return (
    <SuperAdminShell>
      <div className="fade-in max-w-4xl">
        <Link to="/super-admin/institutions" className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--muted)] hover:text-[var(--fg)]">
          <ArrowLeft className="h-3.5 w-3.5" /> Institutions
        </Link>
        <div className="flex items-start justify-between gap-3">
          <PageHeader eyebrow="Institutions" title={tenant.name} subtitle={`Created ${new Date(tenant.createdAt).toLocaleDateString()} · ${daysSince(tenant.createdAt)} days ago`} />
          {tenant.status === "active" ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400"><ShieldCheck className="h-3 w-3" /> Active</span>
          ) : (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-rose-500/15 px-2.5 py-1 text-xs font-semibold text-rose-400"><PauseCircle className="h-3 w-3" /> Suspended</span>
          )}
        </div>

        {error && <ErrorBanner className="mt-4">{error}</ErrorBanner>}

        <div className="mt-5 flex flex-wrap gap-2">
          <button onClick={loginAs} disabled={busy || admins.length === 0 || tenant.status === "suspended"} className="btn btn-primary disabled:opacity-50">
            <LogIn className="h-4 w-4" /> Log in as admin
          </button>
          <button onClick={exportData} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium hover:bg-white/[0.05]"><Download className="h-4 w-4" /> Export data</button>
          {isOwner && (
            <button onClick={() => setConfirmSuspend(true)} disabled={busy} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium hover:bg-white/[0.05] disabled:opacity-50">
              {tenant.status === "active" ? "Suspend" : "Reactivate"}
            </button>
          )}
          {isOwner && tenant.status === "suspended" && (
            <button onClick={() => setConfirmDelete(true)} className="rounded-lg border border-rose-500/30 px-3 py-2 text-sm font-medium text-rose-400 hover:bg-rose-500/10"><Trash2 className="h-4 w-4" /> Delete data</button>
          )}
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <UsageStat label="Students" used={usage.students} limit={plan?.limits.maxStudents} />
          <UsageStat label="Staff" used={usage.staff} limit={plan?.limits.maxStaff} />
          <UsageStat label="Active exams" used={usage.activeExams} limit={plan?.limits.maxActiveExams} />
          <UsageStat label="Total exams" used={totalExams} limit={null} />
        </div>

        <div className="mt-3 card flex items-center justify-between p-4">
          <div className="flex items-center gap-2.5">
            <div>
              <p className="text-sm font-semibold">License</p>
              <p className="mt-0.5 text-xs text-[var(--muted)]">{plan ? plan.name : "No plan assigned"}</p>
            </div>
            {tenant.licenseStatus && (
              <span className={clsx(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                tenant.licenseStatus === "active" ? "bg-emerald-500/15 text-emerald-400" : tenant.licenseStatus === "trial" ? "bg-cyan-500/15 text-cyan-400" : "bg-rose-500/15 text-rose-400",
              )}>
                {tenant.licenseStatus}
              </span>
            )}
          </div>
          <Link to="/super-admin/licenses" className="text-xs font-medium text-[var(--muted)] hover:text-[var(--fg)]">Manage →</Link>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <p className="text-sm font-semibold">Admin accounts</p>
            <div className="card mt-2 overflow-hidden">
              {admins.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-[var(--muted)]">No admin account yet.</p>
              ) : (
                <div className="divide-y divide-[var(--border)]">
                  {admins.map((a) => (
                    <div key={a.id} className="px-4 py-2.5">
                      <p className="text-sm font-medium">{a.name}</p>
                      <p className="text-xs text-[var(--muted)]">{a.email}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">Recent activity</p>
              {recentActivity.length > 0 && (
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--muted)]" />
                  <input className="input h-7 w-36 pl-6 text-xs" value={activitySearch} onChange={(e) => setActivitySearch(e.target.value)} placeholder="Filter..." />
                </div>
              )}
            </div>
            <div className="card mt-2 overflow-hidden">
              {recentActivity.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-[var(--muted)]">No activity recorded yet.</p>
              ) : visibleActivity.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-[var(--muted)]">No matching activity.</p>
              ) : (
                <div className="divide-y divide-[var(--border)]">
                  {visibleActivity.map((h) => (
                    <div key={h.id} className="px-4 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm">{h.target}</span>
                        <span className="shrink-0 text-[11px] text-[var(--muted)]">{new Date(h.at).toLocaleDateString()}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-[var(--muted)]">{h.actorName}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {confirmSuspend && (
        <Modal title={tenant.status === "active" ? "Suspend school" : "Reactivate school"} onClose={() => setConfirmSuspend(false)}>
          <p className="mt-3 text-sm text-[var(--muted)]">
            {tenant.status === "active"
              ? `Every account at ${tenant.name} — including already-open sessions — will be signed out immediately.`
              : `Restores access for ${tenant.name} immediately.`}
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={() => setConfirmSuspend(false)} className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--fg)]">Cancel</button>
            <button onClick={toggleStatus} disabled={busy} className="btn btn-danger disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : tenant.status === "active" ? "Suspend" : "Reactivate"}</button>
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <Modal title={`Delete all data for ${tenant.name}`} onClose={() => setConfirmDelete(false)}>
          <p className="mt-3 text-sm text-[var(--muted)]">This permanently deletes every row this school owns. Type the school's name to confirm.</p>
          <input className="input mt-4 h-10" value={typedName} onChange={(e) => setTypedName(e.target.value)} placeholder={tenant.name} autoFocus />
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={() => setConfirmDelete(false)} className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--fg)]">Cancel</button>
            <button onClick={deleteData} disabled={busy || typedName.trim() !== tenant.name} className="btn btn-danger disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Delete
            </button>
          </div>
        </Modal>
      )}
    </SuperAdminShell>
  );
}
