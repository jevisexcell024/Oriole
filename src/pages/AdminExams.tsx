import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus, FileText, Loader2, Trash2, AlertTriangle, Bell,
  ArrowUpRight, Clock, CalendarClock, GraduationCap, ClipboardCheck, BookOpen, Library,
} from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { SegmentDonut } from "@/components/Charts";
import { api } from "@/lib/api";
import { useT, type TFn } from "@/lib/i18n";
import type { Exam } from "@shared/types";

/* ── Brand palette — three solid colors ─────────────────────────────────────── */
const C = {
  lime:  "#c6ff34",   // positive / highlights / CTA
  pink:  "#fe3bed",   // attention / alerts / warnings
  white: "#ffffff",   // neutral secondary data
};
const DARK = "#111110";

/* ── Fonts — matches the rest of the admin shell ─────────────────────────────── */
const DISPLAY = "'Space Grotesk', 'Segoe UI', sans-serif";
const SANS    = "'DM Sans', 'Segoe UI', sans-serif";

const STATUS_KEY: Record<string, string> = { published: "aex.statusPublished", draft: "aex.statusDraft" };

interface ExamRow {
  id: string; title: string; code: string; status: string; className: string | null;
  scheduledStart: string | null; durationMinutes: number; marks: number; questionCount: number; type: string;
  subject: string | null; coverImage: string | null;
}
interface Overview {
  cards: { totalExams: number; totalStudents: number; certified: number; upcoming: number; reviewPct: number; pendingReviews: number };
  subjectsEnroll: { subject: string; count: number; pct: number; color: string }[];
  totalEnroll: number;
  questionPattern: { mcq: number; written: number; viva: number };
  subjectScores: { subject: string; score: number }[];
  exams: ExamRow[];
}

const fmtDur = (m: number, t: TFn) => (m >= 60 ? t(m >= 120 ? "aex.durHrs" : "aex.durHr", { n: Math.round((m / 60) * 10) / 10 }) : t("aex.durMin", { m }));
const fmtWhen = (iso: string | null, t: TFn) => (iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : t("aex.notScheduled"));

export function AdminExams() {
  const t = useT();
  const navigate = useNavigate();
  const [data, setData] = useState<Overview | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<ExamRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = () => api.get<Overview>("/admin/exams-overview").then(setData).catch(() => setData(null));
  useEffect(() => { load(); }, []);

  const create = async () => {
    setCreating(true);
    try { const { exam } = await api.post<{ exam: Exam }>("/admin/exams", {}); navigate(`/admin/exams/${exam.id}`); }
    finally { setCreating(false); }
  };

  const remove = async () => {
    if (!confirm) return;
    setDeleting(true);
    try { await api.del(`/admin/exams/${confirm.id}`); setConfirm(null); load(); }
    finally { setDeleting(false); }
  };

  /* 3 most recent exams — scheduled first, then unscheduled */
  const recentExams = useMemo(() => {
    if (!data) return [];
    return [...data.exams]
      .sort((a, b) => {
        if (a.scheduledStart && b.scheduledStart) return b.scheduledStart.localeCompare(a.scheduledStart);
        if (a.scheduledStart) return -1;
        if (b.scheduledStart) return 1;
        return 0;
      })
      .slice(0, 3);
  }, [data]);

  return (
    <AdminShell wide>
      <div className="fade-in space-y-4" style={{ fontFamily: SANS }}>

        {/* ── Header ── */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl px-5 py-4"
          style={{ background: DARK }}>
          <div>
            <p style={{ fontFamily: DISPLAY, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#9FA096" }}>
              Oriole · Exams
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight" style={{ fontFamily: DISPLAY, color: "#ffffff" }}>
              {t("aex.title")}
            </h1>
            <p className="text-sm" style={{ color: "#9FA096", fontFamily: SANS }}>
              {new Date().toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full border"
              style={{ borderColor: "rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.08)", color: "#ffffff" }}>
              <Bell className="h-4 w-4" />
            </span>
            <button onClick={create} disabled={creating}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition hover:brightness-95 disabled:opacity-60"
              style={{ background: C.lime, color: DARK, fontFamily: DISPLAY }}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {t("aex.addNew")}
            </button>
          </div>
        </div>

        {!data ? (
          <div className="flex items-center gap-2 py-16 text-[var(--muted)]">
            <Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.55fr_1fr]">

            {/* ── Left column ── */}
            <div className="space-y-4">

              {/* Stat cards */}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label={t("aex.statTotalExams")}    value={data.cards.totalExams}        icon={BookOpen}      tint={C.lime}  sub={t("aex.examinations")} />
                <Stat label={t("aex.statTotalStudents")} value={data.cards.totalStudents}      icon={GraduationCap} tint={C.white} sub={t("aex.certifiedN", { n: data.cards.certified })} />
                <Stat label={t("aex.statUpcoming")}      value={data.cards.upcoming}           icon={CalendarClock} tint={C.lime}  sub={t("aex.scheduledSub")} />
                <Stat label={t("aex.statReviews")}       value={`${data.cards.reviewPct}%`}    icon={ClipboardCheck} tint={C.pink} sub={t("aex.needsReview")} />
              </div>

              {/* Scheduler strip */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-5 py-3.5">
                <p className="text-sm text-[var(--muted)]">{t("aex.schedHint")}</p>
                <button onClick={() => navigate("/admin/scheduler")} className="btn btn-outline h-9">
                  <CalendarClock className="h-4 w-4" /> {t("acal.openScheduler")}
                </button>
              </div>

              {/* ── Manage exams — 3 recent only ── */}
              <div className="card rounded-2xl p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="flex items-center gap-2 text-base font-bold" style={{ fontFamily: DISPLAY }}>
                    <BookOpen className="h-4 w-4" style={{ color: C.lime }} />
                    {t("aex.manageAll")}
                  </h2>
                  <button onClick={() => navigate("/admin/exams-library")}
                    className="flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--fg)] transition hover:bg-[var(--card-2)]"
                    style={{ fontFamily: DISPLAY }}>
                    <Library className="h-3.5 w-3.5" style={{ color: C.lime }} />
                    {t("aex.viewAll")}
                    <ArrowUpRight className="h-3.5 w-3.5" style={{ color: C.lime }} />
                  </button>
                </div>

                {recentExams.length === 0 ? (
                  <div className="mt-6 rounded-xl border border-dashed border-[var(--border)] py-12 text-center">
                    <FileText className="mx-auto h-7 w-7 text-[var(--muted)]" />
                    <p className="mt-2 text-sm text-[var(--muted)]">{t("aex.noExams")}</p>
                    <button onClick={create} disabled={creating}
                      className="mx-auto mt-3 inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold"
                      style={{ background: C.lime, color: DARK, fontFamily: DISPLAY }}>
                      <Plus className="h-4 w-4" /> {t("aex.addNew")}
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {recentExams.map((e) => (
                        <ExamCard key={e.id} exam={e} t={t} onDelete={() => setConfirm(e)} onCreate={create} creating={creating} onNavigate={navigate} />
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* ── Right column ── */}
            <div className="space-y-4">

              {/* Enrollment donut */}
              <div className="card rounded-2xl p-5">
                <h2 className="text-sm font-bold" style={{ fontFamily: DISPLAY }}>{t("aex.mostInterested")}</h2>
                <div className="mt-3 flex justify-center">
                  <EnrollDonut data={data.subjectsEnroll} total={data.totalEnroll} t={t} />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {data.subjectsEnroll.length === 0 && (
                    <p className="col-span-2 text-center text-xs text-[var(--muted)]">{t("aex.noEnrolments")}</p>
                  )}
                  {data.subjectsEnroll.map((s) => (
                    <div key={s.subject} className="flex items-center gap-2 text-xs">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                      <span className="truncate text-[var(--muted)]" style={{ fontFamily: SANS }}>{s.subject}</span>
                      <span className="ml-auto font-semibold" style={{ fontFamily: DISPLAY }}>{s.pct}%</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Question pattern */}
              <div className="card rounded-2xl p-5">
                <h2 className="text-sm font-bold" style={{ fontFamily: DISPLAY }}>{t("aex.questionPattern")}</h2>
                <div className="mt-3 flex items-center gap-5">
                  <SegmentDonut size={96} thickness={11}
                    segments={[
                      { value: data.questionPattern.mcq,     color: DARK   },
                      { value: data.questionPattern.written, color: C.pink },
                      { value: data.questionPattern.viva,    color: C.lime },
                    ]}
                    centerTop={t("aex.mcq")} centerMain={`${data.questionPattern.mcq}%`} />
                  <div className="flex flex-1 flex-col gap-2.5 text-xs">
                    {[
                      { c: DARK,   l: t("aex.mcq"),     v: data.questionPattern.mcq     },
                      { c: C.pink, l: t("aex.written"), v: data.questionPattern.written  },
                      { c: C.lime, l: t("aex.viva"),    v: data.questionPattern.viva     },
                    ].map((r) => (
                      <div key={r.l} className="flex items-center gap-2.5">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.c, border: r.c === DARK ? "1px solid rgba(255,255,255,0.15)" : "none" }} />
                        <span className="flex-1 text-[var(--muted)]" style={{ fontFamily: SANS }}>{r.l}</span>
                        <span className="font-semibold" style={{ fontFamily: DISPLAY }}>{r.v}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Subject-wise average score */}
              <div className="card rounded-2xl p-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold" style={{ fontFamily: DISPLAY }}>{t("aex.subjectAvg")}</h2>
                  <button onClick={() => navigate("/admin/analytics")} className="text-[var(--muted)] hover:text-[var(--fg)]">
                    <ArrowUpRight className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-2 flex justify-center"><Radar data={data.subjectScores} /></div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Delete confirmation ── */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !deleting && setConfirm(null)}>
          <div className="w-full max-w-md rounded-2xl bg-[var(--card)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: `${C.pink}20` }}>
                <AlertTriangle className="h-5 w-5" style={{ color: C.pink }} />
              </div>
              <h2 className="text-lg font-bold" style={{ fontFamily: DISPLAY }}>{t("aex.deleteTitle")}</h2>
            </div>
            <p className="mt-3 text-sm text-[var(--muted)]" style={{ fontFamily: SANS }}>
              {t("aex.deleteWarn", { title: confirm.title, n: confirm.questionCount })}
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button onClick={() => setConfirm(null)} disabled={deleting}
                className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--fg)]"
                style={{ fontFamily: SANS }}>
                {t("aex.cancel")}
              </button>
              <button onClick={remove} disabled={deleting}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: C.pink, fontFamily: DISPLAY }}>
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                {t("aex.delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}

/* ── Exam card ── */
function ExamCard({ exam: e, t, onDelete, onNavigate }: {
  exam: ExamRow; t: TFn; onDelete: () => void; onCreate: () => void; creating: boolean;
  onNavigate: (path: string) => void;
}) {
  return (
    <div className="group card flex flex-col overflow-hidden border transition hover:border-[var(--border-strong)]">
      {e.coverImage && <img src={e.coverImage} alt="" className="h-28 w-full object-cover" />}
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between">
          {e.coverImage
            ? <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={e.status === "published"
                  ? { background: DARK, color: "#ffffff", fontFamily: DISPLAY }
                  : { border: "1px solid var(--border)", color: "var(--muted)", fontFamily: DISPLAY }}>
                {t(STATUS_KEY[e.status] ?? e.status)}
              </span>
            : <span className="flex h-10 w-10 items-center justify-center rounded-xl"
                style={{ background: `${C.lime}18`, color: C.lime }}>
                <BookOpen className="h-5 w-5" />
              </span>}
          <div className="flex items-center gap-1.5">
            {!e.coverImage && (
              <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={e.status === "published"
                  ? { background: DARK, color: "#ffffff", fontFamily: DISPLAY }
                  : { border: "1px solid var(--border)", color: "var(--muted)", fontFamily: DISPLAY }}>
                {t(STATUS_KEY[e.status] ?? e.status)}
              </span>
            )}
            <button title={t("aex.deleteTitle")} onClick={onDelete}
              className="rounded-lg p-1.5 text-[var(--muted)] opacity-0 transition group-hover:opacity-100"
              style={{ ["--hover-bg" as string]: `${C.pink}20` }}
              onMouseEnter={(el) => (el.currentTarget.style.background = `${C.pink}20`)}
              onMouseLeave={(el) => (el.currentTarget.style.background = "transparent")}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <h3 className="mt-3 font-semibold leading-snug" style={{ fontFamily: DISPLAY }}>
          {e.title || t("aex.untitled")}
        </h3>
        <p className="mt-0.5 text-xs text-[var(--muted)]" style={{ fontFamily: SANS }}>
          {e.subject || e.code || t("acls.noCode")}{e.className ? ` · ${e.className}` : ""}
        </p>

        <div className="mt-3 space-y-1.5 text-[11px] text-[var(--muted)]" style={{ fontFamily: SANS }}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock className="h-3.5 w-3.5" style={{ color: C.lime }} />
              {fmtWhen(e.scheduledStart, t)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              {fmtDur(e.durationMinutes, t)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              {t("prac.questions", { n: e.questionCount })}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ClipboardCheck className="h-3.5 w-3.5" style={{ color: C.white }} />
              {t("aex.marksN", { n: e.marks })}
            </span>
          </div>
        </div>

        <div className="mt-auto pt-4">
          <button onClick={() => onNavigate(`/admin/exams/${e.id}`)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl py-2 text-sm font-semibold transition hover:brightness-95"
            style={{ background: C.lime, color: DARK, fontFamily: DISPLAY }}>
            {t("aex.viewMore")} <ArrowUpRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Stat card ── */
function Stat({ label, value, icon: Icon, tint, sub }: {
  label: string; value: number | string; icon: typeof Bell; tint: string; sub: string;
}) {
  return (
    <div className="card rounded-xl p-3.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-[var(--muted)]" style={{ fontFamily: SANS }}>{label}</span>
        <Icon className="h-4 w-4" style={{ color: tint }} />
      </div>
      <div className="mt-2 text-2xl font-semibold leading-none" style={{ fontFamily: DISPLAY }}>{value}</div>
      <div className="mt-1.5 text-[11px] text-[var(--muted)]" style={{ fontFamily: SANS }}>{sub}</div>
    </div>
  );
}

/* ── Enrollment donut (unchanged logic, font matched) ── */
function EnrollDonut({ data, total, t }: { data: { pct: number; color: string }[]; total: number; t: TFn }) {
  const r = 52, c = 2 * Math.PI * r, gap = 4;
  let offset = 0;
  const segs = data.filter((s) => s.pct > 0);
  return (
    <svg width="150" height="150" viewBox="0 0 150 150">
      <circle cx="75" cy="75" r={r} fill="none" stroke="var(--card-2)" strokeWidth="14" />
      {segs.map((s, i) => {
        const len = (s.pct / 100) * c;
        const dash = Math.max(0, len - gap);
        const el = (
          <circle key={i} cx="75" cy="75" r={r} fill="none" stroke={s.color} strokeWidth="14"
            strokeLinecap="round" strokeDasharray={`${dash} ${c - dash}`}
            strokeDashoffset={-offset} transform="rotate(-90 75 75)" />
        );
        offset += len;
        return el;
      })}
      <text x="75" y="70" textAnchor="middle" fill="var(--muted)" fontSize="10" fontFamily={SANS}>
        {t("aex.totalEnroll")}
      </text>
      <text x="75" y="88" textAnchor="middle" fill="var(--fg)" fontSize="22" fontWeight="700" fontFamily={DISPLAY}>
        {total}
      </text>
    </svg>
  );
}

/* ── Radar chart ── */
function Radar({ data }: { data: { subject: string; score: number }[] }) {
  const pts = data.length >= 3 ? data : [{ subject: "—", score: 0 }, { subject: "—", score: 0 }, { subject: "—", score: 0 }];
  const n = pts.length, cx = 130, cy = 120, R = 78;
  const at = (i: number, rad: number): [number, number] => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
  };
  const ringPoly = (ring: number) => pts.map((_, i) => at(i, R * ring).join(",")).join(" ");
  const dataPoly = pts.map((d, i) => at(i, R * (Math.min(100, d.score) / 100)).join(",")).join(" ");
  return (
    <svg width="260" height="230" viewBox="0 0 260 230">
      {[0.25, 0.5, 0.75, 1].map((ring) => (
        <polygon key={ring} points={ringPoly(ring)} fill="none" stroke="var(--border)" />
      ))}
      {pts.map((_, i) => {
        const [x, y] = at(i, R);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--border)" />;
      })}
      <polygon points={dataPoly} fill={C.lime} fillOpacity="0.2" stroke={C.lime} strokeWidth="1.5" />
      {pts.map((d, i) => {
        const [x, y] = at(i, R * (Math.min(100, d.score) / 100));
        return <circle key={i} cx={x} cy={y} r="3" fill={C.lime} />;
      })}
      {pts.map((d, i) => {
        const [x, y] = at(i, R + 14);
        return (
          <text key={i} x={x} y={y} textAnchor="middle" dominantBaseline="middle"
            fill="var(--muted)" fontSize="9" fontFamily={SANS}>
            {d.subject.length > 10 ? d.subject.slice(0, 9) + "…" : d.subject}
          </text>
        );
      })}
    </svg>
  );
}
