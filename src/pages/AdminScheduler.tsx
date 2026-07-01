import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, CalendarClock, Radio, CheckCircle2, CalendarOff, Pencil } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { PageHeader } from "@/components/PageHeader";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import type { Exam } from "@shared/types";
import { clsx } from "clsx";

interface Item { exam: Exam; questionCount: number; attemptCount: number; }
type Status = "unscheduled" | "scheduled" | "open" | "closed";

function statusOf(exam: Exam): Status {
  const now = Date.now();
  const from = exam.availableFrom ? new Date(exam.availableFrom).getTime() : null;
  const until = exam.availableUntil ? new Date(exam.availableUntil).getTime() : null;
  if (!from && !until) return "unscheduled";
  if (until && now > until) return "closed";
  if (from && now < from) return "scheduled";
  return "open";
}

function toLocalInput(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

const STATUS_META: Record<Status, { key: string; cls: string; icon: typeof Radio }> = {
  open: { key: "asch.openNow", cls: "bg-emerald-500/15 text-emerald-400", icon: Radio },
  scheduled: { key: "asch.scheduled", cls: "bg-brand-500/15 text-brand-400", icon: CalendarClock },
  closed: { key: "asch.closed", cls: "bg-rose-500/15 text-rose-400", icon: CalendarOff },
  unscheduled: { key: "asch.alwaysOpen", cls: "bg-[var(--bg)] text-[var(--muted)]", icon: CheckCircle2 },
};

export function AdminScheduler() {
  const t = useT();
  const navigate = useNavigate();
  const [items, setItems] = useState<Item[] | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);

  // Only published exams are scheduled here; drafts live in the Examinations panel.
  useEffect(() => {
    api.get<{ items: Item[] }>("/admin/exams").then((d) => setItems(d.items.filter((i) => i.exam.status === "published"))).catch(() => setItems([]));
  }, []);

  const update = async (examId: string, patch: { availableFrom?: string | null; availableUntil?: string | null }) => {
    const prev = items;
    setItems((cur) => (cur ?? []).map((it) => (it.exam.id === examId ? { ...it, exam: { ...it.exam, ...patch } } : it)));
    setSavingId(examId);
    setErrorId((e) => (e === examId ? null : e));
    try {
      await api.patch(`/admin/exams/${examId}`, patch);
    } catch {
      setItems(prev); // roll back the optimistic change so the UI never lies
      setErrorId(examId);
    } finally {
      setSavingId((s) => (s === examId ? null : s));
    }
  };

  const count = (s: Status) => (items ?? []).filter((i) => statusOf(i.exam) === s).length;

  return (
    <AdminShell>
      <div className="fade-in">
        <PageHeader title={t("asch.title")} subtitle={t("asch.subtitle")} />

        {!items && <div className="mt-10 flex items-center gap-2 text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}</div>}

        {items && (
          <>
            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {(["open", "scheduled", "closed", "unscheduled"] as Status[]).map((s) => {
                const M = STATUS_META[s];
                return (
                  <div key={s} className="card p-4">
                    <div className={clsx("flex h-9 w-9 items-center justify-center rounded-lg", M.cls)}><M.icon className="h-5 w-5" /></div>
                    <p className="mt-3 text-2xl font-bold tabular-nums">{count(s)}</p>
                    <p className="text-xs text-[var(--muted)]">{t(M.key)}</p>
                  </div>
                );
              })}
            </div>

            <div className="card mt-6 overflow-hidden">
              {items.length === 0 ? (
                <p className="p-10 text-center text-sm text-[var(--muted)]">{t("asch.none")}</p>
              ) : (
                <div className="divide-y divide-[var(--border)]">
                  {items.map(({ exam }) => {
                    const st = statusOf(exam);
                    const M = STATUS_META[st];
                    return (
                      <div key={exam.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                        <div className="min-w-[200px] flex-1">
                          <p className="text-sm font-semibold">{exam.title}</p>
                          <p className="text-xs text-[var(--muted)]">{exam.code || t("acls.noCode")} · {exam.durationMinutes} min</p>
                        </div>
                        <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold", M.cls)}>
                          <M.icon className="h-3 w-3" /> {t(M.key)}
                        </span>
                        <label className="text-xs text-[var(--muted)]">
                          <span className="mb-1 block font-medium">{t("asch.opens")}</span>
                          <input type="datetime-local" className="input h-9" value={toLocalInput(exam.availableFrom)}
                            onChange={(e) => update(exam.id, { availableFrom: fromLocalInput(e.target.value) })} />
                        </label>
                        <label className="text-xs text-[var(--muted)]">
                          <span className="mb-1 block font-medium">{t("asch.closes")}</span>
                          <input type="datetime-local" className="input h-9" value={toLocalInput(exam.availableUntil)}
                            onChange={(e) => update(exam.id, { availableUntil: fromLocalInput(e.target.value) })} />
                        </label>
                        <span className="w-16 text-right text-xs">
                          {savingId === exam.id ? <span className="text-[var(--muted)]">{t("asch.saving")}</span>
                            : errorId === exam.id ? <span className="text-rose-400">{t("asch.saveFailed")}</span>
                            : ""}
                        </span>
                        <button onClick={() => navigate(`/admin/exams/${exam.id}`)} title={t("asch.editExam")}
                          className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium text-[var(--muted)] hover:bg-white/[0.03] hover:text-[var(--fg)]">
                          <Pencil className="h-3.5 w-3.5" /> {t("asch.edit")}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </AdminShell>
  );
}
