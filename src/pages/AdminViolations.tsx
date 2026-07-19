import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, ArrowRight, Radio, ShieldCheck } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { ErrorBanner } from "@/components/ui";
import { PageHeader } from "@/components/PageHeader";
import { api } from "@/lib/api";
import { DataTable, type Column, type TableFilter } from "@/components/DataTable";
import { useT } from "@/lib/i18n";
import { clsx } from "clsx";

interface Event { id: string; type: string; severity: string; message: string; at: string; candidate: string; exam: string; attemptId: string; }
interface Resp { events: Event[]; summary: { total: number; high: number; warning: number; liveSessions: number }; }

const fmt = (s: string) => new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function AdminViolations() {
  const t = useT();
  const navigate = useNavigate();
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () => api.get<Resp>("/admin/violations").then(setData).catch((e) => setError(e.message));
    load();
    const id = setInterval(load, 6000); // live refresh
    return () => clearInterval(id);
  }, []);

  const columns: Column<Event>[] = [
    { key: "when", header: t("alog.colWhen"), sortValue: (e) => e.at, csv: (e) => new Date(e.at).toISOString(), td: "text-xs text-[var(--muted)] whitespace-nowrap", render: (e) => fmt(e.at) },
    { key: "candidate", header: t("ares.colCandidate"), sortValue: (e) => e.candidate, csv: (e) => e.candidate, td: "font-medium", render: (e) => e.candidate },
    { key: "exam", header: t("acls.exam"), sortValue: (e) => e.exam, csv: (e) => e.exam, td: "text-[var(--muted)]", render: (e) => e.exam },
    { key: "type", header: t("avio.colViolation"), sortValue: (e) => e.type, csv: (e) => e.type.replace(/_/g, " "), td: "capitalize", render: (e) => e.type.replace(/_/g, " ") },
    { key: "severity", header: t("avio.colSeverity"), sortValue: (e) => e.severity, csv: (e) => e.severity, th: "text-center", td: "text-center", render: (e) => <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-semibold", e.severity === "high" ? "bg-rose-500/20 text-rose-400" : "bg-amber-500/20 text-amber-400")}>{e.severity === "high" ? t("common.high") : t("common.warning")}</span> },
    { key: "go", header: "", th: "text-right", td: "text-right", render: () => <ArrowRight className="ml-auto h-4 w-4 text-[var(--muted)]" /> },
  ];

  const filters: TableFilter<Event>[] = useMemo(() => {
    const exams = [...new Set((data?.events ?? []).map((e) => e.exam))].sort();
    return [
      { id: "sev", label: t("avio.allSeverities"), options: [{ value: "high", label: t("common.high") }, { value: "warning", label: t("common.warning") }], match: (e, v) => e.severity === v },
      { id: "exam", label: t("avio.allExams"), options: exams.map((x) => ({ value: x, label: x })), match: (e, v) => e.exam === v },
    ];
  }, [data, t]);

  return (
    <AdminShell wide>
      <div className="fade-in">
        <PageHeader title={t("avio.title")} subtitle={t("avio.subtitle")}
          actions={<span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"><Radio className="h-3 w-3" /> {t("anav.live")}</span>} />

        {error && <ErrorBanner className="mt-6">{error}</ErrorBanner>}
        {!data && !error && <div className="mt-8 flex items-center gap-2 text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}</div>}

        {data && (
          <>
            <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Kpi label={t("avio.kpiTotal")} value={data.summary.total} />
              <Kpi label={t("avio.kpiHigh")} value={data.summary.high} tone={data.summary.high ? "text-rose-400" : undefined} />
              <Kpi label={t("avio.kpiWarnings")} value={data.summary.warning} tone={data.summary.warning ? "text-amber-400" : undefined} />
              <Kpi label={t("avio.kpiLive")} value={data.summary.liveSessions} tone="text-emerald-400" />
            </div>

            <div className="mt-5">
              <DataTable
                rows={data.events}
                columns={columns}
                getId={(e) => e.id}
                searchText={(e) => `${e.candidate} ${e.exam} ${e.type}`}
                searchPlaceholder={t("avio.searchPlaceholder")}
                filters={filters}
                initialSort={{ key: "when", dir: "desc" }}
                pageSize={15}
                exportName="orcalis-violations"
                onRowClick={(e) => navigate(`/admin/attempts/${e.attemptId}`)}
                empty={<div className="flex items-center justify-center gap-2 text-sm text-emerald-400"><ShieldCheck className="h-4 w-4" /> {t("avio.none")}</div>}
              />
            </div>
            <p className="mt-2 text-center text-[11px] text-[var(--muted)]">{t("avio.refreshes")}</p>
          </>
        )}
      </div>
    </AdminShell>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className={clsx("mt-1 text-2xl font-bold tabular-nums", tone)}>{value}</p>
    </div>
  );
}
