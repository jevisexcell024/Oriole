import { useEffect, useState } from "react";
import { HeartPulse, Loader2, Database, Mail, Server, Clock, CheckCircle2, Zap, FlaskConical, AlertTriangle, HardDriveDownload } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { useT } from "@/lib/i18n";
import { clsx } from "clsx";

interface Health {
  api: string;
  db: { engine: string; durable: boolean; collections: Record<string, number> };
  mailer: { mode: string; live: boolean; from: string; host: string | null; lastError: string | null };
  backup: { dir: string; lastBackupAt: string | null; lastBackupBytes: number | null; lastBackupError: string | null; retentionCount: number; intervalHours: number };
  env: { nodeEnv: string; apiPort: number; webPort: number };
  uptimeSeconds: number;
  serverTime: string;
}

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
}

function fmtUptime(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${sec}s` : `${sec}s`;
}

export function AdminSystemHealth() {
  const t = useT();
  const [h, setH] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runningBackup, setRunningBackup] = useState(false);
  const load = () => api.get<Health>("/admin/system-health").then(setH).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, []);

  const runBackupNow = async () => {
    setRunningBackup(true);
    try {
      await api.post("/admin/backup/run-now");
      await load();
    } catch (e) { alert((e as Error).message); }
    finally { setRunningBackup(false); }
  };

  return (
    <AdminShell wide>
      <div className="fade-in max-w-4xl">
        <div className="flex items-center gap-2.5">
          <PageHeader title={t("ahlt.title")} subtitle={t("ahlt.subtitle")} />
        </div>

        {error && <p className="mt-6 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</p>}
        {!h && !error && <div className="mt-8 flex items-center gap-2 text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}</div>}

        {h && (
          <>
            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Status icon={Server} label={t("ahlt.api")} ok={h.api === "ok"} detail={`${h.env.nodeEnv} · :${h.env.apiPort}`} />
              <Status icon={Database} label={t("ahlt.database")} ok={h.db.durable} detail={h.db.engine} />
              <Status icon={h.mailer.live ? Zap : FlaskConical} label={t("ahlt.mailer")} ok={!h.mailer.lastError} detail={h.mailer.lastError ? t("ahlt.deliveryError") : h.mailer.live ? t("ahlt.liveHost", { host: h.mailer.host ?? "" }) : t("ahlt.mockMode")} warn={!h.mailer.live && !h.mailer.lastError} />
              <Status icon={HardDriveDownload} label={t("ahlt.backup")} ok={!h.backup.lastBackupError && !!h.backup.lastBackupAt} warn={!h.backup.lastBackupError && !h.backup.lastBackupAt}
                detail={h.backup.lastBackupError ? t("ahlt.backupError") : h.backup.lastBackupAt ? t("ahlt.backupOk", { when: new Date(h.backup.lastBackupAt).toLocaleString() }) : t("ahlt.backupNone")} />
            </div>

            <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1.4fr_1fr]">
              <div className="card p-5">
                <h2 className="flex items-center gap-2 text-sm font-semibold"><Database className="h-4 w-4 text-brand-400" /> {t("ahlt.storedRecords")}</h2>
                <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                  {Object.entries(h.db.collections).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between border-b border-[var(--border)] pb-1.5">
                      <span className="text-[var(--muted)] capitalize">{k.replace(/([A-Z])/g, " $1")}</span>
                      <span className="font-semibold tabular-nums">{v}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card p-5">
                <h2 className="flex items-center gap-2 text-sm font-semibold"><Clock className="h-4 w-4 text-brand-400" /> {t("ahlt.runtime")}</h2>
                <div className="mt-3 space-y-2 text-sm">
                  <Row label={t("ahlt.uptime")} value={fmtUptime(h.uptimeSeconds)} />
                  <Row label={t("ahlt.environment")} value={h.env.nodeEnv} />
                  <Row label={t("ahlt.ports")} value={`${h.env.webPort} / ${h.env.apiPort}`} />
                  <Row label={t("ahlt.mailFrom")} value={h.mailer.from} />
                  {h.mailer.lastError && <Row label={t("ahlt.mailerError")} value={h.mailer.lastError} />}
                </div>
                {(() => {
                  const allOk = h.api === "ok" && h.db.durable && !h.mailer.lastError;
                  return (
                    <div className={clsx("mt-3 flex items-center gap-1.5 text-xs", allOk ? "text-emerald-400" : "text-amber-500")}>
                      {allOk ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                      {allOk ? t("dash.allOperational") : t("ahlt.needAttention")}
                    </div>
                  );
                })()}
              </div>
            </div>

            <div className="mt-5 card p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold"><HardDriveDownload className="h-4 w-4 text-brand-400" /> {t("ahlt.backup")}</h2>
                <button onClick={runBackupNow} disabled={runningBackup} className="btn btn-outline h-8 text-xs disabled:opacity-50">
                  {runningBackup ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <HardDriveDownload className="h-3.5 w-3.5" />}
                  {runningBackup ? t("ahlt.backupRunning") : t("ahlt.runBackupNow")}
                </button>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <Row label={t("ahlt.lastBackup")} value={h.backup.lastBackupAt ? new Date(h.backup.lastBackupAt).toLocaleString() : t("ahlt.backupNone")} />
                <Row label={t("ahlt.backupSize")} value={h.backup.lastBackupBytes != null ? fmtBytes(h.backup.lastBackupBytes) : "—"} />
                <Row label={t("ahlt.backupFrequency")} value={t("ahlt.backupSchedule", { hours: String(h.backup.intervalHours), count: String(h.backup.retentionCount) })} />
                <Row label={t("ahlt.backupDir")} value={h.backup.dir} />
              </div>
              {h.backup.lastBackupError && (
                <p className="mt-3 text-xs text-rose-400">{t("ahlt.backupError")}: {h.backup.lastBackupError}</p>
              )}
            </div>
          </>
        )}
      </div>
    </AdminShell>
  );
}

function Status({ icon: Icon, label, ok, detail, warn }: { icon: typeof Server; label: string; ok: boolean; detail: string; warn?: boolean }) {
  return (
    <div className="card flex items-center gap-3 p-4">
      <div className={clsx("flex h-10 w-10 items-center justify-center rounded-xl", warn ? "bg-amber-500/20 text-amber-400" : ok ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400")}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold">{label}</p>
        <p className="truncate text-xs text-[var(--muted)]">{detail}</p>
      </div>
      <span className={clsx("ml-auto h-2.5 w-2.5 shrink-0 rounded-full", warn ? "bg-amber-500" : ok ? "bg-emerald-500" : "bg-rose-500")} />
    </div>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] pb-2 last:border-0 last:pb-0">
      <span className="shrink-0 text-[var(--muted)]">{label}</span>
      <span className="truncate text-right font-medium">{value}</span>
    </div>
  );
}
