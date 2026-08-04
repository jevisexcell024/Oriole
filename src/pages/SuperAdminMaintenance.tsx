import { useEffect, useMemo, useState } from "react";
import {
  Loader2, AlertTriangle, Check, Plus, Ban, CalendarClock, History, Power, Clock3,
  Search, Download, Eye, MoreHorizontal, Sparkles, ListChecks,
} from "lucide-react";
import { SuperAdminShell } from "@/components/SuperAdminShell";
import { PageHeader } from "@/components/PageHeader";
import { ErrorBanner, Modal } from "@/components/ui";
import { MonthCalendar, type CalEvent } from "@/components/MonthCalendar";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { clsx } from "clsx";
import type { MaintenanceWindow } from "@shared/types";

interface MaintenanceState { id: string; enabled: boolean; message: string; updatedAt: string | null; updatedBy: string | null; }
interface AuditEntry { id: string; at: string; actorName: string; action: string; target: string; }

const MAINTENANCE_ACTIONS = new Set([
  "superadmin.maintenance.enabled", "superadmin.maintenance.disabled",
  "superadmin.maintenance.window_scheduled", "superadmin.maintenance.window_activated",
  "superadmin.maintenance.window_completed", "superadmin.maintenance.window_cancelled",
]);
const TOGGLE_ACTIONS = new Set(["superadmin.maintenance.enabled", "superadmin.maintenance.disabled", "superadmin.maintenance.window_activated", "superadmin.maintenance.window_completed"]);

const STATUS_STYLE: Record<MaintenanceWindow["status"], { badge: string; dot: string; label: string }> = {
  scheduled: { badge: "bg-cyan-500/15 text-cyan-400", dot: "#22d3ee", label: "Scheduled" },
  active: { badge: "bg-rose-500/15 text-rose-400", dot: "#fb7185", label: "In Progress" },
  completed: { badge: "bg-emerald-500/15 text-emerald-400", dot: "#34d399", label: "Completed" },
  cancelled: { badge: "bg-white/10 text-[var(--muted)]", dot: "#9FA096", label: "Cancelled" },
};

function StatTile({ icon: Icon, label, value, sub, tone }: { icon: typeof Power; label: string; value: string; sub?: string; tone?: "danger" | "ok" }) {
  return (
    <div className="card flex items-center gap-3 p-4">
      <div className={clsx("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
        tone === "danger" ? "bg-rose-500/15 text-rose-400" : tone === "ok" ? "bg-emerald-500/15 text-emerald-400" : "bg-brand-500/10 text-brand-500")}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-xl font-bold tabular-nums">{value}</p>
        <p className="text-xs text-[var(--muted)]">{label}</p>
        {sub && <p className="text-[10px] text-[var(--muted)]">{sub}</p>}
      </div>
    </div>
  );
}

function fmtDuration(ms: number): string {
  if (ms <= 0) return "0m";
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

type MaintFilter = "all" | MaintenanceWindow["status"];
type HistoryFilter = "all" | "toggles" | "windows";

export function SuperAdminMaintenance() {
  const t = useT();
  const [data, setData] = useState<MaintenanceState | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [windows, setWindows] = useState<MaintenanceWindow[] | null>(null);
  const [history, setHistory] = useState<AuditEntry[] | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<MaintFilter>("all");
  const [search, setSearch] = useState("");
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const [showHistory, setShowHistory] = useState(false);

  const load = () => api.get<MaintenanceState>("/super-admin/maintenance").then((d) => { setData(d); setMessage(d.message); }).catch((e) => setError(e.message));
  const loadWindows = () => api.get<{ windows: MaintenanceWindow[] }>("/super-admin/maintenance/windows").then((d) => setWindows(d.windows)).catch(() => {});
  const loadHistory = () => api.get<{ logs: AuditEntry[] }>("/super-admin/audit-logs").then((d) => setHistory(d.logs.filter((l) => MAINTENANCE_ACTIONS.has(l.action)).slice(0, 100))).catch(() => {});
  useEffect(() => { load(); loadWindows(); loadHistory(); }, []);

  const since30d = Date.now() - 30 * 86_400_000;

  const counts = useMemo(() => {
    const w = windows ?? [];
    return {
      scheduled: w.filter((x) => x.status === "scheduled").length,
      completed30d: w.filter((x) => x.status === "completed" && new Date(x.startAt).getTime() >= since30d).length,
      cancelled30d: w.filter((x) => x.status === "cancelled" && new Date(x.createdAt).getTime() >= since30d).length,
    };
  }, [windows, since30d]);

  // Total downtime (30d) — scheduled-window durations plus manual toggle
  // on/off pairs from the audit trail (distinct action names, so no
  // double-counting with window activation/completion). Anything still
  // ongoing counts up to now.
  const downtime30dMs = useMemo(() => {
    let total = 0;
    const now = Date.now();
    for (const w of windows ?? []) {
      const start = new Date(w.startAt).getTime();
      if (start < since30d) continue;
      if (w.status === "completed") total += new Date(w.endAt).getTime() - start;
      else if (w.status === "active") total += now - start;
    }
    const toggles = (history ?? []).filter((h) => h.action === "superadmin.maintenance.enabled" || h.action === "superadmin.maintenance.disabled").slice().reverse();
    let openAt: number | null = null;
    for (const h of toggles) {
      const at = new Date(h.at).getTime();
      if (h.action === "superadmin.maintenance.enabled") openAt = at;
      else if (h.action === "superadmin.maintenance.disabled" && openAt !== null) {
        if (openAt >= since30d) total += at - openAt;
        openAt = null;
      }
    }
    if (openAt !== null && data?.enabled) total += now - Math.max(openAt, since30d);
    return total;
  }, [windows, history, since30d, data?.enabled]);

  const filtered = useMemo(() => {
    let w = windows ?? [];
    if (filter !== "all") w = w.filter((x) => x.status === filter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      w = w.filter((x) => x.message.toLowerCase().includes(q));
    }
    return [...w].sort((a, b) => b.startAt.localeCompare(a.startAt));
  }, [windows, filter, search]);

  const upcoming = (windows ?? []).filter((w) => w.status === "scheduled").sort((a, b) => a.startAt.localeCompare(b.startAt));
  const toggleCount = (history ?? []).filter((h) => TOGGLE_ACTIONS.has(h.action)).length;
  const visibleHistory = (history ?? []).filter((h) => {
    if (historyFilter === "toggles") return h.action === "superadmin.maintenance.enabled" || h.action === "superadmin.maintenance.disabled";
    if (historyFilter === "windows") return h.action.startsWith("superadmin.maintenance.window_");
    return true;
  });

  const calEvents: CalEvent[] = (windows ?? []).map((w) => ({
    id: w.id, date: new Date(w.startAt), title: STATUS_STYLE[w.status].label, sub: w.message || undefined, color: STATUS_STYLE[w.status].dot,
  }));

  async function setEnabled(enabled: boolean) {
    setError(null); setBusy(true);
    try { const d = await api.patch<MaintenanceState>("/super-admin/maintenance", { enabled, message }); setData(d); loadHistory(); loadWindows(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function cancelWindow(id: string) {
    setError(null); setCancellingId(id);
    try { await api.post(`/super-admin/maintenance/windows/${id}/cancel`, {}); loadWindows(); load(); loadHistory(); }
    catch (e) { setError((e as Error).message); }
    finally { setCancellingId(null); }
  }

  function exportCsv() {
    const rows = [["Status", "Message", "Start", "End", "Duration", "Created By"]];
    for (const w of filtered) {
      rows.push([STATUS_STYLE[w.status].label, w.message, w.startAt, w.endAt, fmtDuration(new Date(w.endAt).getTime() - new Date(w.startAt).getTime()), w.createdBy]);
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "maintenance-windows.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <SuperAdminShell>
      <div className="fade-in max-w-7xl">
        <PageHeader
          eyebrow={t("sad.dashEyebrow")}
          title={t("sad.maintTitle")}
          subtitle="Schedule, manage, and monitor platform maintenance and downtime."
          actions={<button onClick={() => setScheduling(true)} className="btn btn-primary"><Plus className="h-4 w-4" /> Schedule Maintenance</button>}
        />

        {/* Stat tiles */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <StatTile icon={CalendarClock} label="Scheduled" value={String(counts.scheduled)} sub="Upcoming windows" />
          <StatTile icon={AlertTriangle} label="In Progress" value={data?.enabled ? "1" : "0"} sub="Currently active" tone={data?.enabled ? "danger" : undefined} />
          <StatTile icon={Check} label="Completed (30d)" value={String(counts.completed30d)} sub="Successful" tone="ok" />
          <StatTile icon={Ban} label="Cancelled (30d)" value={String(counts.cancelled30d)} sub="Cancelled by admin" />
          <StatTile icon={Clock3} label="Total Downtime (30d)" value={fmtDuration(downtime30dMs)} sub="Windows + manual toggles" />
          <StatTile icon={Power} label="Platform Status" value={data ? (data.enabled ? "Offline" : "Online") : "…"} tone={data?.enabled ? "danger" : "ok"} />
        </div>

        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t("sad.maintWarn")}</span>
        </div>

        {error && <ErrorBanner className="mt-4">{error}</ErrorBanner>}

        {/* Platform status / manual toggle */}
        {data && (
          <div className="card mt-4 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">{t("sad.maintStatus")}</p>
                <p className="text-xs text-[var(--muted)]">
                  {data.enabled
                    ? (data.updatedAt ? t("sad.maintEnabledSince", { when: new Date(data.updatedAt).toLocaleString(), who: data.updatedBy ?? "" }) : t("sad.maintEnabledNow"))
                    : t("sad.maintDisabledDesc")}
                </p>
              </div>
              <span className={clsx("inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
                data.enabled ? "bg-rose-500/15 text-rose-400" : "bg-emerald-500/15 text-emerald-400")}>
                {data.enabled ? t("sad.maintOn") : t("sad.maintOff")}
              </span>
            </div>

            <label className="mt-4 block">
              <span className="mb-1 block text-sm font-medium">{t("sad.maintMessage")}</span>
              <textarea
                className="input min-h-20 py-2"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={500}
                placeholder={t("sad.maintMessagePlaceholder")}
              />
            </label>

            <div className="mt-4 flex justify-end gap-2">
              {data.enabled ? (
                <button onClick={() => setEnabled(false)} disabled={busy} className="btn btn-primary disabled:opacity-50">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {t("sad.maintTurnOff")}
                </button>
              ) : (
                <button onClick={() => setEnabled(true)} disabled={busy} className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-600 disabled:opacity-50">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />} {t("sad.maintTurnOn")}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Main grid: table + sidebar */}
        <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-[1.7fr_1fr]">
          <div className="min-w-0">
            <div className="flex flex-wrap gap-1 border-b border-[var(--border)]">
              {([["all", `All (${(windows ?? []).length})`], ["scheduled", "Scheduled"], ["active", "In Progress"], ["completed", "Completed"], ["cancelled", "Cancelled"]] as [MaintFilter, string][]).map(([f, label]) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={clsx(
                    "border-b-2 px-3 py-2 text-sm font-medium",
                    filter === f ? "border-brand-500 text-[var(--fg)]" : "border-transparent text-[var(--muted)] hover:text-[var(--fg)]",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
                <input className="input h-9 pl-9" placeholder="Search maintenance…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <button onClick={exportCsv} disabled={filtered.length === 0} className="btn btn-outline h-9 disabled:opacity-40"><Download className="h-4 w-4" /> Export</button>
            </div>

            <div className="card mt-3 overflow-hidden">
              {!windows ? (
                <div className="p-5 text-sm text-[var(--muted)]">{t("common.loading")}</div>
              ) : filtered.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-[var(--muted)]">{search ? "No maintenance matches your search." : "Nothing here yet."}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border)] text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                        <th className="px-4 py-2.5">Title & Description</th>
                        <th className="px-4 py-2.5">Status</th>
                        <th className="px-4 py-2.5">Scheduled Time</th>
                        <th className="px-4 py-2.5">Duration</th>
                        <th className="px-4 py-2.5">Affected</th>
                        <th className="px-4 py-2.5 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {filtered.map((w) => (
                        <tr key={w.id} className="align-top">
                          <td className="max-w-xs px-4 py-3">
                            <p className="truncate font-medium">{w.message || "Scheduled maintenance"}</p>
                            <p className="mt-0.5 truncate text-xs text-[var(--muted)]">{w.message ? "No further details." : "No message provided."}</p>
                          </td>
                          <td className="px-4 py-3">
                            <span className={clsx("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", STATUS_STYLE[w.status].badge)}>{STATUS_STYLE[w.status].label}</span>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-[var(--muted)]">{new Date(w.startAt).toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric" })}<br /><span className="text-xs">{new Date(w.startAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span></td>
                          <td className="whitespace-nowrap px-4 py-3 text-[var(--muted)]">{fmtDuration(new Date(w.endAt).getTime() - new Date(w.startAt).getTime())}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-[var(--muted)]">All tenants</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1">
                              <span className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--muted)]" title="Platform-wide — no per-window detail view"><Eye className="h-3.5 w-3.5" /></span>
                              {w.status === "scheduled" ? (
                                <button
                                  onClick={() => cancelWindow(w.id)}
                                  disabled={cancellingId === w.id}
                                  title="Cancel"
                                  className="flex h-7 w-7 items-center justify-center rounded-lg text-rose-400 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-30"
                                >
                                  {cancellingId === w.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
                                </button>
                              ) : (
                                <span className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--muted)] opacity-40"><MoreHorizontal className="h-3.5 w-3.5" /></span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* History */}
            <div className="mt-6 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-[var(--muted)]" />
                <p className="text-sm font-semibold">History</p>
              </div>
              <button onClick={() => setShowHistory((s) => !s)} className="text-xs font-semibold text-brand-400 hover:underline">{showHistory ? "Hide" : `Show (${toggleCount + (history ?? []).filter((h) => h.action.startsWith("superadmin.maintenance.window_")).length})`}</button>
            </div>
            {showHistory && (
              <>
                <div className="mt-2 flex gap-1 border-b border-[var(--border)]">
                  {([["all", "All"], ["toggles", "Manual toggles"], ["windows", "Scheduled windows"]] as [HistoryFilter, string][]).map(([f, label]) => (
                    <button
                      key={f}
                      onClick={() => setHistoryFilter(f)}
                      className={clsx(
                        "border-b-2 px-3 py-2 text-sm font-medium",
                        historyFilter === f ? "border-brand-500 text-[var(--fg)]" : "border-transparent text-[var(--muted)] hover:text-[var(--fg)]",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="card mt-3 overflow-hidden">
                  {!history ? (
                    <div className="p-5 text-sm text-[var(--muted)]">{t("common.loading")}</div>
                  ) : visibleHistory.length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-[var(--muted)]">{historyFilter === "all" ? "No maintenance activity yet." : "Nothing in this filter."}</p>
                  ) : (
                    <div className="divide-y divide-[var(--border)]">
                      {visibleHistory.map((h) => (
                        <div key={h.id} className="px-4 py-2.5 text-sm">
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-medium">{h.target}</span>
                            <span className="shrink-0 text-xs text-[var(--muted)]">{new Date(h.at).toLocaleString()}</span>
                          </div>
                          <p className="mt-0.5 text-xs text-[var(--muted)]">{h.actorName}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            <MonthCalendar events={calEvents} empty="No maintenance scheduled on this day." />

            <div className="card p-4">
              <p className="mb-3 flex items-center gap-2 text-sm font-bold"><Sparkles className="h-4 w-4 text-brand-400" /> Quick Actions</p>
              <div className="space-y-1">
                <button onClick={() => setScheduling(true)} className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-[var(--card-2)]">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-500"><Plus className="h-4 w-4" /></span>
                  <span><span className="block text-sm font-medium">Schedule Maintenance</span><span className="block text-xs text-[var(--muted)]">Plan a new maintenance window</span></span>
                </button>
                <button onClick={() => setShowHistory(true)} className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-[var(--card-2)]">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-500"><History className="h-4 w-4" /></span>
                  <span><span className="block text-sm font-medium">View History</span><span className="block text-xs text-[var(--muted)]">Toggles and completed windows</span></span>
                </button>
                <button onClick={exportCsv} disabled={(windows ?? []).length === 0} className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-[var(--card-2)] disabled:opacity-40">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-500"><ListChecks className="h-4 w-4" /></span>
                  <span><span className="block text-sm font-medium">Export Windows</span><span className="block text-xs text-[var(--muted)]">Download as CSV</span></span>
                </button>
              </div>
            </div>

            <div className="card p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-bold">Upcoming Maintenance</p>
              </div>
              {upcoming.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">Nothing scheduled.</p>
              ) : (
                <div className="space-y-2">
                  {upcoming.slice(0, 3).map((w) => (
                    <div key={w.id} className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-400"><CalendarClock className="h-4 w-4" /></span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{w.message || "Scheduled maintenance"}</p>
                        <p className="text-xs text-[var(--muted)]">{new Date(w.startAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })} · {new Date(w.startAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</p>
                      </div>
                      <span className="shrink-0 text-xs font-semibold text-[var(--muted)]">{fmtDuration(new Date(w.endAt).getTime() - new Date(w.startAt).getTime())}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card p-4">
              <p className="mb-3 text-sm font-bold">Status Guide</p>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(STATUS_STYLE) as MaintenanceWindow["status"][]).map((s) => (
                  <div key={s} className={clsx("rounded-lg px-2.5 py-2", STATUS_STYLE[s].badge)}>
                    <p className="text-xs font-bold">{STATUS_STYLE[s].label}</p>
                    <p className="mt-0.5 text-[10px] opacity-80">
                      {s === "scheduled" && "Window queued, not started"}
                      {s === "active" && "Live — platform is down now"}
                      {s === "completed" && "Ran and ended on time"}
                      {s === "cancelled" && "Cancelled before it started"}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {scheduling && <ScheduleModal onClose={() => setScheduling(false)} onDone={() => { setScheduling(false); loadWindows(); loadHistory(); }} />}
    </SuperAdminShell>
  );
}

function ScheduleModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const valid = startAt.length > 0 && endAt.length > 0 && new Date(endAt).getTime() > new Date(startAt).getTime();

  async function save() {
    if (!valid) return;
    setBusy(true); setErr(null);
    try {
      await api.post("/super-admin/maintenance/windows", { startAt: new Date(startAt).toISOString(), endAt: new Date(endAt).toISOString(), message });
      onDone();
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  return (
    <Modal title="Schedule a maintenance window" onClose={onClose}>
      <div className="mt-4 space-y-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Starts</span>
          <input type="datetime-local" className="input h-10" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Ends</span>
          <input type="datetime-local" className="input h-10" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
          {startAt && endAt && new Date(endAt).getTime() <= new Date(startAt).getTime() && <span className="mt-1 block text-xs text-rose-400">End time must be after the start time.</span>}
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Message shown to users (optional)</span>
          <textarea className="input min-h-20 py-2" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} placeholder="We'll be back shortly for scheduled maintenance." />
        </label>
        {err && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">{err}</p>}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--fg)]">Cancel</button>
        <button onClick={save} disabled={busy || !valid} className="btn btn-primary disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Schedule</button>
      </div>
    </Modal>
  );
}
