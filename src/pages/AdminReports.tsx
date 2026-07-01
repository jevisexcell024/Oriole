import { useEffect, useState } from "react";
import { FileText, Loader2, Download, GraduationCap, BookOpen, Award, BarChart3, CalendarClock, Plus, Trash2, Send } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { useT } from "@/lib/i18n";

interface ReportDef { key: string; title: string; desc: string; rows: number; }
interface Sched { id: string; reportKey: string; frequency: "daily" | "weekly"; recipients: string[]; lastSentAt: string | null; title: string; }
interface Resp {
  summary: { students: number; exams: number; attempts: number; certificates: number };
  reports: ReportDef[];
  scheduled: Sched[];
}

const ICONS: Record<string, typeof FileText> = {
  results: BarChart3, students: GraduationCap, certificates: Award,
};
// Map server report keys → translated title/desc (t() falls back to the server text if unmapped).
const RTITLE: Record<string, string> = { results: "arep.optResults", students: "arep.optStudents", certificates: "arep.optCertificates" };
const RDESC: Record<string, string> = { results: "arep.rdResults", students: "arep.rdStudents", certificates: "arep.rdCertificates" };

export function AdminReports() {
  const t = useT();
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // Scheduled-export form
  const [schedKey, setSchedKey] = useState("results");
  const [schedFreq, setSchedFreq] = useState<"daily" | "weekly">("weekly");
  const [schedEmails, setSchedEmails] = useState("");
  const [schedBusy, setSchedBusy] = useState(false);

  const reload = () => api.get<Resp>("/admin/reports").then(setData).catch((e) => setError(e.message));
  useEffect(() => { reload(); }, []);

  async function addSchedule() {
    setSchedBusy(true); setError(null);
    try {
      const recipients = schedEmails.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
      const d = await api.post<{ scheduled: Sched[] }>("/admin/reports/schedule", { reportKey: schedKey, frequency: schedFreq, recipients });
      setData((cur) => (cur ? { ...cur, scheduled: d.scheduled } : cur));
      setSchedEmails("");
    } catch (e) { setError((e as Error).message); }
    finally { setSchedBusy(false); }
  }
  async function removeSchedule(id: string) {
    try { const d = await api.del<{ scheduled: Sched[] }>(`/admin/reports/schedule/${id}`); setData((cur) => (cur ? { ...cur, scheduled: d.scheduled } : cur)); }
    catch (e) { setError((e as Error).message); }
  }

  async function download(key: string) {
    setBusy(key); setError(null);
    try {
      const qs = new URLSearchParams();
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      const res = await fetch(`/api/admin/reports/${key}.csv${qs.toString() ? `?${qs}` : ""}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${key}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  return (
    <AdminShell wide>
      <div className="fade-in max-w-4xl">
        <div className="flex items-center gap-2.5">
          <PageHeader title={t("arep.title")} subtitle={t("arep.subtitle")} />
        </div>

        {error && <p className="mt-6 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</p>}
        {!data && !error && <div className="mt-8 flex items-center gap-2 text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}</div>}

        {data && (
          <>
            <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Kpi label={t("arep.kpiStudents")} value={data.summary.students} icon={GraduationCap} />
              <Kpi label={t("arep.kpiExams")} value={data.summary.exams} icon={BookOpen} />
              <Kpi label={t("arep.kpiAttempts")} value={data.summary.attempts} icon={BarChart3} />
              <Kpi label={t("arep.kpiCertificates")} value={data.summary.certificates} icon={Award} />
            </div>

            <h2 className="mt-6 text-sm font-semibold">{t("arep.exports")}</h2>
            <div className="mt-2 flex flex-wrap items-end gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
              <CalendarClock className="mb-1.5 h-4 w-4 text-[#c6ff34]" />
              <label className="text-[11px] text-[var(--muted)]">{t("arep.from")}<input type="date" className="input mt-1 h-9 w-40" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
              <label className="text-[11px] text-[var(--muted)]">{t("arep.to")}<input type="date" className="input mt-1 h-9 w-40" value={to} onChange={(e) => setTo(e.target.value)} /></label>
              {(from || to) && <button onClick={() => { setFrom(""); setTo(""); }} className="btn btn-ghost mb-0.5 h-9 text-xs">{t("arep.clear")}</button>}
              <span className="mb-2 text-[11px] text-[var(--muted)]">{from || to ? t("arep.filtering") : t("arep.optionalRange")}</span>
            </div>
            <div className="mt-3 space-y-3">
              {data.reports.map((r) => {
                const Icon = ICONS[r.key] ?? FileText;
                return (
                  <div key={r.key} className="card flex items-center justify-between gap-4 p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/15 text-brand-400"><Icon className="h-5 w-5" /></div>
                      <div>
                        <p className="text-sm font-semibold">{t(RTITLE[r.key] ?? r.title)}</p>
                        <p className="text-xs text-[var(--muted)]">{t(RDESC[r.key] ?? r.desc)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-[var(--muted)]">{t("arep.nRows", { n: r.rows })}</span>
                      <button onClick={() => download(r.key)} disabled={busy === r.key || r.rows === 0} className="btn btn-outline disabled:opacity-40">
                        {busy === r.key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} CSV
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-4 text-xs text-[var(--muted)]">{t("arep.csvNote")}</p>

            {/* Scheduled exports */}
            <h2 className="mt-8 flex items-center gap-2 text-sm font-semibold"><Send className="h-4 w-4 text-[#c6ff34]" /> {t("arep.scheduledExports")}</h2>
            <p className="text-xs text-[var(--muted)]">{t("arep.scheduledDesc")}</p>

            <div className="card mt-3 flex flex-wrap items-end gap-3 p-4">
              <label className="text-[11px] text-[var(--muted)]">{t("arep.report")}
                <select className="input mt-1 h-9 w-44" value={schedKey} onChange={(e) => setSchedKey(e.target.value)}>
                  <option value="results">{t("arep.optResults")}</option>
                  <option value="students">{t("arep.optStudents")}</option>
                  <option value="certificates">{t("arep.optCertificates")}</option>
                </select>
              </label>
              <label className="text-[11px] text-[var(--muted)]">{t("arep.frequency")}
                <select className="input mt-1 h-9 w-28" value={schedFreq} onChange={(e) => setSchedFreq(e.target.value as "daily" | "weekly")}>
                  <option value="daily">{t("arep.daily")}</option>
                  <option value="weekly">{t("arep.weekly")}</option>
                </select>
              </label>
              <label className="min-w-[200px] flex-1 text-[11px] text-[var(--muted)]">{t("arep.recipients")}
                <input className="input mt-1 h-9" value={schedEmails} onChange={(e) => setSchedEmails(e.target.value)} placeholder="dean@institution.edu, records@institution.edu" />
              </label>
              <button onClick={addSchedule} disabled={schedBusy || !schedEmails.trim()} className="btn btn-primary h-9 disabled:opacity-50">{schedBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {t("arep.schedule")}</button>
            </div>

            {data.scheduled.length > 0 && (
              <div className="mt-3 space-y-2">
                {data.scheduled.map((s) => (
                  <div key={s.id} className="card flex flex-wrap items-center justify-between gap-3 p-3.5">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{t(RTITLE[s.reportKey] ?? s.title)} · <span className="text-[#c6ff34]">{s.frequency === "daily" ? t("arep.daily") : t("arep.weekly")}</span></p>
                      <p className="truncate text-xs text-[var(--muted)]">{s.recipients.join(", ")}{s.lastSentAt ? ` · ${t("arep.lastSent", { date: new Date(s.lastSentAt).toLocaleDateString() })}` : ` · ${t("arep.notSent")}`}</p>
                    </div>
                    <button onClick={() => removeSchedule(s.id)} className="rounded-lg p-2 text-[var(--muted)] hover:bg-rose-500/10 hover:text-rose-400" title={t("arep.scheduledExports")}><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </AdminShell>
  );
}

function Kpi({ label, value, icon: Icon }: { label: string; value: number; icon: typeof FileText }) {
  return (
    <div className="card flex items-center gap-3 p-4">
      <Icon className="h-5 w-5 text-[var(--muted)]" />
      <div>
        <p className="text-xs text-[var(--muted)]">{label}</p>
        <p className="text-xl font-bold tabular-nums">{value}</p>
      </div>
    </div>
  );
}
