import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, ArrowRight, CheckCircle2 } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { PageHeader } from "@/components/PageHeader";
import { api } from "@/lib/api";
import { DataTable, type Column } from "@/components/DataTable";
import { useT } from "@/lib/i18n";

interface QueueItem {
  attemptId: string;
  candidateName: string;
  candidateEmail: string;
  examTitle: string;
  submittedAt: string | null;
  provisionalScore: number;
  toGrade: number;
}

const fmt = (s: string | null) => (s ? new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

export function AdminGrading() {
  const t = useT();
  const navigate = useNavigate();
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ queue: QueueItem[] }>("/admin/grading/queue").then((d) => setQueue(d.queue)).catch((e) => setError(e.message));
  }, []);

  const columns: Column<QueueItem>[] = [
    { key: "candidate", header: t("ares.colCandidate"), sortValue: (q) => q.candidateName, csv: (q) => q.candidateName, render: (q) => <><span className="block font-medium">{q.candidateName}</span><span className="block text-xs text-[var(--muted)]">{q.candidateEmail}</span></> },
    { key: "exam", header: t("ares.colExam"), sortValue: (q) => q.examTitle, csv: (q) => q.examTitle, td: "text-[var(--muted)]", render: (q) => q.examTitle },
    { key: "submitted", header: t("ares.colSubmitted"), sortValue: (q) => q.submittedAt ?? "", csv: (q) => fmt(q.submittedAt), td: "text-xs text-[var(--muted)] whitespace-nowrap", render: (q) => fmt(q.submittedAt) },
    { key: "prov", header: t("agr.colProvisional"), sortValue: (q) => q.provisionalScore, csv: (q) => `${q.provisionalScore}%`, th: "text-right", td: "text-right font-bold tabular-nums", render: (q) => `${q.provisionalScore}%` },
    { key: "toGrade", header: t("agr.colToGrade"), sortValue: (q) => q.toGrade, csv: (q) => String(q.toGrade), th: "text-right", td: "text-right", render: (q) => <span className="rounded-full bg-amber-500/20 px-2.5 py-1 text-xs font-semibold text-amber-400">{q.toGrade}</span> },
    { key: "go", header: "", th: "text-right", td: "text-right", render: () => <ArrowRight className="ml-auto h-4 w-4 text-[var(--muted)]" /> },
  ];

  return (
    <AdminShell wide>
      <div className="fade-in">
        <PageHeader title={t("agr.title")} subtitle={t("agr.subtitle")} />

        {error && <p className="mt-6 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</p>}
        {!queue && !error && <div className="mt-8 flex items-center gap-2 text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}</div>}

        {queue && (
          <div className="mt-6">
            <DataTable
              rows={queue}
              columns={columns}
              getId={(q) => q.attemptId}
              searchText={(q) => `${q.candidateName} ${q.candidateEmail} ${q.examTitle}`}
              searchPlaceholder={t("ares.searchPlaceholder")}
              initialSort={{ key: "submitted", dir: "asc" }}
              pageSize={15}
              exportName="orcalis-grading-queue"
              onRowClick={(q) => navigate(`/admin/attempts/${q.attemptId}`)}
              empty={<div className="flex flex-col items-center gap-2 text-sm"><CheckCircle2 className="h-8 w-8 text-emerald-500" /><span className="font-semibold text-[var(--fg)]">{t("agr.nothingToGrade")}</span><span className="text-[var(--muted)]">{t("agr.allAuto")}</span></div>}
            />
          </div>
        )}
      </div>
    </AdminShell>
  );
}
