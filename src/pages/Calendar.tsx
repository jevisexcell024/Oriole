import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, CalendarDays } from "lucide-react";
import { Shell } from "@/components/Shell";
import { AdminShell } from "@/components/AdminShell";
import { PageHeader } from "@/components/PageHeader";
import { MonthCalendar, type CalEvent } from "@/components/MonthCalendar";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import type { Exam, ExamListItem } from "@shared/types";

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// ── Student: my exam timetable ──────────────────────────────────────────────
export function StudentCalendar() {
  const t = useT();
  const navigate = useNavigate();
  const [items, setItems] = useState<ExamListItem[] | null>(null);

  useEffect(() => { api.get<{ items: ExamListItem[] }>("/exams").then((d) => setItems(d.items)).catch(() => setItems([])); }, []);

  const events: CalEvent[] = useMemo(() => (items ?? []).flatMap((it) => {
    const iso = it.registration.scheduledStart || it.exam.availableFrom;
    if (!iso) return [];
    const done = it.attempt?.status === "submitted";
    const ready = it.registration.approval === "confirmed" && it.registration.systemCheckPassed;
    const color = done ? "#0EA5E9" : ready ? "#16A34A" : "#E9B949";
    return [{
      id: it.registration.id, date: new Date(iso), title: it.exam.title,
      sub: `${fmtTime(iso)} · ${done ? t("cal.completed") : ready ? t("cal.ready") : t("cal.pendingSetup")}`,
      color,
      onClick: () => navigate(done && it.attempt ? `/attempts/${it.attempt.id}/result` : `/exams/${it.registration.id}/checkin`),
    }];
  }), [items, navigate, t]);

  return (
    <Shell>
      <div className="fade-in max-w-[1000px]">
        <PageHeader title={t("cal.title")} subtitle={t("cal.subtitle")} />
        {!items ? (
          <div className="mt-8 flex items-center gap-2 text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}</div>
        ) : (
          <div className="mt-6"><MonthCalendar events={events} empty={t("cal.noneDay")} /></div>
        )}
      </div>
    </Shell>
  );
}

// ── Admin: scheduled exams across the institution ───────────────────────────
interface AdminItem { exam: Exam; questionCount: number; attemptCount: number; }

export function AdminCalendar() {
  const t = useT();
  const navigate = useNavigate();
  const [items, setItems] = useState<AdminItem[] | null>(null);

  useEffect(() => { api.get<{ items: AdminItem[] }>("/admin/exams").then((d) => setItems(d.items)).catch(() => setItems([])); }, []);

  const { events, unscheduled } = useMemo(() => {
    const list = items ?? [];
    const ev: CalEvent[] = list.flatMap(({ exam }) => {
      if (!exam.availableFrom) return [];
      return [{
        id: exam.id, date: new Date(exam.availableFrom), title: exam.title,
        sub: `${t("acal.opens", { time: fmtTime(exam.availableFrom) })}${exam.code ? ` · ${exam.code}` : ""}`,
        color: "#c6ff34",
        onClick: () => navigate(`/admin/exams/${exam.id}`),
      }];
    });
    return { events: ev, unscheduled: list.filter((i) => i.exam.status === "published" && !i.exam.availableFrom).length };
  }, [items, navigate, t]);

  return (
    <AdminShell wide>
      <div className="fade-in max-w-[1100px]">
        <PageHeader title={t("cal.title")} subtitle={t("acal.subtitle")}
          actions={<button onClick={() => navigate("/admin/scheduler")} className="btn btn-on-teal"><CalendarDays className="h-4 w-4" /> {t("acal.openScheduler")}</button>} />
        {!items ? (
          <div className="mt-8 flex items-center gap-2 text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}</div>
        ) : (
          <>
            {unscheduled > 0 && (
              <p className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-2.5 text-xs text-[var(--muted)]">
                {t("acal.unscheduled", { n: unscheduled })}<button onClick={() => navigate("/admin/scheduler")} className="font-semibold text-[#c6ff34] hover:underline">{t("acal.schedulerLink")}</button>.
              </p>
            )}
            <div className="mt-4"><MonthCalendar events={events} empty={t("acal.noneOpenDay")} /></div>
          </>
        )}
      </div>
    </AdminShell>
  );
}
