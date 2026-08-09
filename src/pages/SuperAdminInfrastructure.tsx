import { useEffect, useState } from "react";
import { Database, HardDrive, Mail, ListChecks, Loader2, CheckCircle2, XCircle, Clock, Layers } from "lucide-react";
import { SuperAdminShell } from "@/components/SuperAdminShell";
import { PageHeader } from "@/components/PageHeader";
import { ErrorBanner, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { clsx } from "clsx";

interface JobStatus { lastAt: string | null; lastError: string | null; lastDurationMs: number | null; }
interface InfraData {
  database: { tables: { name: string; rows: number }[]; totalRows: number };
  storage: { bytes: number; resourceCount: number };
  email: { total: number; sent: number; failed: number; logged: number; provider: string | null; recentFailures: { to: string; subject: string; error: string | null; sentAt: string; provider: string | null }[] };
  queues: { jobs: Record<string, JobStatus> };
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
}
function ago(iso: string | null): string {
  if (!iso) return "Never run yet";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  const m = s / 60; if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60; if (h < 24) return `${Math.floor(h)}h ago`;
  const d = h / 24; return `${Math.floor(d)}d ago`;
}

function SectionCard({ icon: Icon, title, subtitle, children }: { icon: typeof Database; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#c6ff34]/10 text-[#c6ff34]"><Icon className="h-4.5 w-4.5" /></span>
        <div>
          <p className="text-sm font-bold">{title}</p>
          <p className="text-xs text-[var(--muted)]">{subtitle}</p>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

export function SuperAdminInfrastructure() {
  const [data, setData] = useState<InfraData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.get<InfraData>("/super-admin/infrastructure").then(setData).catch((e) => setError(e.message)); }, []);

  return (
    <SuperAdminShell>
      <div className="fade-in max-w-5xl">
        <PageHeader eyebrow="Platform" title="Infrastructure" subtitle="Real internals — table sizes, resource storage, email delivery, and scheduled background jobs. No cache layer exists in this app, so there's no Cache section to fake." />

        {error && <ErrorBanner className="mt-4">{error}</ErrorBanner>}

        {!data && !error && (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-56 rounded-2xl" />)}
          </div>
        )}

        {data && (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Database */}
            <SectionCard icon={Database} title="Database" subtitle={`${data.database.totalRows.toLocaleString()} rows across ${data.database.tables.length} tables`}>
              <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
                {data.database.tables.slice(0, 12).map((t) => (
                  <div key={t.name} className="flex items-center justify-between text-xs">
                    <span className="truncate text-[var(--muted)]">{t.name}</span>
                    <span className="ml-2 shrink-0 font-semibold tabular-nums">{t.rows.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </SectionCard>

            {/* Storage */}
            <SectionCard icon={HardDrive} title="Storage" subtitle="Library resource files only">
              <p className="text-2xl font-bold tabular-nums">{fmtBytes(data.storage.bytes)}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">{data.storage.resourceCount.toLocaleString()} resource file{data.storage.resourceCount === 1 ? "" : "s"} across every school</p>
              <p className="mt-3 text-[11px] text-[var(--muted)]">Webcam frames, ID photos, and room scans aren't sized in the schema, so they're not counted here.</p>
            </SectionCard>

            {/* Email Services */}
            <SectionCard icon={Mail} title="Email Services" subtitle={`Last ${data.email.total} sends · provider: ${data.email.provider ?? "—"}`}>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-[var(--card-2)] p-2">
                  <p className="text-lg font-bold tabular-nums text-emerald-400">{data.email.sent}</p>
                  <p className="text-[10px] text-[var(--muted)]">Sent</p>
                </div>
                <div className="rounded-lg bg-[var(--card-2)] p-2">
                  <p className="text-lg font-bold tabular-nums text-rose-400">{data.email.failed}</p>
                  <p className="text-[10px] text-[var(--muted)]">Failed</p>
                </div>
                <div className="rounded-lg bg-[var(--card-2)] p-2">
                  <p className="text-lg font-bold tabular-nums text-[var(--muted)]">{data.email.logged}</p>
                  <p className="text-[10px] text-[var(--muted)]">Logged only</p>
                </div>
              </div>
              {data.email.recentFailures.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Recent failures</p>
                  {data.email.recentFailures.slice(0, 4).map((f, i) => (
                    <div key={i} className="rounded-lg bg-[var(--card-2)] px-2.5 py-1.5 text-xs">
                      <p className="truncate font-medium">{f.to} · {f.subject}</p>
                      <p className="truncate text-[var(--muted)]">{f.error}</p>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>

            {/* Queues / scheduled jobs */}
            <SectionCard icon={ListChecks} title="Queues" subtitle="No message queue exists — the closest real equivalent is this app's scheduled background jobs">
              <div className="space-y-2">
                {Object.entries(data.queues.jobs).length === 0 ? (
                  <p className="text-xs text-[var(--muted)]">No jobs have run yet this process.</p>
                ) : Object.entries(data.queues.jobs).map(([name, job]) => (
                  <div key={name} className="flex items-center justify-between gap-2 rounded-lg bg-[var(--card-2)] px-2.5 py-2 text-xs">
                    <div className="flex min-w-0 items-center gap-2">
                      {job.lastError ? <XCircle className="h-3.5 w-3.5 shrink-0 text-rose-400" /> : <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />}
                      <span className="truncate font-medium">{name}</span>
                    </div>
                    <span className={clsx("shrink-0 flex items-center gap-1", job.lastError ? "text-rose-400" : "text-[var(--muted)]")}>
                      <Clock className="h-3 w-3" /> {ago(job.lastAt)}
                    </span>
                  </div>
                ))}
              </div>
            </SectionCard>

            {/* Cache — honest "not applicable" instead of a fabricated hit rate */}
            <div className="card p-5 sm:col-span-2">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/5 text-[var(--muted)]"><Layers className="h-4.5 w-4.5" /></span>
                <div>
                  <p className="text-sm font-bold">Cache</p>
                  <p className="text-xs text-[var(--muted)]">No cache layer (Redis, memcached, or otherwise) exists anywhere in this application — every request reads straight from the database, so there's no hit rate to show.</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </SuperAdminShell>
  );
}
