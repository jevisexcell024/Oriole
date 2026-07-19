import { useEffect, useState } from "react";
import { Activity, CheckCircle2, AlertTriangle, XCircle, Loader2 } from "lucide-react";
import { ErrorBanner } from "@/components/ui";
import { clsx } from "clsx";

type StatusValue = "operational" | "degraded" | "down";

interface Summary {
  overallStatus: StatusValue; uptimePct30d: number; activeIncidents: number;
  subsystems: { subsystem: string; status: StatusValue; uptimePct30d: number }[];
  lastUpdated: string | null;
}
interface PublicIncident {
  id: string; title: string; subsystem: string; severity: "minor" | "major" | "critical";
  status: "investigating" | "identified" | "monitoring" | "resolved"; openedAt: string; resolvedAt: string | null;
  timeline: { type: string; at: string }[];
}
interface UptimeBar { period: string; uptimePct: number; }

const STATUS_META: Record<StatusValue, { label: string; icon: typeof CheckCircle2; tone: string }> = {
  operational: { label: "All Systems Operational", icon: CheckCircle2, tone: "text-emerald-400" },
  degraded: { label: "Degraded Performance", icon: AlertTriangle, tone: "text-amber-400" },
  down: { label: "Service Disruption", icon: XCircle, tone: "text-rose-400" },
};

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error("Request failed");
  return res.json() as Promise<T>;
}

export function StatusPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [incidents, setIncidents] = useState<PublicIncident[] | null>(null);
  const [bars, setBars] = useState<UptimeBar[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () => Promise.all([
      getJson<Summary>("/status/summary").then(setSummary),
      getJson<{ incidents: PublicIncident[] }>("/status/incidents").then((r) => setIncidents(r.incidents)),
      getJson<{ bars: UptimeBar[] }>("/status/uptime?range=90d").then((r) => setBars(r.bars)),
    ]).catch(() => setError("Couldn't load status right now — please try again shortly."));
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);

  const meta = summary ? STATUS_META[summary.overallStatus] : null;
  const Icon = meta?.icon ?? Activity;

  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--border)] bg-[var(--card)]">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-2.5 px-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white"><Activity className="h-5 w-5" /></div>
          <div>
            <p className="text-sm font-bold leading-tight">Oriole</p>
            <p className="text-xs text-[var(--muted)]">System Status</p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-5 py-12 fade-in">
        {error && <ErrorBanner>{error}</ErrorBanner>}
        {!summary && !error && <div className="flex items-center justify-center gap-2 py-16 text-[var(--muted)]"><Loader2 className="h-5 w-5 animate-spin" /> Loading…</div>}

        {summary && meta && (
          <>
            <div className="card flex items-center gap-3 p-5">
              <Icon className={clsx("h-8 w-8 shrink-0", meta.tone)} />
              <div>
                <h1 className={clsx("text-xl font-bold", meta.tone)}>{meta.label}</h1>
                <p className="text-sm text-[var(--muted)]">
                  {summary.uptimePct30d}% uptime (30 days) · {summary.activeIncidents} active incident{summary.activeIncidents === 1 ? "" : "s"}
                </p>
              </div>
            </div>

            <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Service Status</h2>
            <div className="mt-3 space-y-2">
              {summary.subsystems.map((s) => (
                <div key={s.subsystem} className="card flex items-center justify-between p-4">
                  <span className="text-sm font-medium">{s.subsystem}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--muted)]">{s.uptimePct30d}%</span>
                    <span className={clsx("h-2.5 w-2.5 rounded-full", s.status === "operational" ? "bg-emerald-500" : s.status === "degraded" ? "bg-amber-500" : "bg-rose-500")} />
                  </div>
                </div>
              ))}
            </div>

            <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Uptime — Last 90 Days</h2>
            <div className="card mt-3 p-5">
              <div className="flex h-12 items-end gap-[2px]">
                {bars.length === 0 && <p className="text-xs text-[var(--muted)]">No history yet.</p>}
                {bars.map((b) => {
                  const color = b.uptimePct >= 99.5 ? "bg-emerald-500" : b.uptimePct >= 95 ? "bg-amber-500" : b.uptimePct >= 80 ? "bg-orange-500" : "bg-rose-500";
                  return <div key={b.period} title={`${b.period}: ${b.uptimePct}%`} className={clsx("flex-1 rounded-sm", color)} style={{ height: `${Math.max(6, (b.uptimePct / 100) * 44)}px` }} />;
                })}
              </div>
            </div>

            <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Incident History</h2>
            <div className="mt-3 space-y-3">
              {incidents && incidents.length === 0 && <p className="text-sm text-[var(--muted)]">No incidents reported.</p>}
              {incidents?.map((i) => (
                <div key={i.id} className="card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{i.title}</span>
                    <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize",
                      i.status === "resolved" ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400")}>
                      {i.status === "resolved" ? "Resolved" : "Ongoing"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {i.subsystem} · opened {new Date(i.openedAt).toLocaleString()}
                    {i.resolvedAt ? ` · resolved ${new Date(i.resolvedAt).toLocaleString()}` : ""}
                  </p>
                </div>
              ))}
            </div>

            {summary.lastUpdated && <p className="mt-8 text-center text-xs text-[var(--muted)]">Last updated {new Date(summary.lastUpdated).toLocaleTimeString()}</p>}
          </>
        )}
      </div>
    </div>
  );
}
