import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Hourglass, Clock, CalendarCheck } from "lucide-react";
import { Shell } from "@/components/Shell";
import { TableSkeleton, EmptyState } from "@/components/ui";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { useT } from "@/lib/i18n";
import { clsx } from "clsx";

interface Row { examTitle: string; examCode: string; status: string; scheduled: string | null; checkedInAt: string | null; submittedAt: string | null; }
const fmt = (s: string | null) => (s ? new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

// status → { i18n key, colour class, icon }
const META: Record<string, { key: string; cls: string; icon: typeof CheckCircle2 }> = {
  completed: { key: "att.completed", cls: "bg-emerald-500/15 text-emerald-400", icon: CheckCircle2 },
  in_progress: { key: "att.inProgress", cls: "bg-blue-500/15 text-blue-400", icon: Clock },
  present: { key: "att.present", cls: "bg-teal-500/15 text-teal-400", icon: CheckCircle2 },
  absent: { key: "att.absent", cls: "bg-rose-500/15 text-rose-400", icon: XCircle },
  expected: { key: "att.expected", cls: "bg-white/[0.06] text-[var(--muted)]", icon: Hourglass },
  not_confirmed: { key: "att.notConfirmed", cls: "bg-amber-500/15 text-amber-400", icon: Hourglass },
};

export function StudentAttendance() {
  const t = useT();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.get<{ attendance: Row[] }>("/my/attendance").then((d) => setRows(d.attendance)).catch((e) => setError(e.message)); }, []);

  return (
    <Shell>
      <div className="fade-in">
        <PageHeader title={t("att.title")} subtitle={t("att.subtitle")} />

        {error && <p className="mt-6 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</p>}
        {!rows && !error && <div className="card mt-6"><TableSkeleton rows={5} cells={4} avatar={false} /></div>}

        {rows && rows.length === 0 && (
          <EmptyState
            className="mt-6"
            icon={CalendarCheck}
            title={t("att.none")}
            hint={t("att.noneHint")}
          />
        )}

        {rows && rows.length > 0 && (
          <div className="card mt-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
                  <th className="px-4 py-2.5 font-semibold">{t("att.exam")}</th>
                  <th className="px-3 py-2.5 font-semibold">{t("att.status")}</th>
                  <th className="hidden px-3 py-2.5 font-semibold sm:table-cell">{t("att.scheduled")}</th>
                  <th className="hidden px-3 py-2.5 font-semibold md:table-cell">{t("att.checkedIn")}</th>
                  <th className="hidden px-3 py-2.5 font-semibold md:table-cell">{t("att.submitted")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const m = META[r.status] ?? META.expected;
                  return (
                    <tr key={i} className="border-b border-[var(--border)] last:border-0">
                      <td className="px-4 py-3"><span className="font-medium">{r.examTitle}</span><span className="block text-xs text-[var(--muted)]">{r.examCode}</span></td>
                      <td className="px-3 py-3"><span className={clsx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", m.cls)}><m.icon className="h-3 w-3" /> {t(m.key)}</span></td>
                      <td className="hidden px-3 py-3 text-xs text-[var(--muted)] sm:table-cell">{fmt(r.scheduled)}</td>
                      <td className="hidden px-3 py-3 text-xs text-[var(--muted)] md:table-cell">{fmt(r.checkedInAt)}</td>
                      <td className="hidden px-3 py-3 text-xs text-[var(--muted)] md:table-cell">{fmt(r.submittedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Shell>
  );
}
