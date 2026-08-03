import { useEffect, useState } from "react";
import { Loader2, AlertTriangle, Check, Plus, Ban, CalendarClock, History, Power, Clock3 } from "lucide-react";
import { SuperAdminShell } from "@/components/SuperAdminShell";
import { PageHeader } from "@/components/PageHeader";
import { ErrorBanner, Modal } from "@/components/ui";
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

function statusBadge(status: MaintenanceWindow["status"]) {
  const map = {
    scheduled: "bg-cyan-500/15 text-cyan-400", active: "bg-rose-500/15 text-rose-400",
    completed: "bg-white/10 text-[var(--muted)]", cancelled: "bg-white/10 text-[var(--muted)]",
  } as const;
  return map[status];
}

function StatTile({ icon: Icon, label, value }: { icon: typeof Power; label: string; value: string }) {
  return (
    <div className="card flex items-center gap-3 p-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#c6ff34]/10 text-[#c6ff34]"><Icon className="h-5 w-5" /></div>
      <div className="min-w-0">
        <p className="truncate text-xl font-bold tabular-nums">{value}</p>
        <p className="text-xs text-[var(--muted)]">{label}</p>
      </div>
    </div>
  );
}

type HistoryFilter = "all" | "toggles" | "windows";
type WindowsFilter = "upcoming" | "past";

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
  const [windowsFilter, setWindowsFilter] = useState<WindowsFilter>("upcoming");
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");

  const load = () => api.get<MaintenanceState>("/super-admin/maintenance").then((d) => { setData(d); setMessage(d.message); }).catch((e) => setError(e.message));
  const loadWindows = () => api.get<{ windows: MaintenanceWindow[] }>("/super-admin/maintenance/windows").then((d) => setWindows(d.windows)).catch(() => {});
  const loadHistory = () => api.get<{ logs: AuditEntry[] }>("/super-admin/audit-logs").then((d) => setHistory(d.logs.filter((l) => MAINTENANCE_ACTIONS.has(l.action)).slice(0, 50))).catch(() => {});
  useEffect(() => { load(); loadWindows(); loadHistory(); }, []);

  const upcomingWindows = (windows ?? []).filter((w) => w.status === "scheduled" || w.status === "active");
  const pastWindows = (windows ?? []).filter((w) => w.status === "completed" || w.status === "cancelled");
  const visibleWindows = windowsFilter === "upcoming" ? upcomingWindows : pastWindows;
  const toggleCount = (history ?? []).filter((h) => TOGGLE_ACTIONS.has(h.action)).length;
  const visibleHistory = (history ?? []).filter((h) => {
    if (historyFilter === "toggles") return h.action === "superadmin.maintenance.enabled" || h.action === "superadmin.maintenance.disabled";
    if (historyFilter === "windows") return h.action.startsWith("superadmin.maintenance.window_");
    return true;
  });

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

  return (
    <SuperAdminShell>
      <div className="fade-in max-w-4xl">
        <PageHeader eyebrow={t("sad.dashEyebrow")} title={t("sad.maintTitle")} subtitle={t("sad.maintSubtitle")} />

        {data && (
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile icon={Power} label="Status" value={data.enabled ? "Offline" : "Online"} />
            <StatTile icon={CalendarClock} label="Upcoming windows" value={String(upcomingWindows.length)} />
            <StatTile icon={History} label="Recent toggles" value={String(toggleCount)} />
            <StatTile icon={Clock3} label="Last change" value={data.updatedAt ? new Date(data.updatedAt).toLocaleDateString() : "—"} />
          </div>
        )}

        <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t("sad.maintWarn")}</span>
        </div>

        {error && <ErrorBanner className="mt-4">{error}</ErrorBanner>}
        {!data && !error && <div className="mt-8 flex items-center gap-2 text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}</div>}

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

        <div className="mt-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-[var(--muted)]" />
            <p className="text-sm font-semibold">Scheduled windows</p>
          </div>
          <button onClick={() => setScheduling(true)} className="btn btn-primary"><Plus className="h-4 w-4" /> Schedule a window</button>
        </div>
        <p className="mt-0.5 text-xs text-[var(--muted)]">Turns Maintenance Mode on/off automatically at the times below — no need to be there when it starts or ends.</p>

        <div className="mt-3 flex gap-1 border-b border-[var(--border)]">
          {([["upcoming", `Upcoming (${upcomingWindows.length})`], ["past", `Past (${pastWindows.length})`]] as [WindowsFilter, string][]).map(([f, label]) => (
            <button
              key={f}
              onClick={() => setWindowsFilter(f)}
              className={clsx(
                "border-b-2 px-3 py-2 text-sm font-medium",
                windowsFilter === f ? "border-[#c6ff34] text-[var(--fg)]" : "border-transparent text-[var(--muted)] hover:text-[var(--fg)]",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="card mt-3 overflow-hidden">
          {!windows ? (
            <div className="p-5 text-sm text-[var(--muted)]">{t("common.loading")}</div>
          ) : visibleWindows.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-[var(--muted)]">{windowsFilter === "upcoming" ? "Nothing scheduled." : "No past windows."}</p>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {visibleWindows.map((w) => (
                <div key={w.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={clsx("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", statusBadge(w.status))}>{w.status}</span>
                      <span className="text-sm font-medium">{new Date(w.startAt).toLocaleString()} → {new Date(w.endAt).toLocaleString()}</span>
                    </div>
                    {w.message && <p className="mt-0.5 truncate text-xs text-[var(--muted)]">{w.message}</p>}
                  </div>
                  {windowsFilter === "upcoming" && (
                    <button
                      onClick={() => cancelWindow(w.id)}
                      disabled={cancellingId === w.id}
                      title="Cancel"
                      className="shrink-0 rounded-lg p-1.5 text-rose-400 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      {cancellingId === w.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center gap-2">
          <History className="h-4 w-4 text-[var(--muted)]" />
          <p className="text-sm font-semibold">History</p>
        </div>
        <p className="mt-0.5 text-xs text-[var(--muted)]">Every time Maintenance Mode was toggled or a window fired, from the platform audit trail.</p>

        <div className="mt-3 flex gap-1 border-b border-[var(--border)]">
          {([["all", "All"], ["toggles", "Manual toggles"], ["windows", "Scheduled windows"]] as [HistoryFilter, string][]).map(([f, label]) => (
            <button
              key={f}
              onClick={() => setHistoryFilter(f)}
              className={clsx(
                "border-b-2 px-3 py-2 text-sm font-medium",
                historyFilter === f ? "border-[#c6ff34] text-[var(--fg)]" : "border-transparent text-[var(--muted)] hover:text-[var(--fg)]",
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
