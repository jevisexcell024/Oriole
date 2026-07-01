import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Printer, Loader2, Award, GraduationCap, TrendingUp } from "lucide-react";
import { api } from "@/lib/api";
import { StudentTrend } from "@/components/StudentTrend";
import { useT } from "@/lib/i18n";
import type { StudentTrend as StudentTrendData } from "@shared/types";

interface ExamRow { examTitle: string; examCode: string; subject: string | null; score: number; rawScore: number; letter: string | null; passed: boolean; submittedAt: string | null; gradingStatus: string }
interface Report {
  student: { name: string; email: string; studentClass: string | null; gender: string | null; phone: string | null };
  summary: { attempts: number; avgScore: number | null; best: number | null; passed: number; failed: number; certificates: number; gpa: number | null };
  exams: ExamRow[];
  certificates: { certNumber: string; examTitle: string; score: number; issuedAt: string }[];
  attendance: { registered: number; sat: number; checkedIn: number; late: number };
  trend: StudentTrendData;
  generatedAt: string; org: string;
}

const fmt = (s: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");

export function AdminStudentReport() {
  const t = useT();
  const { id } = useParams();
  const navigate = useNavigate();
  const [d, setD] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.get<Report>(`/admin/students/${id}/report`).then(setD).catch((e) => setError(e.message)); }, [id]);

  if (error) return <div className="flex min-h-screen items-center justify-center text-rose-400">{error}</div>;
  if (!d) return <div className="flex min-h-screen items-center justify-center gap-2 text-[var(--muted)]"><Loader2 className="h-5 w-5 animate-spin" /> {t("arpt.loading")}</div>;

  return (
    <div className="min-h-screen bg-[var(--bg)] print:bg-white">
      <div className="mx-auto max-w-3xl p-6 print:max-w-none print:p-0">
        {/* Toolbar (screen only) */}
        <div className="mb-4 flex items-center justify-between print:hidden">
          <button onClick={() => navigate(-1)} className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--fg)]"><ArrowLeft className="h-4 w-4" /> {t("arpt.back")}</button>
          <button onClick={() => window.print()} className="btn btn-primary"><Printer className="h-4 w-4" /> {t("arpt.print")}</button>
        </div>

        {/* Document sheet — always a white page, so it prints cleanly in any theme */}
        <div className="rounded-lg bg-white p-8 text-[#111110] shadow-sm ring-1 ring-black/5 print:rounded-none print:shadow-none print:ring-0">
          <div className="flex items-start justify-between border-b-2 border-[#c6ff34] pb-4">
            <div>
              <h1 className="text-xl font-extrabold tracking-tight">{t("arpt.title")}</h1>
              <p className="text-sm text-[#5A7280]">{d.org}</p>
            </div>
            <div className="text-right text-xs text-[#5A7280]">
              <p>{t("arpt.generated")}</p>
              <p className="font-semibold text-[#111110]">{fmt(d.generatedAt)}</p>
            </div>
          </div>

          {/* Student details */}
          <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
            <Detail label={t("arpt.name")} value={d.student.name} />
            <Detail label={t("arpt.email")} value={d.student.email} />
            <Detail label={t("arpt.class")} value={d.student.studentClass || "—"} />
            {d.student.gender && <Detail label={t("arpt.gender")} value={d.student.gender} />}
            {d.student.phone && <Detail label={t("arpt.phone")} value={d.student.phone} />}
          </div>

          {/* Summary */}
          <div className="mt-6 grid grid-cols-3 gap-3 sm:grid-cols-7">
            <Stat label={t("arpt.exams")} value={d.summary.attempts} />
            <Stat label={t("arpt.average")} value={d.summary.avgScore == null ? "—" : `${d.summary.avgScore}%`} />
            <Stat label={t("arpt.gpa")} value={d.summary.gpa == null ? "—" : d.summary.gpa.toFixed(2)} />
            <Stat label={t("arpt.best")} value={d.summary.best == null ? "—" : `${d.summary.best}%`} />
            <Stat label={t("arpt.passed")} value={d.summary.passed} tone="#16A34A" />
            <Stat label={t("arpt.failed")} value={d.summary.failed} tone="#DC2626" />
            <Stat label={t("arpt.certificates")} value={d.summary.certificates} />
          </div>

          {/* Subject performance trends */}
          <h2 className="mt-7 flex items-center gap-2 text-sm font-bold"><TrendingUp className="h-4 w-4 text-[#c6ff34]" /> {t("arpt.trends")}</h2>
          <div className="mt-2"><StudentTrend trend={d.trend} variant="print" /></div>

          {/* Exam history */}
          <h2 className="mt-7 flex items-center gap-2 text-sm font-bold"><GraduationCap className="h-4 w-4 text-[#c6ff34]" /> {t("arpt.history")}</h2>
          {d.exams.length === 0 ? (
            <p className="mt-2 text-sm text-[#5A7280]">{t("arpt.noExams")}</p>
          ) : (
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="border-b border-[#E2E8EC] text-left text-[11px] uppercase tracking-wide text-[#5A7280]">
                  <th className="py-1.5 font-semibold">{t("arpt.colExam")}</th>
                  <th className="py-1.5 font-semibold">{t("arpt.colDate")}</th>
                  <th className="py-1.5 text-right font-semibold">{t("arpt.colScore")}</th>
                  <th className="py-1.5 text-center font-semibold">{t("arpt.colGrade")}</th>
                  <th className="py-1.5 text-center font-semibold">{t("arpt.colResult")}</th>
                </tr>
              </thead>
              <tbody>
                {d.exams.map((e, i) => (
                  <tr key={i} className="border-b border-[#EDF1F3] last:border-0">
                    <td className="py-1.5"><span className="font-medium">{e.examTitle}</span>{e.examCode ? <span className="text-[#5A7280]"> · {e.examCode}</span> : ""}</td>
                    <td className="py-1.5 text-[#5A7280]">{fmt(e.submittedAt)}</td>
                    <td className="py-1.5 text-right tabular-nums">{e.score}%{e.rawScore !== e.score ? <span className="text-[10px] text-[#5A7280]">{t("arpt.raw", { n: e.rawScore })}</span> : ""}</td>
                    <td className="py-1.5 text-center font-semibold">{e.letter ?? "—"}</td>
                    <td className="py-1.5 text-center"><span className={e.passed ? "font-semibold text-[#16A34A]" : "font-semibold text-[#DC2626]"}>{e.passed ? t("common.pass") : t("common.fail")}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Attendance */}
          <h2 className="mt-7 text-sm font-bold">{t("arpt.attendance")}</h2>
          <p className="mt-1 text-sm text-[#5A7280]">
            {t("arpt.attendanceLine", { registered: d.attendance.registered, sat: d.attendance.sat, checkedIn: d.attendance.checkedIn })}{d.attendance.late ? t("arpt.lateSuffix", { n: d.attendance.late }) : ""}.
          </p>

          {/* Certificates */}
          {d.certificates.length > 0 && (
            <>
              <h2 className="mt-7 flex items-center gap-2 text-sm font-bold"><Award className="h-4 w-4 text-[#c6ff34]" /> {t("arpt.certificates")}</h2>
              <ul className="mt-2 space-y-1 text-sm">
                {d.certificates.map((c) => (
                  <li key={c.certNumber} className="flex items-center justify-between border-b border-[#EDF1F3] py-1 last:border-0">
                    <span>{c.examTitle} <span className="font-mono text-xs text-[#5A7280]">{c.certNumber}</span></span>
                    <span className="tabular-nums text-[#5A7280]">{c.score}% · {fmt(c.issuedAt)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <p className="mt-8 border-t border-[#E2E8EC] pt-3 text-[10px] text-[#94A3AB]">{t("arpt.footer", { org: d.org })}</p>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><span className="block text-[10px] uppercase tracking-wide text-[#94A3AB]">{label}</span><span className="block font-medium">{value}</span></div>;
}
function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-lg bg-[#F4F7F8] p-2.5 text-center">
      <p className="text-lg font-extrabold tabular-nums" style={tone ? { color: tone } : undefined}>{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-[#5A7280]">{label}</p>
    </div>
  );
}
