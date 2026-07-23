import { useEffect, useState } from "react";
import { Cpu, MemoryStick, Server, Clock, Loader2 } from "lucide-react";
import { SuperAdminShell } from "@/components/SuperAdminShell";
import { PageHeader } from "@/components/PageHeader";
import { ErrorBanner } from "@/components/ui";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";

interface SystemInfo {
  node: string;
  pid: number;
  platform: string;
  release: string;
  arch: string;
  cpuCount: number;
  totalMemBytes: number;
  freeMemBytes: number;
  processMemory: { rss: number; heapUsed: number; heapTotal: number };
  uptimeSeconds: number;
  loadAvg: number[];
}

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
}

function fmtUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--border)] py-2 text-sm last:border-0">
      <span className="text-[var(--muted)]">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

export function SuperAdminSystemInfo() {
  const t = useT();
  const [data, setData] = useState<SystemInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.get<SystemInfo>("/super-admin/system-info").then(setData).catch((e) => setError(e.message)); }, []);

  return (
    <SuperAdminShell>
      <div className="fade-in max-w-3xl">
        <PageHeader eyebrow={t("sad.dashEyebrow")} title={t("sad.sysInfoTitle")} subtitle={t("sad.sysInfoSubtitle")} />

        {error && <ErrorBanner className="mt-6">{error}</ErrorBanner>}
        {!data && !error && <div className="mt-8 flex items-center gap-2 text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}</div>}

        {data && (
          <>
            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="card p-4">
                <div className="flex items-center gap-2 text-[var(--muted)]"><Server className="h-4 w-4" /><span className="text-[11px] font-semibold uppercase tracking-wider">{t("sad.sysNode")}</span></div>
                <p className="mt-2 text-lg font-bold">{data.node}</p>
              </div>
              <div className="card p-4">
                <div className="flex items-center gap-2 text-[var(--muted)]"><Cpu className="h-4 w-4" /><span className="text-[11px] font-semibold uppercase tracking-wider">{t("sad.sysCpus")}</span></div>
                <p className="mt-2 text-lg font-bold tabular-nums">{data.cpuCount}</p>
              </div>
              <div className="card p-4">
                <div className="flex items-center gap-2 text-[var(--muted)]"><Clock className="h-4 w-4" /><span className="text-[11px] font-semibold uppercase tracking-wider">{t("sad.sysUptime")}</span></div>
                <p className="mt-2 text-lg font-bold tabular-nums">{fmtUptime(data.uptimeSeconds)}</p>
              </div>
            </div>

            <div className="card mt-4 p-4">
              <div className="flex items-center gap-2 text-[var(--muted)]"><Server className="h-4 w-4" /><span className="text-[11px] font-semibold uppercase tracking-wider">{t("sad.sysPlatform")}</span></div>
              <div className="mt-2">
                <Row label={t("sad.sysOs")} value={`${data.platform} (${data.arch})`} />
                <Row label={t("sad.sysRelease")} value={data.release} />
                <Row label={t("sad.sysPid")} value={String(data.pid)} />
                <Row label={t("sad.sysLoadAvg")} value={data.loadAvg.map((n) => n.toFixed(2)).join(" · ")} />
              </div>
            </div>

            <div className="card mt-4 p-4">
              <div className="flex items-center gap-2 text-[var(--muted)]"><MemoryStick className="h-4 w-4" /><span className="text-[11px] font-semibold uppercase tracking-wider">{t("sad.sysMemory")}</span></div>
              <div className="mt-2">
                <Row label={t("sad.sysMemSystem")} value={`${fmtBytes(data.totalMemBytes - data.freeMemBytes)} / ${fmtBytes(data.totalMemBytes)}`} />
                <Row label={t("sad.sysMemProcessRss")} value={fmtBytes(data.processMemory.rss)} />
                <Row label={t("sad.sysMemHeap")} value={`${fmtBytes(data.processMemory.heapUsed)} / ${fmtBytes(data.processMemory.heapTotal)}`} />
              </div>
            </div>
          </>
        )}
      </div>
    </SuperAdminShell>
  );
}
