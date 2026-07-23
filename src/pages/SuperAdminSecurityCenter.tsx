import { useEffect, useMemo, useState } from "react";
import { ScrollText, Loader2, ShieldCheck, ShieldAlert, Gauge } from "lucide-react";
import { SuperAdminShell } from "@/components/SuperAdminShell";
import { ErrorBanner } from "@/components/ui";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column, type TableFilter } from "@/components/DataTable";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { clsx } from "clsx";

interface Log { id: string; at: string; actorId: string; actorName: string; action: string; target: string; }
interface RateLimit { windowMinutes: number; max: number; }
interface SecurityData {
  logs: Log[];
  integrity: { ok: boolean; brokenAt: string | null; entries: number };
  rateLimits: { tenantAuth: RateLimit; superAdminAuth: RateLimit; api: RateLimit };
}

const fmt = (s: string) => new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

const ACTION_TONE: Record<string, string> = {
  login: "bg-emerald-500/20 text-emerald-400",
  login_failed: "bg-rose-500/20 text-rose-400",
  logout: "bg-[var(--card-2)] text-[var(--muted)]",
  first_password_set: "bg-blue-500/20 text-blue-400",
};
const verbOf = (action: string) => action.split(".")[1] ?? action;
const tone = (action: string) => ACTION_TONE[verbOf(action)] ?? "bg-[var(--card-2)] text-[var(--muted)]";

function RateLimitCard({ icon: Icon, label, rl }: { icon: typeof Gauge; label: string; rl: RateLimit }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-[var(--muted)]"><Icon className="h-4 w-4" /><span className="text-[11px] font-semibold uppercase tracking-wider">{label}</span></div>
      <p className="mt-2 text-lg font-bold tabular-nums">{rl.max}<span className="ml-1 text-xs font-medium text-[var(--muted)]">/ {rl.windowMinutes}m</span></p>
    </div>
  );
}

export function SuperAdminSecurityCenter() {
  const t = useT();
  const [data, setData] = useState<SecurityData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.get<SecurityData>("/super-admin/audit-logs").then(setData).catch((e) => setError(e.message)); }, []);

  const columns: Column<Log>[] = [
    { key: "when", header: t("alog.colWhen"), sortValue: (l) => l.at, csv: (l) => new Date(l.at).toISOString(), td: "text-xs text-[var(--muted)] whitespace-nowrap", render: (l) => fmt(l.at) },
    { key: "actor", header: t("alog.colActor"), sortValue: (l) => l.actorName, csv: (l) => l.actorName, td: "font-medium", render: (l) => l.actorName },
    { key: "action", header: t("alog.colAction"), sortValue: (l) => l.action, csv: (l) => l.action, render: (l) => <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-semibold", tone(l.action))}>{l.action}</span> },
    { key: "detail", header: t("alog.colDetail"), csv: (l) => l.target, td: "text-[var(--muted)]", render: (l) => l.target },
  ];

  const filters: TableFilter<Log>[] = useMemo(() => {
    const verbs = [...new Set((data?.logs ?? []).map((l) => verbOf(l.action)))].sort();
    return [{ id: "action", label: t("alog.allAreas"), options: verbs.map((v) => ({ value: v, label: v })), match: (l, v) => verbOf(l.action) === v }];
  }, [data, t]);

  return (
    <SuperAdminShell>
      <div className="fade-in">
        <PageHeader eyebrow={t("sad.dashEyebrow")} title={t("sad.securityTitle")} subtitle={t("sad.securitySubtitle")} />

        {error && <ErrorBanner className="mt-6">{error}</ErrorBanner>}
        {!data && !error && <div className="mt-8 flex items-center gap-2 text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}</div>}

        {data && (
          <>
            <div className={clsx(
              "mt-6 flex items-center gap-2.5 rounded-xl border px-4 py-3 text-sm font-medium",
              data.integrity.ok ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400" : "border-rose-500/25 bg-rose-500/10 text-rose-400",
            )}>
              {data.integrity.ok ? <ShieldCheck className="h-4 w-4 shrink-0" /> : <ShieldAlert className="h-4 w-4 shrink-0" />}
              {data.integrity.ok
                ? t("sad.chainOk", { n: data.integrity.entries })
                : t("sad.chainBroken", { id: data.integrity.brokenAt ?? "?" })}
            </div>

            <p className="mb-3 mt-6 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">{t("sad.rateLimits")}</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <RateLimitCard icon={Gauge} label={t("sad.rlSuperAdminAuth")} rl={data.rateLimits.superAdminAuth} />
              <RateLimitCard icon={Gauge} label={t("sad.rlTenantAuth")} rl={data.rateLimits.tenantAuth} />
              <RateLimitCard icon={Gauge} label={t("sad.rlApi")} rl={data.rateLimits.api} />
            </div>

            <p className="mb-3 mt-6 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">{t("sad.auditTrail")}</p>
            <DataTable
              rows={data.logs}
              columns={columns}
              getId={(l) => l.id}
              searchText={(l) => `${l.actorName} ${l.action} ${l.target}`}
              searchPlaceholder={t("alog.searchPlaceholder")}
              filters={filters}
              initialSort={{ key: "when", dir: "desc" }}
              pageSize={15}
              exportName="orcalis-superadmin-audit-logs"
              empty={<div className="flex flex-col items-center gap-2 text-sm text-[var(--muted)]"><ScrollText className="h-8 w-8" /> {t("alog.none")}</div>}
            />
          </>
        )}
      </div>
    </SuperAdminShell>
  );
}
