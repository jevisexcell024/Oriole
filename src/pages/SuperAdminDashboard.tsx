import { useEffect, useState } from "react";
import { Building2, Users, GraduationCap, ShieldCheck, Eye, BookOpen, CalendarClock, Radio, Clock } from "lucide-react";
import { SuperAdminShell } from "@/components/SuperAdminShell";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton, ErrorBanner } from "@/components/ui";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";

interface DashboardData {
  institutions: { total: number; active: number; suspended: number };
  users: { total: number; students: number; facilitators: number; proctors: number; administrators: number };
  exams: { active: number; today: number };
  liveSessions: number;
  platformUptimeSeconds: number;
}

function fmtUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function StatCard({ icon: Icon, label, value, hint }: { icon: typeof Building2; label: string; value: string | number; hint?: string }) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 text-[var(--muted)]">
        <Icon className="h-4 w-4" />
        <span className="text-[11px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-[var(--muted)]">{hint}</p>}
    </div>
  );
}

export function SuperAdminDashboard() {
  const t = useT();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<DashboardData>("/super-admin/dashboard").then(setData).catch((e) => setError(e.message));
  }, []);

  return (
    <SuperAdminShell>
      <div className="fade-in max-w-[1400px]">
        <PageHeader eyebrow={t("sad.dashEyebrow")} title={t("sad.dashTitle")} subtitle={t("sad.dashSubtitle")} />

        {error && <ErrorBanner className="mt-6">{error}</ErrorBanner>}

        {!data && !error && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
          </div>
        )}

        {data && (
          <>
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">{t("sad.secInstitutions")}</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatCard icon={Building2} label={t("sad.totalInstitutions")} value={data.institutions.total} />
              <StatCard icon={Building2} label={t("sad.activeInstitutions")} value={data.institutions.active} />
              <StatCard icon={Building2} label={t("sad.suspendedInstitutions")} value={data.institutions.suspended} />
            </div>

            <p className="mb-3 mt-6 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">{t("sad.secUsers")}</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard icon={Users} label={t("sad.totalUsers")} value={data.users.total} />
              <StatCard icon={GraduationCap} label={t("sad.students")} value={data.users.students} />
              <StatCard icon={Users} label={t("sad.facilitators")} value={data.users.facilitators} />
              <StatCard icon={Eye} label={t("sad.proctors")} value={data.users.proctors} />
              <StatCard icon={ShieldCheck} label={t("sad.administrators")} value={data.users.administrators} />
            </div>

            <p className="mb-3 mt-6 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">{t("sad.secPlatform")}</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard icon={BookOpen} label={t("sad.activeExams")} value={data.exams.active} />
              <StatCard icon={CalendarClock} label={t("sad.examsToday")} value={data.exams.today} />
              <StatCard icon={Radio} label={t("sad.liveSessions")} value={data.liveSessions} />
              <StatCard icon={Clock} label={t("sad.platformUptime")} value={fmtUptime(data.platformUptimeSeconds)} />
            </div>
          </>
        )}
      </div>
    </SuperAdminShell>
  );
}
