import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Loader2, CheckCircle2, XCircle, Hourglass, Clock, IdCard, Camera, ArrowRight,
} from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { ErrorBanner } from "@/components/ui";
import { PageHeader } from "@/components/PageHeader";
import { api } from "@/lib/api";
import { DataTable, type Column, type TableFilter } from "@/components/DataTable";
import { useT } from "@/lib/i18n";
import { clsx } from "clsx";

interface Session {
  examId: string; title: string; code: string; status: string; scheduled: string | null;
  enrolled: number; confirmed: number; present: number; completed: number; inProgress: number; absent: number;
}
interface RosterRow {
  candidateId: string; name: string; email: string; status: string; approval: string;
  scheduled: string | null; checkedInAt: string | null; startedAt: string | null; submittedAt: string | null;
  identity: string | null; hasPhoto: boolean; rulesAccepted: boolean; attemptId: string | null;
}
interface Detail {
  exam: { id: string; title: string; code: string; durationMinutes: number; scheduled: string | null };
  summary: { enrolled: number; present: number; inProgress: number; completed: number; absent: number };
  roster: RosterRow[];
}

const STATUS_META: Record<string, { key: string; cls: string; icon: typeof CheckCircle2 }> = {
  completed: { key: "aatt.completed", cls: "bg-emerald-500/20 text-emerald-400", icon: CheckCircle2 },
  in_progress: { key: "aatt.inProgress", cls: "bg-blue-500/20 text-blue-400", icon: Clock },
  present: { key: "aatt.present", cls: "bg-teal-500/20 text-teal-400", icon: CheckCircle2 },
  absent: { key: "aatt.absent", cls: "bg-rose-500/20 text-rose-400", icon: XCircle },
  expected: { key: "aatt.expected", cls: "bg-[var(--card-2)] text-[var(--muted)]", icon: Hourglass },
  not_confirmed: { key: "aatt.notConfirmed", cls: "bg-amber-500/20 text-amber-400", icon: Hourglass },
};
const fmtTime = (s: string | null) => (s ? new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

export function AdminAttendance() {
  const t = useT();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ sessions: Session[] }>("/admin/attendance")
      .then((d) => { setSessions(d.sessions); if (d.sessions[0]) setSelected(d.sessions[0].examId); })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!selected) return;
    setDetail(null);
    api.get<Detail>(`/admin/attendance/${selected}`).then(setDetail).catch((e) => setError(e.message));
  }, [selected]);

  const columns: Column<RosterRow>[] = [
    { key: "candidate", header: t("ares.colCandidate"), sortValue: (r) => r.name, csv: (r) => `${r.name} <${r.email}>`, render: (r) => (
      <Link to={`/admin/students/${r.candidateId}`} onClick={(e) => e.stopPropagation()} className="block hover:text-brand-400">
        <span className="block font-medium">{r.name}</span><span className="block text-xs text-[var(--muted)]">{r.email}</span>
      </Link>
    ) },
    { key: "att", header: t("aatt.colAttendance"), sortValue: (r) => r.status, csv: (r) => t((STATUS_META[r.status] ?? STATUS_META.expected).key), render: (r) => { const m = STATUS_META[r.status] ?? STATUS_META.expected; return <span className={clsx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", m.cls)}><m.icon className="h-3 w-3" /> {t(m.key)}</span>; } },
    { key: "in", header: t("att.checkedIn"), sortValue: (r) => r.checkedInAt ?? "", csv: (r) => fmtTime(r.checkedInAt), td: "text-xs text-[var(--muted)] whitespace-nowrap", render: (r) => fmtTime(r.checkedInAt) },
    { key: "started", header: t("aatt.colStarted"), sortValue: (r) => r.startedAt ?? "", csv: (r) => fmtTime(r.startedAt), td: "text-xs text-[var(--muted)] whitespace-nowrap", render: (r) => fmtTime(r.startedAt) },
    { key: "sub", header: t("att.submitted"), sortValue: (r) => r.submittedAt ?? "", csv: (r) => fmtTime(r.submittedAt), td: "text-xs text-[var(--muted)] whitespace-nowrap", render: (r) => fmtTime(r.submittedAt) },
    { key: "id", header: t("aatt.colIdentity"), csv: (r) => r.identity ?? "", th: "text-center", td: "text-center", render: (r) => (
      <div className="flex items-center justify-center gap-1.5">
        {r.identity ? <span title={t("aatt.idTitle", { id: r.identity })} className="inline-flex items-center gap-1 text-xs text-emerald-400"><IdCard className="h-3.5 w-3.5" /> {r.identity}</span> : <span className="text-xs text-[var(--muted)]">—</span>}
        {r.hasPhoto && <Camera className="h-3.5 w-3.5 text-brand-400" />}
      </div>
    ) },
    { key: "go", header: "", th: "text-right", td: "text-right", render: (r) => r.attemptId ? <Link to={`/admin/attempts/${r.attemptId}`} onClick={(e) => e.stopPropagation()} className="inline-flex text-[var(--muted)] hover:text-[var(--fg)]"><ArrowRight className="h-4 w-4" /></Link> : null },
  ];

  const filters: TableFilter<RosterRow>[] = [
    { id: "status", label: t("aatt.allAttendance"), options: Object.entries(STATUS_META).map(([v, m]) => ({ value: v, label: t(m.key) })), match: (r, v) => r.status === v },
  ];

  return (
    <AdminShell wide>
      <div className="fade-in">
        <PageHeader title={t("aatt.title")} subtitle={t("aatt.subtitle")} />

        {error && <ErrorBanner className="mt-6">{error}</ErrorBanner>}
        {!sessions && !error && <div className="mt-8 flex items-center gap-2 text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}</div>}
        {sessions && sessions.length === 0 && <p className="card mt-6 p-8 text-center text-sm text-[var(--muted)]">{t("aatt.noSessions")}</p>}

        {sessions && sessions.length > 0 && (
          <>
            <div className="mt-5 flex max-h-40 flex-wrap gap-2 overflow-y-auto">
              {sessions.map((s) => (
                <button key={s.examId} onClick={() => setSelected(s.examId)}
                  className={clsx("rounded-xl border px-3.5 py-2.5 text-left transition",
                    selected === s.examId ? "border-[#111110] bg-[#111110] text-white" : "border-[var(--border)] bg-[var(--card)] hover:bg-[var(--card-2)]")}>
                  <span className="block text-sm font-semibold">{s.title}</span>
                  <span className={clsx("text-xs", selected === s.examId ? "text-white/70" : "text-[var(--muted)]")}>
                    {t("aatt.presentOf", { present: s.present, total: s.confirmed || s.enrolled })}{s.absent ? t("aatt.absentSuffix", { n: s.absent }) : ""}
                  </span>
                </button>
              ))}
            </div>

            {!detail ? (
              <div className="mt-8 flex items-center gap-2 text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> {t("aatt.loadingRoster")}</div>
            ) : (
              <>
                <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-5">
                  <Kpi label={t("aatt.kpiEnrolled")} value={detail.summary.enrolled} />
                  <Kpi label={t("aatt.kpiPresent")} value={detail.summary.present} tone="text-teal-400" />
                  <Kpi label={t("aatt.kpiInProgress")} value={detail.summary.inProgress} tone="text-blue-400" />
                  <Kpi label={t("aatt.kpiCompleted")} value={detail.summary.completed} tone="text-emerald-400" />
                  <Kpi label={t("aatt.kpiAbsent")} value={detail.summary.absent} tone="text-rose-400" />
                </div>

                <div className="mt-4">
                  <DataTable
                    rows={detail.roster}
                    columns={columns}
                    getId={(r) => r.candidateId}
                    searchText={(r) => `${r.name} ${r.email} ${r.identity ?? ""}`}
                    searchPlaceholder={t("aatt.searchCandidate")}
                    filters={filters}
                    pageSize={15}
                    exportName={`attendance-${detail.exam.code || detail.exam.id}`}
                    empty={t("aatt.noCandidates")}
                  />
                </div>
              </>
            )}
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
