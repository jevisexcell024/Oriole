import { useEffect, useState } from "react";
import { Loader2, Award, ExternalLink } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { useT } from "@/lib/i18n";

interface Cert { certNumber: string; score: number; issuedAt: string; examTitle: string; candidateName: string; }

export function AdminCertificates() {
  const t = useT();
  const [certs, setCerts] = useState<Cert[] | null>(null);

  useEffect(() => { api.get<{ certificates: Cert[] }>("/admin/certificates").then((d) => setCerts(d.certificates)).catch(() => setCerts([])); }, []);

  const columns: Column<Cert>[] = [
    { key: "candidate", header: t("ares.colCandidate"), sortValue: (c) => c.candidateName, csv: (c) => c.candidateName, td: "font-medium", render: (c) => c.candidateName },
    { key: "exam", header: t("ares.colExam"), sortValue: (c) => c.examTitle, csv: (c) => c.examTitle, render: (c) => c.examTitle },
    { key: "score", header: t("ares.colScore"), sortValue: (c) => c.score, csv: (c) => `${c.score}%`, th: "text-right", td: "text-right tabular-nums", render: (c) => `${c.score}%` },
    { key: "num", header: t("acert.colNumber"), csv: (c) => c.certNumber, td: "font-mono text-xs", render: (c) => c.certNumber },
    { key: "issued", header: t("acert.colIssued"), sortValue: (c) => c.issuedAt, csv: (c) => new Date(c.issuedAt).toLocaleDateString(), td: "text-[var(--muted)]", render: (c) => new Date(c.issuedAt).toLocaleDateString() },
    { key: "verify", header: "", th: "text-right", td: "text-right", render: (c) => (
      <a href={`/verify/${c.certNumber}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-xs font-medium text-brand-400 hover:underline">{t("acert.verify")} <ExternalLink className="h-3.5 w-3.5" /></a>
    ) },
  ];

  return (
    <AdminShell wide>
      <div className="fade-in">
        <PageHeader title={t("acert.title")} subtitle={t("acert.subtitle")} />

        {!certs ? (
          <div className="mt-10 flex items-center gap-2 text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}</div>
        ) : (
          <div className="mt-6">
            <DataTable
              rows={certs}
              columns={columns}
              getId={(c) => c.certNumber}
              searchText={(c) => `${c.candidateName} ${c.examTitle} ${c.certNumber}`}
              searchPlaceholder={t("acert.searchPlaceholder")}
              initialSort={{ key: "issued", dir: "desc" }}
              exportName="orcalis-certificates"
              empty={<div className="flex flex-col items-center gap-2 text-sm text-[var(--muted)]"><Award className="h-8 w-8" /> {t("acert.none")}</div>}
            />
          </div>
        )}
      </div>
    </AdminShell>
  );
}
