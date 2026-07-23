import { useEffect, useState } from "react";
import { Server, Database, KeyRound, Lock, ShieldAlert, Mail, MessageSquare, HardDriveDownload, Loader2 } from "lucide-react";
import { SuperAdminShell } from "@/components/SuperAdminShell";
import { PageHeader } from "@/components/PageHeader";
import { ErrorBanner } from "@/components/ui";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { clsx } from "clsx";

interface PlatformSettings {
  environment: string;
  appUrl: string;
  database: { backend: string; managed: boolean };
  security: { jwtIsDefault: boolean; superAdminJwtIsDefault: boolean; encryptionKeyConfigured: boolean };
  retention: { proctorRetentionDays: number };
  mailer: { mode: string; live: boolean; from: string; host: string | null; lastError: string | null };
  sms: { mode: string; channel: string; live: boolean; from: string; lastError: string | null };
  backup: { dir: string; lastBackupAt: string | null; lastBackupBytes: number | null; lastBackupError: string | null; retentionCount: number; intervalHours: number };
}

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
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
    <div className="flex items-center justify-between border-b border-[var(--border)] py-2 text-sm last:border-0">
      <span className="text-[var(--muted)]">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

export function SuperAdminPlatformSettings() {
  const t = useT();
  const [data, setData] = useState<PlatformSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.get<PlatformSettings>("/super-admin/platform-settings").then(setData).catch((e) => setError(e.message)); }, []);

  return (
    <SuperAdminShell>
      <div className="fade-in max-w-4xl">
        <PageHeader eyebrow={t("sad.dashEyebrow")} title={t("sad.settingsTitle")} subtitle={t("sad.settingsSubtitle")} />

        {error && <ErrorBanner className="mt-6">{error}</ErrorBanner>}
        {!data && !error && <div className="mt-8 flex items-center gap-2 text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}</div>}

        {data && (
          <>
            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Status icon={Server} label={t("sad.environment")} ok={data.environment === "production"} warn={data.environment !== "production"} detail={data.environment === "production" ? data.appUrl : t("sad.envDevHint")} />
              <Status icon={Database} label={t("sad.database")} ok detail={data.database.managed ? t("sad.dbManaged") : t("sad.dbEmbedded")} />
            </div>

            <p className="mb-3 mt-6 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">{t("sanav.secSecurity")}</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Status icon={KeyRound} label={t("sad.tenantJwt")} ok={!data.security.jwtIsDefault} warn={data.security.jwtIsDefault} detail={data.security.jwtIsDefault ? t("sad.secretDefault") : t("sad.secretConfigured")} />
              <Status icon={KeyRound} label={t("sad.superAdminJwt")} ok={!data.security.superAdminJwtIsDefault} warn={data.security.superAdminJwtIsDefault} detail={data.security.superAdminJwtIsDefault ? t("sad.secretDefault") : t("sad.secretConfigured")} />
              <Status icon={Lock} label={t("sad.encryptionKey")} ok={data.security.encryptionKeyConfigured} warn={!data.security.encryptionKeyConfigured} detail={data.security.encryptionKeyConfigured ? t("sad.secretConfigured") : t("sad.secretMissing")} />
            </div>

            <p className="mb-3 mt-6 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">{t("sad.dataRetention")}</p>
            <div className="card p-4">
              <Row label={t("sad.proctorRetention")} value={data.retention.proctorRetentionDays > 0 ? t("sad.retentionDays", { n: data.retention.proctorRetentionDays }) : t("sad.retentionUnlimited")} />
            </div>

            <p className="mb-3 mt-6 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">{t("sad.delivery")}</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="card p-4">
                <div className="flex items-center gap-2 text-[var(--muted)]"><Mail className="h-4 w-4" /><span className="text-[11px] font-semibold uppercase tracking-wider">{t("sad.mailer")}</span></div>
                <Row label={t("sad.mode")} value={data.mailer.mode} />
                <Row label={t("sad.from")} value={data.mailer.from} />
                {data.mailer.host && <Row label={t("sad.host")} value={data.mailer.host} />}
                {data.mailer.lastError && <p className="mt-2 flex items-center gap-1.5 text-xs text-rose-400"><ShieldAlert className="h-3.5 w-3.5 shrink-0" /> {data.mailer.lastError}</p>}
              </div>
              <div className="card p-4">
                <div className="flex items-center gap-2 text-[var(--muted)]"><MessageSquare className="h-4 w-4" /><span className="text-[11px] font-semibold uppercase tracking-wider">{t("sad.sms")}</span></div>
                <Row label={t("sad.mode")} value={`${data.sms.mode} · ${data.sms.channel}`} />
                <Row label={t("sad.from")} value={data.sms.from} />
                {data.sms.lastError && <p className="mt-2 flex items-center gap-1.5 text-xs text-rose-400"><ShieldAlert className="h-3.5 w-3.5 shrink-0" /> {data.sms.lastError}</p>}
              </div>
            </div>

            <p className="mb-3 mt-6 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">{t("sad.backups")}</p>
            <div className="card p-4">
              <div className="flex items-center gap-2 text-[var(--muted)]"><HardDriveDownload className="h-4 w-4" /><span className="text-[11px] font-semibold uppercase tracking-wider">{t("sad.backupSchedule")}</span></div>
              <Row label={t("sad.lastBackup")} value={data.backup.lastBackupAt ? new Date(data.backup.lastBackupAt).toLocaleString() : t("sad.never")} />
              {data.backup.lastBackupBytes != null && <Row label={t("sad.size")} value={fmtBytes(data.backup.lastBackupBytes)} />}
              <Row label={t("sad.interval")} value={t("sad.everyHours", { n: data.backup.intervalHours })} />
              <Row label={t("sad.retained")} value={t("sad.backupsKept", { n: data.backup.retentionCount })} />
              {data.backup.lastBackupError && <p className="mt-2 flex items-center gap-1.5 text-xs text-rose-400"><ShieldAlert className="h-3.5 w-3.5 shrink-0" /> {data.backup.lastBackupError}</p>}
            </div>
          </>
        )}
      </div>
    </SuperAdminShell>
  );
}
