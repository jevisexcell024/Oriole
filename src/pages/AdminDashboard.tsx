import { useEffect, useState, type ReactNode, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus, Calendar, ArrowUpRight, AlertTriangle, Upload, UserPlus, FileText, Layers,
  ChevronRight, Users, Activity, Clock, Eye, Brain, BookOpen, Zap,
} from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, PieChart, Pie, Cell, CartesianGrid, XAxis, YAxis, Tooltip } from "recharts";
import { AdminShell } from "@/components/AdminShell";
import { api } from "@/lib/api";
import { useT, type TFn } from "@/lib/i18n";

/* ── Oriole palette ────────────────────────────────────────────────────────────
   Three solid brand colors, semantically assigned:
     lime  #c6ff34 → success, positive metrics, primary CTA
     pink  #fe3bed → attention, alerts, flags, warnings
     white #ffffff → neutral secondary data                                   */
const C = {
  lime:  "#c6ff34",
  pink:  "#fe3bed",
  white: "#ffffff",
};

/* Surfaces inherit from the CSS theme so light/dark toggle works everywhere. */
const V = {
  bg: "var(--bg)", fg: "var(--fg)", card: "var(--card)", muted: "var(--card-2)",
  mutedFg: "var(--muted)", border: "var(--border)",
};

/* Fonts — matches the rest of the admin shell exactly:
   Space Grotesk for headings / big numbers / labels
   DM Sans for body / prose / small copy                                      */
const DISPLAY = "'Space Grotesk', 'Segoe UI', sans-serif";
const SANS    = "'DM Sans', 'Segoe UI', sans-serif";

const HEALTH_COLORS = [C.lime, C.pink, C.white, C.lime];
const AVA = [C.pink, C.lime, C.pink, C.lime, C.pink, C.lime];

/* ── Data contract ──────────────────────────────────────────────────────────── */
interface LiveExam { examId: string; title: string; code: string; students: number; minutesLeft: number; startAt: string; endAt: string; flagged: number; }
interface Band { count: number; pct: number; }
interface SubjectStat { examId: string; title: string; code: string; attempts: number; avgScore: number; passRate: number; }
interface Dash {
  cards: { completionRate: number; completionGrowth: number; activeStudents: number; questions: number; examsToday: number };
  examActivity: { label: string; taken: number; created: number; passed: number }[];
  insights: { totalExams: number; completed: number; pendingReviews: number; failed: number; avgScore: number; passRate: number };
  live: { sessions: number; flagged: number };
  liveExams: LiveExam[];
  questionsPerf: { skipRate: number; mostSkippedCount: number; subject: string };
  proctoring: { cheatingDetected: number };
  resultOverview: { totalStudents: number; avgCgpa: number; cgpaTrend: number; bands: { top: Band; average: Band; fail: Band } };
  upcomingExams: { examId: string; subject: string; className: string; scheduledStart: string; durationMinutes: number; candidates: number; msLeft: number }[];
  recentResults: { attemptId: string; name: string; examTitle: string; submittedAt: string | null; status: string; score: number }[];
  health: { score: number; band: string; breakdown: { label: string; value: number; weight: number }[] };
  academicInsights: { weakest: SubjectStat[]; strongest: SubjectStat[] };
  predicted: { atRiskCount: number; assessedStudents: number; projectedPassRate: number | null; forecastCandidates: number; trend: number };
}

const fmtLeft = (ms: number) => { const m = Math.max(0, Math.round(ms / 60000)); if (m < 60) return `${m} min`; const h = Math.round(m / 60); return h < 48 ? `${h} hr` : `${Math.round(h / 24)} d`; };
const ago = (iso: string | null, t: TFn) => { if (!iso) return ""; const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return t("adash.justNow"); const m = Math.round(s / 60); if (m < 60) return t("inbox.mAgo", { n: m }); const h = Math.round(m / 60); return h < 24 ? t("inbox.hAgo", { n: h }) : t("inbox.dAgo", { n: Math.round(h / 24) }); };
const ini = (n: string) => n.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

// Server-provided health band/breakdown labels are stable English strings —
// map them through translations when recognized, falling back to the raw
// string for any label the server introduces later that isn't mapped yet.
const HEALTH_BAND_KEY: Record<string, string> = { "Healthy": "adash.healthy", "Fair": "adash.fair", "Needs attention": "adash.needsAttention" };
const HEALTH_BREAKDOWN_KEY: Record<string, string> = { "Pass rate": "adash.bPassRate", "Integrity": "adash.bIntegrity", "Grading throughput": "adash.bGrading", "Completion": "adash.bCompletion" };

/* ── Primitives ─────────────────────────────────────────────────────────────── */
function Card({ children, className = "", style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={`rounded-2xl border p-5 ${className}`}
      style={{ backgroundColor: V.card, borderColor: V.border, fontFamily: SANS, ...style }}>
      {children}
    </div>
  );
}

/* eye label — uppercase tracking, Space Grotesk */
const eye: CSSProperties = { fontFamily: DISPLAY, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: V.mutedFg };
/* recharts tooltip */
const tip: CSSProperties = { backgroundColor: V.card, border: "1px solid var(--border)", borderRadius: 10, fontFamily: SANS, fontSize: 11, color: V.fg };

function StatCard({ label, value, sub, subUp, accent, live, warn }:
  { label: string; value: string; sub: string; subUp?: boolean; accent: string; live?: boolean; warn?: boolean }) {
  const t = useT();
  return (
    <Card className="relative col-span-1">
      <div className="absolute right-4 top-4">
        {live
          ? <span className="inline-flex items-center gap-1.5" style={{ fontFamily: DISPLAY, fontSize: 10, color: C.lime }}>
              <span className="h-2 w-2 rounded-full" style={{ background: C.lime, animation: "pulse 1.5s infinite" }} />{t("adash.liveNow")}
            </span>
          : warn
          ? <AlertTriangle className="h-4 w-4" style={{ color: C.pink }} />
          : subUp !== undefined
          ? <ArrowUpRight className="h-4 w-4" style={{ color: subUp ? C.lime : C.pink }} />
          : null}
      </div>
      <div style={eye}>{label}</div>
      <div className="mt-2" style={{ fontFamily: DISPLAY, fontSize: "2.75rem", lineHeight: 1, fontWeight: 700, color: accent }}>{value}</div>
      <div className="mt-2.5 text-xs" style={{ fontFamily: SANS, color: V.mutedFg }}>{sub}</div>
    </Card>
  );
}

function Trend({ data, series, height = 160 }:
  { data: Record<string, string | number>[]; series: { key: string; color: string; id: string }[]; height?: number }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: -22 }}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.id} id={s.id} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.22} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.15)" vertical={false} />
          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "var(--muted)", fontFamily: SANS }} />
          <YAxis axisLine={false} tickLine={false} width={34} tick={{ fontSize: 10, fill: "var(--muted)", fontFamily: SANS }} />
          <Tooltip contentStyle={tip} labelStyle={{ color: "var(--muted)", fontFamily: SANS }} itemStyle={{ fontFamily: SANS }} />
          {series.map((s) => (
            <Area key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} fill={`url(#${s.id})`} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5" style={{ fontFamily: SANS, fontSize: 11, color: V.mutedFg }}>
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />{label}
    </span>
  );
}

/* ── Main ───────────────────────────────────────────────────────────────────── */
export function AdminDashboard() {
  const navigate = useNavigate();
  const t = useT();
  const [d, setD] = useState<Dash | null>(null);
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    let inFlight = false, cancelled = false;
    const load = async () => {
      if (inFlight) return; inFlight = true;
      try { const data = await api.get<Dash>("/admin/dashboard"); if (!cancelled) { setD(data); setStalled(false); } }
      catch { if (!cancelled) setStalled(true); }
      finally { inFlight = false; }
    };
    load();
    const id = setInterval(load, 10000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const header = (
    <div className="flex items-center justify-between pb-5">
      <div>
        <div style={eye}>{t("adash.dashboardEyebrow")}</div>
        <h1 className="mt-1 text-xl font-semibold" style={{ fontFamily: DISPLAY, color: V.fg }}>{t("adash.overview")}</h1>
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden items-center gap-2 rounded-xl border px-4 py-2 sm:inline-flex"
          style={{ background: V.card, borderColor: V.border, color: V.mutedFg, fontFamily: SANS, fontSize: 12 }}>
          <Calendar className="h-3.5 w-3.5" />{new Date().toLocaleString(undefined, { month: "short", year: "numeric" })}
        </span>
        <button onClick={() => navigate("/admin/exams")}
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition hover:brightness-95"
          style={{ background: C.lime, color: "#111110", fontFamily: DISPLAY }}>
          <Plus className="h-4 w-4" />{t("adash.createExam")}
        </button>
      </div>
    </div>
  );

  if (!d) {
    return (
      <AdminShell>
        {header}
        <div className="py-24 text-center" style={{ fontFamily: SANS, fontSize: 13, color: V.mutedFg }}>
          {stalled ? t("adash.reconnecting") : t("adash.loadingDashboard")}
        </div>
      </AdminShell>
    );
  }

  const quick = [
    { icon: Plus,     label: t("adash.createExam"),      color: C.lime,  to: "/admin/exams"         },
    { icon: Upload,   label: t("adash.importQuestions"), color: C.pink,  to: "/admin/exams-library" },
    { icon: UserPlus, label: t("adash.inviteCandidates"), color: C.white, to: "/admin/candidates"    },
    { icon: FileText, label: t("adash.generateReport"),   color: C.lime,  to: "/admin/reports"       },
    { icon: Layers,   label: t("adash.manageClasses"),    color: C.pink,  to: "/admin/classes"       },
  ];

  const donut = [
    { name: "Top",     value: d.resultOverview.bands.top.count,     color: C.lime,  label: t("adash.topPerformers") },
    { name: "Average", value: d.resultOverview.bands.average.count, color: C.white, label: t("adash.average")       },
    { name: "Below",   value: d.resultOverview.bands.fail.count,    color: C.pink,  label: t("adash.belowAverage")  },
  ];

  const liveMetrics = [
    { icon: Users,    label: t("adash.activeSessions"),   value: d.live.sessions,        color: C.lime  },
    { icon: Activity, label: t("adash.flaggedIncidents"), value: d.live.flagged,         color: C.pink  },
    { icon: Clock,    label: t("adash.upcomingLabel"),    value: d.upcomingExams.length, color: C.white },
  ];

  const proctorStats = [
    { label: t("adash.detected"), value: d.proctoring.cheatingDetected, color: C.pink },
    { label: t("adash.flagged"),  value: d.live.flagged,                 color: C.pink },
    { label: t("adash.inReview"), value: d.insights.pendingReviews,      color: C.lime },
  ];

  return (
    <AdminShell>
      {header}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4" style={{ fontFamily: SANS, color: V.fg }}>

        {/* ── Row 1 — stat cards ── */}
        <StatCard label={t("adash.totalCandidates")} value={String(d.cards.activeStudents)}
          sub={`${d.cards.completionGrowth >= 0 ? "+" : ""}${t("adash.completionPct", { n: d.cards.completionGrowth })}`}
          accent={C.lime} subUp={d.cards.completionGrowth >= 0} />
        <StatCard label={t("adash.activeSessions")} value={String(d.live.sessions)}
          sub={t("adash.examsInProgress", { n: d.liveExams.length })}
          accent={C.white} live />
        <StatCard label={t("adash.passRate")} value={`${d.insights.passRate}%`}
          sub={t("adash.completedAvgScore", { n: d.insights.completed, avg: d.insights.avgScore })}
          accent={C.lime} subUp={d.insights.passRate >= 50} />
        <StatCard label={t("adash.pendingReviewsLabel")} value={String(d.insights.pendingReviews)}
          sub={t("adash.integrityFlags", { n: d.proctoring.cheatingDetected })}
          accent={C.pink} warn />

        {/* ── Row 2 — upcoming + quick actions ── */}
        <Card className="col-span-1 md:col-span-2 xl:col-span-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold" style={{ fontFamily: DISPLAY, color: V.fg }}>{t("adash.upcomingExams")}</h2>
            <button onClick={() => navigate("/admin/scheduler")} className="rounded-lg px-3 py-1.5 text-xs font-medium transition hover:brightness-110"
              style={{ background: `${C.lime}18`, color: C.lime, fontFamily: SANS }}>+ {t("adash.addExam")}</button>
          </div>
          {d.upcomingExams.length === 0 ? (
            <div className="flex flex-col items-center py-12">
              <div className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: V.muted }}>
                <Calendar className="h-5 w-5" style={{ color: V.mutedFg }} />
              </div>
              <p className="mt-3 text-sm" style={{ color: V.mutedFg }}>{t("adash.noUpcoming")}</p>
              <button onClick={() => navigate("/admin/scheduler")} className="mt-3 rounded-xl px-4 py-2 text-xs font-semibold"
                style={{ background: C.lime, color: "#111110", fontFamily: DISPLAY }}>{t("adash.scheduleExam")}</button>
            </div>
          ) : (
            <div className="mt-4">
              <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-2 border-b pb-2" style={{ borderColor: V.border, ...eye }}>
                <span>{t("adash.colSubject")}</span><span>{t("adash.colClass")}</span><span>{t("adash.colCandidates")}</span><span>{t("adash.colTimeLeft")}</span>
              </div>
              {d.upcomingExams.map((u) => (
                <button key={u.examId + u.scheduledStart} onClick={() => navigate("/admin/scheduler")}
                  className="grid w-full grid-cols-[2fr_1fr_1fr_1fr] items-center gap-2 rounded-lg px-1 py-2.5 text-left text-xs transition hover:bg-white/[0.03]"
                  style={{ color: V.fg, fontFamily: SANS }}>
                  <span className="truncate font-medium">{u.subject}</span>
                  <span style={{ color: V.mutedFg }}>{u.className}</span>
                  <span style={{ fontFamily: DISPLAY }}>{u.candidates}</span>
                  <span style={{ fontFamily: DISPLAY, color: C.lime }}>{fmtLeft(u.msLeft)}</span>
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card className="col-span-1 md:col-span-2 xl:col-span-1">
          <h2 className="mb-4 text-sm font-semibold" style={{ fontFamily: DISPLAY, color: V.fg }}>{t("adash.quickActions")}</h2>
          <div className="flex flex-col gap-1.5">
            {quick.map((q) => (
              <button key={q.label} onClick={() => navigate(q.to)}
                className="group flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:brightness-125"
                style={{ background: V.muted }}>
                <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: `${q.color}22` }}>
                  <q.icon className="h-4 w-4" style={{ color: q.color }} />
                </span>
                <span className="flex-1 text-sm" style={{ color: V.fg, fontFamily: SANS }}>{q.label}</span>
                <ChevronRight className="h-4 w-4 opacity-0 transition group-hover:opacity-100" style={{ color: V.mutedFg }} />
              </button>
            ))}
          </div>
        </Card>

        {/* ── Row 3 — live monitoring + exam activity + performance donut ── */}
        <Card className="col-span-1">
          <div className="flex items-center justify-between">
            <h2 className="inline-flex items-center gap-2 text-sm font-semibold" style={{ fontFamily: DISPLAY, color: V.fg }}>
              <span className="h-2 w-2 rounded-full" style={{ background: C.lime, animation: "pulse 1.5s infinite" }} />
              {t("adash.liveMonitoring")}
            </h2>
            <button onClick={() => navigate("/admin/live")} className="text-xs transition hover:text-[var(--fg)]"
              style={{ fontFamily: SANS, color: V.mutedFg }}>{t("adash.openLiveMonitor")} →</button>
          </div>
          <div className="mt-3 space-y-2">
            {liveMetrics.map((m) => (
              <div key={m.label} className="flex items-center gap-3 rounded-xl p-3" style={{ background: V.muted }}>
                <m.icon className="h-4 w-4" style={{ color: m.color }} />
                <span className="flex-1 text-xs" style={{ color: V.mutedFg, fontFamily: SANS }}>{m.label}</span>
                <span style={{ fontFamily: DISPLAY, fontSize: 15, fontWeight: 600, color: V.fg }}>{m.value}</span>
              </div>
            ))}
          </div>
          {d.live.sessions === 0 && (
            <div className="mt-3 flex flex-col items-center rounded-xl border border-dashed py-6" style={{ borderColor: V.border }}>
              <Eye className="h-5 w-5" style={{ color: V.mutedFg }} />
              <p className="mt-2 text-xs" style={{ color: V.mutedFg, fontFamily: SANS }}>{t("adash.noLive")}</p>
            </div>
          )}
        </Card>

        <Card className="col-span-1 md:col-span-2 xl:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold" style={{ fontFamily: DISPLAY, color: V.fg }}>{t("adash.examActivityTitle")}</h2>
            <div className="flex gap-3"><LegendDot color={C.lime} label={t("adash.taken")} /><LegendDot color={C.pink} label={t("adash.passed")} /></div>
          </div>
          <p className="mb-1 mt-0.5 text-xs" style={{ fontFamily: SANS, color: V.mutedFg }}>
            {t("adash.avgPassingRate")} <span style={{ color: V.fg, fontFamily: DISPLAY }}>{d.insights.passRate}%</span>
          </p>
          <Trend data={d.examActivity} series={[
            { key: "taken",  color: C.lime, id: "gLime" },
            { key: "passed", color: C.pink, id: "gPink" },
          ]} />
        </Card>

        <Card className="col-span-1">
          <h2 className="text-sm font-semibold" style={{ fontFamily: DISPLAY, color: V.fg }}>{t("adash.performanceTitle")}</h2>
          <p className="mt-0.5 text-xs" style={{ fontFamily: SANS, color: V.mutedFg }}>
            {t("adash.avgCgpa")} <span style={{ color: V.fg, fontFamily: DISPLAY }}>{d.resultOverview.avgCgpa}</span>{" "}
            <span style={{ color: d.resultOverview.cgpaTrend >= 0 ? C.lime : C.pink, fontFamily: DISPLAY }}>
              {d.resultOverview.cgpaTrend >= 0 ? "+" : ""}{d.resultOverview.cgpaTrend}%
            </span>
          </p>
          <div className="relative" style={{ height: 110 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={donut} dataKey="value" innerRadius={32} outerRadius={50} paddingAngle={3} stroke="none">
                  {donut.map((s) => <Cell key={s.name} fill={s.color} />)}
                </Pie>
                <Tooltip contentStyle={tip} itemStyle={{ fontFamily: SANS }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span style={{ fontFamily: DISPLAY, fontSize: 18, fontWeight: 700, color: V.fg }}>{d.resultOverview.totalStudents}</span>
              <span style={{ fontFamily: SANS, fontSize: 10, color: V.mutedFg }}>{t("adash.studentsUnit")}</span>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {donut.map((s) => (
              <div key={s.name} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
                <span className="flex-1 text-xs" style={{ color: V.mutedFg, fontFamily: SANS }}>{s.label}</span>
                <span style={{ fontFamily: DISPLAY, fontSize: 11, color: V.fg }}>{s.value}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* ── Row 4 — completion trends + question analytics + institution health ── */}
        <Card className="col-span-1 md:col-span-2 xl:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold" style={{ fontFamily: DISPLAY, color: V.fg }}>{t("adash.completionTrends")}</h2>
            <div className="flex gap-3"><LegendDot color={C.lime} label={t("adash.taken")} /><LegendDot color={C.white} label={t("adash.created")} /></div>
          </div>
          <p className="mb-1 mt-0.5 text-xs" style={{ fontFamily: SANS, color: V.mutedFg }}>{t("adash.takenVsCreated")}</p>
          <Trend data={d.examActivity} series={[
            { key: "taken",   color: C.lime,  id: "gCyanL" },
            { key: "created", color: C.white, id: "gWhite" },
          ]} />
        </Card>

        <Card className="col-span-1">
          <h2 className="mb-5 text-sm font-semibold" style={{ fontFamily: DISPLAY, color: V.fg }}>{t("adash.questionAnalytics")}</h2>
          <p className="text-xs" style={{ color: V.mutedFg, fontFamily: SANS }}>{t("adash.skipRateDesc")}</p>
          <div style={{ fontFamily: DISPLAY, fontSize: "3rem", lineHeight: 1, fontWeight: 700, color: d.questionsPerf.skipRate ? C.pink : V.mutedFg }}>
            {d.questionsPerf.skipRate}%
          </div>
          <div className="my-4 h-px" style={{ background: V.border }} />
          <div className="flex items-center justify-between py-1 text-xs">
            <span style={{ color: V.mutedFg, fontFamily: SANS }}>{t("adash.mostSkipped")}</span>
            <span className="truncate pl-2" style={{ fontFamily: DISPLAY, color: V.fg }}>{d.questionsPerf.subject}</span>
          </div>
          <div className="flex items-center justify-between py-1 text-xs">
            <span style={{ color: V.mutedFg, fontFamily: SANS }}>{t("adash.questionBank")}</span>
            <span style={{ fontFamily: DISPLAY, color: C.lime }}>{d.cards.questions}</span>
          </div>
        </Card>

        <Card className="col-span-1">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold" style={{ fontFamily: DISPLAY, color: V.fg }}>{t("adash.institutionHealth")}</h2>
            <span className="rounded-md px-2 py-0.5" style={{ background: `${C.pink}25`, color: C.pink, fontFamily: SANS, fontSize: 11 }}>
              {HEALTH_BAND_KEY[d.health.band] ? t(HEALTH_BAND_KEY[d.health.band]) : d.health.band}
            </span>
          </div>
          <div className="mt-1 flex items-baseline gap-1">
            <span style={{ fontFamily: DISPLAY, fontSize: "2.5rem", lineHeight: 1, fontWeight: 700, color: C.lime }}>{d.health.score}</span>
            <span style={{ fontFamily: DISPLAY, fontSize: 16, color: V.mutedFg }}>/100</span>
          </div>
          <div className="mt-4 space-y-3">
            {d.health.breakdown.map((b, i) => (
              <div key={b.label}>
                <div className="flex items-center justify-between text-xs">
                  <span style={{ color: V.mutedFg, fontFamily: SANS }}>{HEALTH_BREAKDOWN_KEY[b.label] ? t(HEALTH_BREAKDOWN_KEY[b.label]) : b.label}</span>
                  <span style={{ fontFamily: DISPLAY, color: HEALTH_COLORS[i % HEALTH_COLORS.length] }}>{b.value}%</span>
                </div>
                <div className="mt-1 h-1 rounded-full" style={{ background: V.muted }}>
                  <div className="h-1 rounded-full"
                    style={{ width: `${b.value}%`, background: HEALTH_COLORS[i % HEALTH_COLORS.length], transition: "width 0.6s ease" }} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* ── Row 5 — AI proctoring + academic insights + needs attention ── */}
        <Card className="col-span-1">
          <h2 className="mb-3 inline-flex items-center gap-2 text-sm font-semibold" style={{ fontFamily: DISPLAY, color: V.fg }}>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: `${C.lime}22` }}>
              <Brain className="h-4 w-4" style={{ color: C.lime }} />
            </span>
            {t("adash.aiProctoringTitle")}
          </h2>
          <div className="grid grid-cols-3 gap-2">
            {proctorStats.map((s) => (
              <div key={s.label} className="flex flex-col items-center rounded-xl py-3" style={{ background: V.muted }}>
                <span style={{ fontFamily: DISPLAY, fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</span>
                <span style={{ fontFamily: SANS, fontSize: 10, color: V.mutedFg }}>{s.label}</span>
              </div>
            ))}
          </div>
          <button onClick={() => navigate("/admin/violations")}
            className="mt-3 w-full rounded-xl py-2 text-xs transition hover:brightness-125"
            style={{ background: V.muted, color: V.mutedFg, fontFamily: SANS }}>
            {t("adash.reviewFlagged")} →
          </button>
        </Card>

        <Card className="col-span-1 md:col-span-2 xl:col-span-2">
          <h2 className="mb-4 text-sm font-semibold" style={{ fontFamily: DISPLAY, color: V.fg }}>{t("adash.academicInsights")}</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl p-4" style={{ background: V.muted }}>
              <p className="text-xs" style={{ color: V.mutedFg, fontFamily: SANS }}>{t("adash.assessedStudents")}</p>
              <p style={{ fontFamily: DISPLAY, fontSize: 28, fontWeight: 700, color: V.fg }}>
                {d.predicted.assessedStudents}
                <span style={{ fontSize: 16, color: V.mutedFg }}>/{d.cards.activeStudents}</span>
              </p>
            </div>
            <div className="rounded-xl p-4" style={{ background: V.muted }}>
              <p className="text-xs" style={{ color: V.mutedFg, fontFamily: SANS }}>{t("adash.cohortProgress")}</p>
              <div className="mt-2 h-1.5 rounded-full" style={{ background: V.bg }}>
                <div className="h-1.5 rounded-full" style={{ width: `${d.cards.completionRate}%`, background: C.lime }} />
              </div>
              <p className="mt-1.5 text-xs" style={{ fontFamily: DISPLAY, color: C.lime }}>{t("adash.pctComplete", { n: d.cards.completionRate })}</p>
            </div>
          </div>
          <p className="mb-2 mt-4" style={eye}>{t("adash.weakestSubjects")}</p>
          <div className="space-y-2">
            {d.academicInsights.weakest.length === 0 && (
              <p className="text-xs" style={{ color: V.mutedFg, fontFamily: SANS }}>{t("adash.noGraded")}</p>
            )}
            {d.academicInsights.weakest.slice(0, 3).map((s) => (
              <div key={s.examId} className="flex items-center gap-3 rounded-xl p-3" style={{ background: V.muted }}>
                <BookOpen className="h-4 w-4" style={{ color: C.pink }} />
                <span className="flex-1 truncate text-xs" style={{ color: V.fg, fontFamily: SANS }}>{s.title}</span>
                <div className="h-1.5 w-24 rounded-full" style={{ background: V.bg }}>
                  <div className="h-1.5 rounded-full" style={{ width: `${s.passRate}%`, background: C.pink }} />
                </div>
                <span style={{ fontFamily: DISPLAY, fontSize: 11, color: C.pink }}>{s.passRate}%</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="col-span-1">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold" style={{ fontFamily: DISPLAY, color: V.fg }}>{t("adash.needsAttentionTitle")}</h2>
            <span className="rounded-full px-2 py-0.5" style={{ background: `${C.pink}25`, color: C.pink, fontFamily: DISPLAY, fontSize: 11 }}>
              {d.insights.pendingReviews}
            </span>
          </div>
          {d.insights.pendingReviews > 0 && (
            <button onClick={() => navigate("/admin/grading")}
              className="mt-3 flex w-full items-center gap-3 rounded-xl border p-3.5 text-left transition hover:opacity-80"
              style={{ background: `${C.pink}12`, borderColor: `${C.pink}30` }}>
              <span className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: `${C.pink}25` }}>
                <AlertTriangle className="h-4 w-4" style={{ color: C.pink }} />
              </span>
              <span className="flex-1 text-sm" style={{ color: V.fg, fontFamily: SANS }}>{t("adash.notifGrading", { n: d.insights.pendingReviews })}</span>
              <ChevronRight className="h-4 w-4" style={{ color: C.pink }} />
            </button>
          )}
          <div className="mt-3 flex flex-col items-center rounded-xl border border-dashed py-8" style={{ borderColor: V.border }}>
            <Zap className="h-5 w-5" style={{ color: V.mutedFg }} />
            <p className="mt-2 text-xs" style={{ color: V.mutedFg, fontFamily: SANS }}>
              {d.insights.pendingReviews > 0 ? t("adash.otherTasksClear") : t("adash.allTasksClear")}
            </p>
          </div>
        </Card>

        {/* ── Row 6 — recent activity ── */}
        <Card className="col-span-1 md:col-span-2 xl:col-span-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold" style={{ fontFamily: DISPLAY, color: V.fg }}>{t("adash.recentActivity")}</h2>
            <button onClick={() => navigate("/admin/results")} className="text-xs transition hover:text-[var(--fg)]"
              style={{ fontFamily: SANS, color: V.mutedFg }}>{t("adash.viewAll")} →</button>
          </div>
          {d.recentResults.length === 0 ? (
            <p className="py-6 text-center text-xs" style={{ color: V.mutedFg, fontFamily: SANS }}>{t("adash.noRecent")}</p>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
              {d.recentResults.slice(0, 6).map((r, i) => (
                <button key={r.attemptId} onClick={() => navigate(`/admin/attempts/${r.attemptId}`)}
                  className="flex items-center gap-3 rounded-xl p-3 text-left transition hover:brightness-125"
                  style={{ background: V.muted }}>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                    style={{ background: AVA[i % AVA.length], color: "#111110" }}>
                    {ini(r.name)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium" style={{ color: V.fg, fontFamily: SANS }}>{r.name}</span>
                    <span className="block truncate text-[10px]" style={{ fontFamily: SANS, color: V.mutedFg }}>
                      {r.status} · {ago(r.submittedAt, t)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </Card>

      </div>
    </AdminShell>
  );
}
