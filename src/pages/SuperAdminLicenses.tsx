import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Loader2, Check, KeyRound, Settings2, Building2, ShieldCheck, ShieldOff, AlertTriangle,
  Search, ChevronDown, ChevronUp, X, Copy, RotateCcw, Ban, Download, Plus, Users, Layers,
  ChevronLeft, ChevronRight, Clock,
} from "lucide-react";
import { SuperAdminShell } from "@/components/SuperAdminShell";
import { PageHeader } from "@/components/PageHeader";
import { TableSkeleton, Modal, ErrorBanner } from "@/components/ui";
import { api } from "@/lib/api";
import { useSuperAdminAuth } from "@/lib/superAdminAuth";
import type { Plan } from "@shared/types";
import { clsx } from "clsx";

const LIME = "#c6ff34";
const INK = "#111110";

interface LicenseRow {
  tenantId: string; tenantName: string; tenantStatus: "active" | "suspended"; tenantCreatedAt: string;
  planId: string | null; planName: string | null; planCode: string | null;
  licenseStatus: "trial" | "active" | "expired" | null; licenseExpiresAt: string | null;
  redeemedKeyCode: string | null;
  limits: { maxStudents: number | null; maxStaff: number | null; maxActiveExams: number | null } | null;
  usage: { students: number; staff: number; activeExams: number };
}

type DerivedStatus = "active" | "expiring" | "expired" | "unlicensed";

function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

function derivedStatus(r: LicenseRow): DerivedStatus {
  if (!r.planId) return "unlicensed";
  const d = daysLeft(r.licenseExpiresAt);
  if (d !== null && d < 0) return "expired";
  if (d !== null && d <= 30) return "expiring";
  return "active";
}

function nearAnyLimit(r: LicenseRow): boolean {
  if (!r.limits) return false;
  const dims: [number, number | null][] = [[r.usage.students, r.limits.maxStudents], [r.usage.staff, r.limits.maxStaff], [r.usage.activeExams, r.limits.maxActiveExams]];
  return dims.some(([used, limit]) => limit != null && used / Math.max(1, limit) >= 0.8);
}

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "No expiry";
}

const STATUS_META: Record<DerivedStatus, { label: string; bg: string; text: string }> = {
  active: { label: "Active", bg: "rgba(22,163,74,0.15)", text: "#4ade80" },
  expiring: { label: "Expiring", bg: "rgba(217,119,6,0.15)", text: "#fbbf24" },
  expired: { label: "Expired", bg: "rgba(220,38,38,0.15)", text: "#f87171" },
  unlicensed: { label: "No Plan", bg: "rgba(148,163,184,0.15)", text: "#94a3b8" },
};

function StatusBadge({ status }: { status: DerivedStatus }) {
  const m = STATUS_META[status];
  return <span className="inline-flex items-center rounded-full px-3 text-xs font-semibold" style={{ height: 24, background: m.bg, color: m.text }}>{m.label}</span>;
}

function DaysLeftBadge({ days }: { days: number | null }) {
  if (days === null) return <span className="text-xs text-[var(--muted)]">—</span>;
  if (days < 0) return <span className="inline-flex items-center rounded-full px-2.5 text-xs font-semibold" style={{ height: 22, background: "rgba(220,38,38,0.15)", color: "#f87171" }}>Expired</span>;
  const warn = days <= 30;
  return (
    <span className="inline-flex items-center rounded-full px-2.5 text-xs font-semibold tabular-nums" style={{ height: 22, background: warn ? "rgba(217,119,6,0.15)" : "rgba(22,163,74,0.15)", color: warn ? "#fbbf24" : "#4ade80" }}>
      {days} {days === 1 ? "day" : "days"}
    </span>
  );
}

function KpiCard({ icon: Icon, label, value, description, color }: { icon: typeof Building2; label: string; value: string; description: string; color: string }) {
  return (
    <div className="card flex items-center gap-4 rounded-[14px] p-5" style={{ height: 98 }}>
      <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full" style={{ background: `${color}1f`, color }}>
        <Icon className="h-6 w-6" />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-[var(--muted)]">{label}</p>
        <p className="text-[28px] font-bold leading-tight tabular-nums text-[var(--fg)]">{value}</p>
        <p className="truncate text-[11px] text-[var(--muted)]">{description}</p>
      </div>
    </div>
  );
}

type SortKey = "tenantName" | "planName" | "seatsUsed" | "daysLeft" | "status";
type StatusFilter = "all" | DerivedStatus;
type ExpiryFilter = "all" | "30" | "90" | "expired";

function useIsNarrow(breakpoint = 1280) {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < breakpoint);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const onChange = () => setNarrow(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [breakpoint]);
  return narrow;
}

export function SuperAdminLicenses() {
  const navigate = useNavigate();
  const { superAdmin } = useSuperAdminAuth();
  const isOwner = (superAdmin?.role ?? "owner") === "owner";
  const [rows, setRows] = useState<LicenseRow[] | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [managing, setManaging] = useState<LicenseRow | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [planFilter, setPlanFilter] = useState<string>("all");
  const [expiryFilter, setExpiryFilter] = useState<ExpiryFilter>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "tenantName", dir: 1 });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const isNarrow = useIsNarrow();

  const load = () => {
    api.get<{ licenses: LicenseRow[] }>("/super-admin/licenses").then((d) => setRows(d.licenses)).catch((e) => setError(e.message));
    api.get<{ plans: Plan[] }>("/super-admin/plans").then((d) => setPlans(d.plans)).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  // ── KPIs — every figure below comes straight from the real license rows,
  // nothing here is a placeholder. "Total Seats Licensed" only sums plans with
  // a finite student cap — unlimited plans would make an honest sum
  // impossible, so they're excluded from that total rather than counted as 0. ──
  const kpis = useMemo(() => {
    const list = rows ?? [];
    const total = list.length;
    const active = list.filter((r) => derivedStatus(r) === "active").length;
    const expiring = list.filter((r) => derivedStatus(r) === "expiring").length;
    const expired = list.filter((r) => derivedStatus(r) === "expired").length;
    const seatsLicensed = list.reduce((s, r) => s + (r.limits?.maxStudents ?? 0), 0);
    const seatsUsed = list.reduce((s, r) => s + r.usage.students, 0);
    return { total, active, expiring, expired, seatsLicensed, seatsUsed };
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows ?? [];
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((r) => r.tenantName.toLowerCase().includes(q) || (r.planName ?? "").toLowerCase().includes(q));
    if (statusFilter !== "all") list = list.filter((r) => derivedStatus(r) === statusFilter);
    if (planFilter !== "all") list = list.filter((r) => r.planId === planFilter);
    if (expiryFilter !== "all") {
      list = list.filter((r) => {
        const d = daysLeft(r.licenseExpiresAt);
        if (expiryFilter === "expired") return d !== null && d < 0;
        if (expiryFilter === "30") return d !== null && d >= 0 && d <= 30;
        if (expiryFilter === "90") return d !== null && d >= 0 && d <= 90;
        return true;
      });
    }
    return list;
  }, [rows, search, statusFilter, planFilter, expiryFilter]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    const { key, dir } = sort;
    list.sort((a, b) => {
      if (key === "tenantName") return a.tenantName.localeCompare(b.tenantName) * dir;
      if (key === "planName") return (a.planName ?? "").localeCompare(b.planName ?? "") * dir;
      if (key === "seatsUsed") return (a.usage.students - b.usage.students) * dir;
      if (key === "daysLeft") return ((daysLeft(a.licenseExpiresAt) ?? Infinity) - (daysLeft(b.licenseExpiresAt) ?? Infinity)) * dir;
      if (key === "status") return derivedStatus(a).localeCompare(derivedStatus(b)) * dir;
      return 0;
    });
    return list;
  }, [filtered, sort]);

  useEffect(() => { setPage(1); }, [search, statusFilter, planFilter, expiryFilter, pageSize]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const clampedPage = Math.min(page, pageCount);
  const paged = sorted.slice((clampedPage - 1) * pageSize, clampedPage * pageSize);

  const selected = (rows ?? []).find((r) => r.tenantId === selectedId) ?? null;

  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: 1 }));

  const resetFilters = () => { setSearch(""); setStatusFilter("all"); setPlanFilter("all"); setExpiryFilter("all"); };

  const exportCsv = () => {
    const header = ["Institution", "Plan", "Seats Licensed", "Seats Used", "Status", "Expiry Date", "Days Left"];
    const lines = sorted.map((r) => [
      r.tenantName, r.planName ?? "No plan", String(r.limits?.maxStudents ?? "Unlimited"), String(r.usage.students),
      STATUS_META[derivedStatus(r)].label, fmtDate(r.licenseExpiresAt), String(daysLeft(r.licenseExpiresAt) ?? ""),
    ]);
    const csv = [header, ...lines].map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `licenses-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <SuperAdminShell>
      <div className="fade-in">
        <PageHeader
          eyebrow="Licensing" title="Licenses" subtitle="Create, manage and monitor every school's license."
          actions={
            <button onClick={() => navigate("/super-admin/license-keys")} className="btn btn-primary" style={{ height: 44, padding: "0 18px", borderRadius: 10 }}>
              <Plus className="h-4 w-4" /> Create New License
            </button>
          }
        />

        {error && <ErrorBanner className="mt-4">{error}</ErrorBanner>}

        {/* KPI row — 6 real cards */}
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
          <KpiCard icon={Building2} label="Total Licenses" value={String(kpis.total)} description="Schools on the platform" color={LIME} />
          <KpiCard icon={ShieldCheck} label="Active Licenses" value={String(kpis.active)} description="Plan in good standing" color="#4ade80" />
          <KpiCard icon={Clock} label="Expiring Soon" value={String(kpis.expiring)} description="Within 30 days" color="#fbbf24" />
          <KpiCard icon={ShieldOff} label="Expired Licenses" value={String(kpis.expired)} description="Past their expiry" color="#f87171" />
          <KpiCard icon={Layers} label="Total Seats Licensed" value={String(kpis.seatsLicensed)} description="Across capped plans" color="#60a5fa" />
          <KpiCard icon={Users} label="Seats In Use" value={String(kpis.seatsUsed)} description="Students enrolled now" color="#c084fc" />
        </div>

        {/* Filters */}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <div className="relative" style={{ width: 340, maxWidth: "100%" }}>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted)]" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search institution or plan…" className="input pl-9 text-sm" style={{ height: 52, borderRadius: 12 }} />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} className="input text-sm" style={{ width: 140, height: 52, borderRadius: 12 }}>
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="expiring">Expiring</option>
            <option value="expired">Expired</option>
            <option value="unlicensed">No plan</option>
          </select>
          <select value={planFilter} onChange={(e) => setPlanFilter(e.target.value)} className="input text-sm" style={{ width: 160, height: 52, borderRadius: 12 }}>
            <option value="all">All plans</option>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={expiryFilter} onChange={(e) => setExpiryFilter(e.target.value as ExpiryFilter)} className="input text-sm" style={{ width: 160, height: 52, borderRadius: 12 }}>
            <option value="all">Any expiry</option>
            <option value="30">Expiring in 30 days</option>
            <option value="90">Expiring in 90 days</option>
            <option value="expired">Already expired</option>
          </select>
          <button onClick={resetFilters} className="rounded-lg border border-[var(--border)] px-3.5 text-sm font-medium text-[var(--muted)] hover:text-[var(--fg)]" style={{ height: 52 }}>Reset</button>
          <button onClick={exportCsv} className="ml-auto inline-flex items-center gap-2 rounded-lg border px-3.5 text-sm font-semibold" style={{ height: 52, borderColor: LIME, color: LIME }}>
            <Download className="h-4 w-4" /> Export
          </button>
        </div>

        {/* Table + details panel */}
        <div className={clsx("mt-4 grid grid-cols-1 gap-6", !isNarrow && "xl:grid-cols-[1fr_340px]")}>
          <div className="card overflow-hidden rounded-[14px]">
            {!rows ? (
              <TableSkeleton rows={5} cells={7} />
            ) : paged.length === 0 ? (
              <p className="px-4 py-12 text-center text-sm text-[var(--muted)]">No licenses match these filters.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-left text-[12px] font-semibold uppercase tracking-wide text-[var(--muted)]" style={{ height: 52 }}>
                      <Th label="Institution" sortKey="tenantName" sort={sort} onSort={toggleSort} />
                      <Th label="Plan" sortKey="planName" sort={sort} onSort={toggleSort} />
                      <th className="px-3 font-semibold">Seats Licensed</th>
                      <Th label="Seats Used" sortKey="seatsUsed" sort={sort} onSort={toggleSort} />
                      <Th label="Status" sortKey="status" sort={sort} onSort={toggleSort} />
                      <th className="px-3 font-semibold">Expiry Date</th>
                      <Th label="Days Left" sortKey="daysLeft" sort={sort} onSort={toggleSort} />
                      <th className="px-3 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.map((r) => {
                      const status = derivedStatus(r);
                      const isSelected = selectedId === r.tenantId;
                      return (
                        <tr key={r.tenantId} onClick={() => setSelectedId(r.tenantId)}
                          className={clsx("cursor-pointer border-b border-[#EEF2F71a] last:border-0 transition hover:bg-white/[0.02]")}
                          style={{ height: 64, borderLeft: isSelected ? `3px solid ${LIME}` : "3px solid transparent", background: isSelected ? "color-mix(in oklch, #c6ff34 6%, transparent)" : undefined }}>
                          <td className="px-4">
                            <div className="flex items-center gap-2.5">
                              <span className="flex shrink-0 items-center justify-center rounded-full text-xs font-bold" style={{ width: 36, height: 36, background: `${LIME}22`, color: LIME }}>
                                {r.tenantName.slice(0, 2).toUpperCase()}
                              </span>
                              <div className="min-w-0">
                                <p className="truncate font-medium text-[var(--fg)]">{r.tenantName}</p>
                                <p className="truncate text-[11px] text-[var(--muted)]">{r.tenantId}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-3">
                            {r.planName ? <span className="rounded-lg border border-[var(--border)] px-2 py-0.5 text-xs font-semibold">{r.planName}</span> : <span className="text-xs text-[var(--muted)]">No plan</span>}
                          </td>
                          <td className="px-3 tabular-nums">{r.limits?.maxStudents ?? "∞"}</td>
                          <td className="px-3">
                            <span className={clsx("tabular-nums", nearAnyLimit(r) && "font-semibold text-amber-400")}>{r.usage.students}</span>
                          </td>
                          <td className="px-3"><StatusBadge status={status} /></td>
                          <td className="px-3 text-[var(--muted)]">{fmtDate(r.licenseExpiresAt)}</td>
                          <td className="px-3"><DaysLeftBadge days={daysLeft(r.licenseExpiresAt)} /></td>
                          <td className="px-3 text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="inline-flex items-center gap-1.5">
                              <IconBtn title="View" onClick={() => setSelectedId(r.tenantId)}><Settings2 className="h-3.5 w-3.5" /></IconBtn>
                              {isOwner && <IconBtn title="Edit license" onClick={() => setManaging(r)}><KeyRound className="h-3.5 w-3.5" /></IconBtn>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {rows && rows.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--muted)]">
                <span>Showing {sorted.length === 0 ? 0 : (clampedPage - 1) * pageSize + 1}–{Math.min(clampedPage * pageSize, sorted.length)} of {sorted.length} licenses</span>
                <div className="flex items-center gap-2">
                  <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="input h-8 text-xs">
                    <option value={10}>10 per page</option>
                    <option value={25}>25 per page</option>
                    <option value={50}>50 per page</option>
                  </select>
                  <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={clampedPage <= 1} className="flex items-center justify-center rounded-lg border border-[var(--border)] disabled:opacity-40" style={{ width: 36, height: 36 }}><ChevronLeft className="h-4 w-4" /></button>
                  <span className="tabular-nums">{clampedPage} / {pageCount}</span>
                  <button onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={clampedPage >= pageCount} className="flex items-center justify-center rounded-lg border border-[var(--border)] disabled:opacity-40" style={{ width: 36, height: 36 }}><ChevronRight className="h-4 w-4" /></button>
                </div>
              </div>
            )}
          </div>

          {/* Details panel — inline on wide screens, slide-over drawer below 1280px */}
          {!isNarrow && (
            <DetailsPanel row={selected} isOwner={isOwner} onClose={() => setSelectedId(null)} onEdit={() => selected && setManaging(selected)} onChanged={load} />
          )}
        </div>

        {isNarrow && selected && (
          <div className="fixed inset-0 z-40 flex justify-end bg-black/50" onClick={() => setSelectedId(null)}>
            <div className="h-full w-full max-w-[380px] overflow-y-auto bg-[var(--bg)] p-4" onClick={(e) => e.stopPropagation()}>
              <DetailsPanel row={selected} isOwner={isOwner} onClose={() => setSelectedId(null)} onEdit={() => selected && setManaging(selected)} onChanged={load} />
            </div>
          </div>
        )}
      </div>

      {managing && <ManageLicenseModal row={managing} plans={plans} onClose={() => setManaging(null)} onDone={() => { setManaging(null); load(); }} />}
    </SuperAdminShell>
  );
}

function Th({ label, sortKey, sort, onSort }: { label: string; sortKey: SortKey; sort: { key: SortKey; dir: 1 | -1 }; onSort: (k: SortKey) => void }) {
  const active = sort.key === sortKey;
  return (
    <th className="px-3 font-semibold">
      <button onClick={() => onSort(sortKey)} className={clsx("inline-flex items-center gap-1 transition hover:text-[var(--fg)]", active && "text-[var(--fg)]")}>
        {label} {active ? (sort.dir === 1 ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />) : <span className="w-3" />}
      </button>
    </th>
  );
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button title={title} onClick={onClick} className="flex items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] transition hover:bg-white/[0.05] hover:text-[var(--fg)]" style={{ width: 32, height: 32, borderRadius: 8 }}>
      {children}
    </button>
  );
}

// ── Details panel ─────────────────────────────────────────────────────────
interface AuditEntry { id: string; at: string; actorName: string; action: string; target: string }

function DetailsPanel({ row, isOwner, onClose, onEdit, onChanged }: { row: LicenseRow | null; isOwner: boolean; onClose: () => void; onEdit: () => void; onChanged: () => void }) {
  const [copied, setCopied] = useState(false);
  const [issuedBy, setIssuedBy] = useState<{ actorName: string; at: string } | null>(null);
  const [busy, setBusy] = useState<"suspend" | "reactivate" | null>(null);

  useEffect(() => {
    setIssuedBy(null);
    if (!row) return;
    // Real lookup — who last touched this school's license, from the platform
    // audit trail (not fabricated "Issued By" data).
    api.get<{ logs: AuditEntry[] }>("/super-admin/audit-logs").then((d) => {
      const hit = d.logs.find((l) => (l.action === "superadmin.tenant.license_updated" || l.action === "superadmin.license_key.redeemed") && l.target.includes(row.tenantName));
      if (hit) setIssuedBy({ actorName: hit.actorName, at: hit.at });
    }).catch(() => {});
  }, [row?.tenantId]);

  if (!row) {
    return (
      <div className="card hidden rounded-[14px] p-6 xl:flex xl:h-full xl:flex-col xl:items-center xl:justify-center xl:text-center">
        <Building2 className="h-8 w-8 text-[var(--muted)]" />
        <p className="mt-3 text-sm text-[var(--muted)]">Select a license to see its details here.</p>
      </div>
    );
  }

  const status = derivedStatus(row);
  const seatsLicensed = row.limits?.maxStudents ?? null;
  const pct = seatsLicensed ? Math.min(100, Math.round((row.usage.students / seatsLicensed) * 100)) : 0;
  const suspended = row.tenantStatus === "suspended";

  const copyId = () => { navigator.clipboard?.writeText(row.tenantId).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); };

  const toggleSuspend = async () => {
    setBusy(suspended ? "reactivate" : "suspend");
    try {
      await api.patch(`/super-admin/tenants/${row.tenantId}`, { status: suspended ? "active" : "suspended" });
      onChanged();
    } finally { setBusy(null); }
  };

  return (
    <div className="card rounded-[14px] p-6">
      <div className="flex items-start justify-between">
        <StatusBadge status={status} />
        <button onClick={onClose} className="rounded-lg p-1 text-[var(--muted)] hover:bg-white/[0.05] xl:hidden"><X className="h-4 w-4" /></button>
      </div>
      <button onClick={copyId} className="mt-3 flex items-center gap-2 text-left transition hover:opacity-80">
        <span className="truncate font-mono text-xs text-[var(--muted)]">{row.tenantId}</span>
        {copied ? <Check className="h-3 w-3 shrink-0 text-emerald-400" /> : <Copy className="h-3 w-3 shrink-0 text-[var(--muted)]" />}
      </button>

      <div className="my-4 border-t border-[var(--border)]" />

      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold" style={{ background: `${LIME}22`, color: LIME }}>{row.tenantName.slice(0, 2).toUpperCase()}</span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--fg)]">{row.tenantName}</p>
          <p className="truncate text-[11px] text-[var(--muted)]">Institution since {fmtDate(row.tenantCreatedAt)}</p>
        </div>
      </div>

      <div className="my-4 border-t border-[var(--border)]" />

      <div className="space-y-0">
        <InfoRow label="Plan" value={row.planName ?? "No plan assigned"} />
        <InfoRow label="Licensed Seats" value={seatsLicensed !== null ? String(seatsLicensed) : "Unlimited"} />
        <InfoRow label="Used Seats" value={String(row.usage.students)} />
        <InfoRow label="Expiry Date" value={fmtDate(row.licenseExpiresAt)} />
        <InfoRow label="Days Left" value={daysLeft(row.licenseExpiresAt) !== null ? `${daysLeft(row.licenseExpiresAt)} days` : "—"} />
      </div>

      {seatsLicensed !== null && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-[11px] text-[var(--muted)]"><span>Seat usage</span><span className="tabular-nums">{pct}%</span></div>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-[var(--card-2)]">
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct >= 90 ? "#f87171" : "#16A34A" }} />
          </div>
        </div>
      )}

      <div className="my-4 border-t border-[var(--border)]" />

      <div className="space-y-0">
        <InfoRow label="License Key" value={row.redeemedKeyCode ?? "Manually assigned"} mono={!!row.redeemedKeyCode} />
        <InfoRow label="Issued By" value={issuedBy?.actorName ?? "—"} />
        <InfoRow label="Issued At" value={issuedBy ? fmtDate(issuedBy.at) : "—"} />
      </div>

      {isOwner && (
        <div className="mt-5 flex flex-col gap-3">
          <button onClick={onEdit} className="flex w-full items-center justify-center rounded-[10px] border text-sm font-semibold" style={{ height: 44, borderColor: LIME, color: LIME }}>Edit License</button>
          <button onClick={onEdit} className="flex w-full items-center justify-center rounded-[10px] text-sm font-semibold" style={{ height: 44, background: LIME, color: INK }}><RotateCcw className="mr-1.5 h-4 w-4" /> Renew License</button>
          <button onClick={toggleSuspend} disabled={busy !== null} className="flex w-full items-center justify-center rounded-[10px] border border-rose-500/50 text-sm font-semibold text-rose-400 disabled:opacity-50" style={{ height: 44 }}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Ban className="mr-1.5 h-4 w-4" />} {suspended ? "Reactivate School" : "Suspend School"}
          </button>
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3" style={{ height: 36 }}>
      <span className="text-xs text-[var(--muted)]">{label}</span>
      <span className={clsx("truncate text-right text-xs font-semibold text-[var(--fg)]", mono && "font-mono")}>{value}</span>
    </div>
  );
}

// ── Manage license modal — assign a plan directly, redeem a key, or set/renew an expiry date ──
function ManageLicenseModal({ row, plans, onClose, onDone }: { row: LicenseRow; plans: Plan[]; onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<"assign" | "redeem">("assign");
  const [planId, setPlanId] = useState(row.planId ?? "");
  const [expiresAt, setExpiresAt] = useState(row.licenseExpiresAt ? row.licenseExpiresAt.slice(0, 10) : "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const activePlans = plans.filter((p) => !p.archived || p.id === row.planId);

  async function assign() {
    setBusy(true); setErr(null);
    try {
      await api.patch(`/super-admin/tenants/${row.tenantId}/license`, {
        planId: planId || null,
        licenseStatus: planId ? "active" : undefined,
        licenseExpiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      });
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
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Expiry date (optional)</span>
            <input type="date" className="input h-10" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
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
