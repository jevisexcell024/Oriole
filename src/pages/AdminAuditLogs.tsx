import { useEffect, useMemo, useState } from "react";
import { ScrollText, Loader2 } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { ErrorBanner } from "@/components/ui";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column, type TableFilter } from "@/components/DataTable";
import { useT } from "@/lib/i18n";
import { clsx } from "clsx";

interface Log { id: string; at: string; actorId: string; actorName: string; action: string; target: string; }
const fmt = (s: string) => new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

const ACTION_TONE: Record<string, string> = {
  deleted: "bg-rose-500/20 text-rose-400", unpublished: "bg-amber-500/20 text-amber-400",
  published: "bg-emerald-500/20 text-emerald-400", created: "bg-blue-500/20 text-blue-400",
  released: "bg-emerald-500/20 text-emerald-400", updated: "bg-[var(--card-2)] text-[var(--muted)]",
};
const verbOf = (action: string) => action.split(".")[0] ?? "";
const tone = (action: string) => ACTION_TONE[action.split(".")[1] ?? ""] ?? "bg-[var(--card-2)] text-[var(--muted)]";

export function AdminAuditLogs() {
  const t = useT();
  const [logs, setLogs] = useState<Log[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.get<{ logs: Log[] }>("/admin/audit-logs").then((d) => setLogs(d.logs)).catch((e) => setError(e.message)); }, []);

  const columns: Column<Log>[] = [
    { key: "when", header: t("alog.colWhen"), sortValue: (l) => l.at, csv: (l) => new Date(l.at).toISOString(), td: "text-xs text-[var(--muted)] whitespace-nowrap", render: (l) => fmt(l.at) },
    { key: "actor", header: t("alog.colActor"), sortValue: (l) => l.actorName, csv: (l) => l.actorName, td: "font-medium", render: (l) => l.actorName },
    { key: "action", header: t("alog.colAction"), sortValue: (l) => l.action, csv: (l) => l.action, render: (l) => <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-semibold", tone(l.action))}>{l.action}</span> },
    { key: "detail", header: t("alog.colDetail"), csv: (l) => l.target, td: "text-[var(--muted)]", render: (l) => l.target },
  ];

  const filters: TableFilter<Log>[] = useMemo(() => {
    const verbs = [...new Set((logs ?? []).map((l) => verbOf(l.action)).filter(Boolean))].sort();
    return [{ id: "area", label: t("alog.allAreas"), options: verbs.map((v) => ({ value: v, label: v })), match: (l, v) => verbOf(l.action) === v }];
  }, [logs, t]);

  return (
    <AdminShell wide>
      <div className="fade-in">
        <PageHeader title={t("alog.title")} subtitle={t("alog.subtitle")} />

        {error && <ErrorBanner className="mt-6">{error}</ErrorBanner>}
        {!logs && !error && <div className="mt-8 flex items-center gap-2 text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}</div>}

        {logs && (
          <div className="mt-6">
            <DataTable
              rows={logs}
              columns={columns}
              getId={(l) => l.id}
              searchText={(l) => `${l.actorName} ${l.action} ${l.target}`}
              searchPlaceholder={t("alog.searchPlaceholder")}
              filters={filters}
              initialSort={{ key: "when", dir: "desc" }}
              pageSize={15}
              exportName="orcalis-audit-logs"
              empty={<div className="flex flex-col items-center gap-2 text-sm text-[var(--muted)]"><ScrollText className="h-8 w-8" /> {t("alog.none")}</div>}
            />
          </div>
        )}
      </div>
    </AdminShell>
  );
}
