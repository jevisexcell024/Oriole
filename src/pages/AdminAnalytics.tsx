import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Download, TrendingUp, TrendingDown, Minus, Loader2, AlertTriangle, Image as ImageIcon, FileCode } from "lucide-react";
import { downloadPng, downloadSvg } from "@/lib/exportChart";
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { AdminShell } from "@/components/AdminShell";
import { api } from "@/lib/api";
import { useT, type TFn } from "@/lib/i18n";

// ── Design tokens ────────────────────────────────────────────────────────
const LIME = "#c8f53d";
const CYAN = "#22d3ee";
const PURPLE = "#c084fc";
const ORANGE = "#fb923c";
const GREEN = "#4ade80";
const ROSE = "#f43f5e";
const CARD = "#141414";
const INNER = "#1c1c1c";
const DIM = "#5a5a6a";
const BG = "#0a0a0a";
const SUBJECT_COLORS = [LIME, CYAN, PURPLE, ORANGE, GREEN, ROSE];

interface Cards {
  avgScore: number; avgScoreDelta: number | null;
  totalExams: number; totalExamsDelta: number | null;
  passRate: number; passRateDelta: number | null;
  completionRate: number; integrityScore: number;
  highest: number; lowest: number; avgMin: number; top: { name: string; score: number };
}
interface Analytics {
  cards: Cards;
  subjectTrend: Record<string, string | number | null>[];
  topSubjects: string[];
  subjectBars: { subject: string; avgScore: number; attempts: number }[];
  questionTypeAnalysis: { type: string; score: number; volume: number }[];
  questionDifficulty: { tier: string; share: number; correct: number }[];
  accuracy: number;
  paceBuckets: { fast: number; normal: number; slow: number };
  weeklyActivity: { week: string; attempts: number }[];
  monthlyPerformance: { month: string; score: number | null }[];
  scoreDistribution: { label: string; count: number; pct: number }[];
  demographics: { byGender: DemoGroup[]; byDepartment: DemoGroup[] };
}
interface DemoGroup { label: string; count: number; avgScore: number; passRate: number; }

// GET /api/admin/analytics/cohorts — real cohort/term comparisons and at-risk
// flagging, already computed server-side but with no frontend consumer at
// all until now. Fetched separately from analytics-overview so a slow
// cohorts computation never blocks the rest of the dashboard from rendering.
interface CohortStat { id: string; name: string; members: number; attempts: number; avgScore: number | null; passRate: number | null; }
interface TermStat { label: string; attempts: number; avgScore: number | null; passRate: number | null; }
interface AtRiskRow { candidateId: string; name: string; attempts: number; avgScore: number; lastScore: number; fails: number; level: "high" | "medium"; reasons: string[]; }
interface CohortsResp { cohorts: CohortStat[]; terms: TermStat[]; atRisk: AtRiskRow[]; }

function difficultyLabel(score: number) { return score >= 80 ? "Strong" : score >= 70 ? "Good" : "Needs work"; }

export function AdminAnalytics() {
  const t = useT();
  const navigate = useNavigate();
  const [d, setD] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cohorts, setCohorts] = useState<CohortsResp | null>(null);
  const scoreChartRef = useRef<HTMLDivElement>(null);

  useEffect(() => { api.get<Analytics>("/admin/analytics-overview").then(setD).catch((e) => setError((e as Error).message)); }, []);
  useEffect(() => { api.get<CohortsResp>("/admin/analytics/cohorts").then(setCohorts).catch(() => {}); }, []);

  if (error) return <AdminShell wide><p className="p-6 text-sm text-rose-400">{error}</p></AdminShell>;
  if (!d) return <AdminShell wide><div className="flex items-center gap-2 p-8 text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}</div></AdminShell>;

  return (
    <AdminShell wide>
      <div className="fade-in -m-4 sm:-m-6" style={{ minHeight: "100vh", backgroundColor: BG, fontFamily: "Inter, sans-serif", scrollbarWidth: "none" }}>
        {/* Header */}
        <div className="flex items-center justify-between" style={{ backgroundColor: CARD, padding: "16px 28px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <div>
            <p style={{ fontSize: 16, fontWeight: 700, color: "#f0f0f0" }}>{t("aan.title")}</p>
            <p style={{ fontSize: 11, color: DIM, marginTop: 2 }}>{t("aan.subtitle")}</p>
          </div>
          <button onClick={() => navigate("/admin/reports")} className="flex items-center gap-2 transition hover:opacity-80"
            style={{ backgroundColor: LIME, color: "#0a0a0a", fontSize: 12, fontWeight: 600, padding: "8px 16px", borderRadius: 8 }}>
            <Download className="h-3.5 w-3.5" /> {t("aan.exportReport")}
          </button>
        </div>

        {/* Row 1 — stat cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 2, marginTop: 2, height: 110 }}>
          <StatCard label={t("aan.stOverallScore")} value={`${d.cards.avgScore}%`} delta={d.cards.avgScoreDelta} note={t("aan.vsLastMonth")} color={LIME} />
          <StatCard label={t("aan.stTotalExams")} value={d.cards.totalExams} delta={d.cards.totalExamsDelta} note={t("aan.examsTakenNote")} color={CYAN} />
          <StatCard label={t("aan.stPassingScore")} value={`${d.cards.passRate}%`} delta={d.cards.passRateDelta} note={t("aan.passRateNote")} color={LIME} />
          <StatCard label={t("aan.stCompletionRate")} value={`${d.cards.completionRate}%`} delta={null} note={t("aan.completionNote")} color={ORANGE} />
          <StatCard label={t("aan.stIntegrityScore")} value={`${d.cards.integrityScore}%`} delta={null} note={t("aan.integrityNote")} color={PURPLE} />
        </div>

        {/* Row 2 */}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 2, marginTop: 2 }}>
          <Panel>
            <SectionHead title={t("aan.perfOverTime")} sub={t("aan.perfOverTimeSub")} />
            {d.topSubjects.length === 0 ? <Empty t={t} /> : (
              <>
                <div style={{ height: 200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={d.subjectTrend} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                      <CartesianGrid stroke="rgba(255,255,255,0.03)" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="month" tick={{ fill: DIM, fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis domain={[0, 100]} tick={{ fill: DIM, fontSize: 10 }} axisLine={false} tickLine={false} />
                      <Tooltip content={<DarkTooltip />} />
                      {d.topSubjects.map((subj, i) => (
                        <Line key={subj} type="monotone" dataKey={subj} name={subj} stroke={SUBJECT_COLORS[i % SUBJECT_COLORS.length]} strokeWidth={1.5} dot={false} activeDot={{ r: 4 }} connectNulls />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-wrap" style={{ columnGap: 16, rowGap: 6, marginTop: 12 }}>
                  {d.topSubjects.map((subj, i) => (
                    <span key={subj} className="flex items-center gap-1.5">
                      <span style={{ width: 20, height: 2, background: SUBJECT_COLORS[i % SUBJECT_COLORS.length] }} />
                      <span style={{ fontSize: 10, color: DIM }}>{subj}</span>
                    </span>
                  ))}
                </div>
              </>
            )}
          </Panel>

          <Panel>
            <SectionHead title={t("aan.subjectPerf")} sub={t("aan.subjectPerfSub")} />
            {d.subjectBars.length === 0 ? <Empty t={t} /> : (
              <div className="flex flex-col" style={{ gap: 14 }}>
                {d.subjectBars.map((s, i) => <HBar key={s.subject} label={s.subject} score={s.avgScore} color={SUBJECT_COLORS[i % SUBJECT_COLORS.length]} />)}
              </div>
            )}
          </Panel>

          <Panel>
            <SectionHead title={t("aan.questionTypeAnalysis")} sub={t("aan.questionTypeSub")} />
            {d.questionTypeAnalysis.length === 0 ? <Empty t={t} /> : (
              <div className="flex flex-col" style={{ gap: 16 }}>
                {d.questionTypeAnalysis.map((q, i) => {
                  const color = SUBJECT_COLORS[i % SUBJECT_COLORS.length];
                  const dots = Math.round(q.score / 20);
                  return (
                    <div key={q.type}>
                      <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                        <span style={{ fontSize: 11, fontWeight: 500, color: "#d0d0d0" }}>{q.type}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color }}>{q.score}%</span>
                      </div>
                      <div style={{ height: 5, backgroundColor: INNER, borderRadius: 9999, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${q.score}%`, backgroundColor: color, borderRadius: 9999 }} />
                      </div>
                      <div className="flex items-center justify-between" style={{ marginTop: 6 }}>
                        <div className="flex" style={{ gap: 4 }}>
                          {Array.from({ length: 5 }).map((_, di) => <span key={di} style={{ width: 6, height: 6, borderRadius: "50%", background: di < dots ? color : "#242424" }} />)}
                        </div>
                        <span style={{ fontSize: 9, color: DIM }}>{difficultyLabel(q.score)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>

        {/* Row 3 */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.4fr", gap: 2, marginTop: 2 }}>
          <Panel>
            <SectionHead title={t("aan.questionDifficulty")} sub={t("aan.questionDifficultySub")} />
            {d.questionDifficulty.length === 0 ? <Empty t={t} /> : (
              <div className="flex flex-col" style={{ gap: 14 }}>
                {d.questionDifficulty.map((lvl, i) => {
                  const color = [LIME, ORANGE, ROSE][i] ?? DIM;
                  return (
                    <div key={lvl.tier}>
                      <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
                        <span className="flex items-center gap-2"><span style={{ width: 8, height: 8, borderRadius: "50%", background: color }} /><span style={{ fontSize: 11, fontWeight: 500, color: "#d0d0d0" }}>{lvl.tier}</span></span>
                        <span style={{ fontSize: 11, fontWeight: 700, color }}>{lvl.correct}%</span>
                      </div>
                      <div style={{ height: 4, backgroundColor: INNER, borderRadius: 9999, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${lvl.correct}%`, backgroundColor: color, opacity: 0.85, borderRadius: 9999 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>

          <Panel style={{ display: "flex", flexDirection: "column" }}>
            <SectionHead title={t("aan.accuracyPace")} sub={t("aan.accuracyPaceSub")} />
            <div className="flex flex-1 items-center" style={{ gap: 16 }}>
              <div className="relative shrink-0" style={{ width: 120, height: 120 }}>
                <ResponsiveContainer width={120} height={120}>
                  <PieChart>
                    <Pie data={[{ name: "acc", value: d.accuracy }, { name: "rest", value: 100 - d.accuracy }]} cx={55} cy={55} innerRadius={38} outerRadius={54} startAngle={90} endAngle={-270} strokeWidth={0} dataKey="value">
                      <Cell fill={LIME} /><Cell fill={INNER} />
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span style={{ fontSize: 18, fontWeight: 700, color: LIME }}>{d.accuracy}%</span>
                  <span style={{ fontSize: 8, textTransform: "uppercase", color: DIM }}>{t("aan.accuracyLabel")}</span>
                </div>
              </div>
              <div className="flex-1" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <PaceRow label={t("aan.paceFast")} count={d.paceBuckets.fast} color={LIME} />
                <PaceRow label={t("aan.paceNormal")} count={d.paceBuckets.normal} color={CYAN} />
                <PaceRow label={t("aan.paceSlow")} count={d.paceBuckets.slow} color={ORANGE} />
              </div>
            </div>
          </Panel>

          <Panel>
            <SectionHead title={t("aan.weeklyActivity")} sub={t("aan.weeklyActivitySub")} />
            <div style={{ height: 210 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.weeklyActivity} barGap={2}>
                  <CartesianGrid stroke="rgba(255,255,255,0.03)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="week" tick={{ fill: DIM, fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: DIM, fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<DarkTooltip />} cursor={{ fill: "rgba(255,255,255,0.02)" }} />
                  <Bar dataKey="attempts" name={t("aan.weeklyActivity")} fill={LIME} radius={[3, 3, 0, 0]} maxBarSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        </div>

        {/* Row 4 */}
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 2, marginTop: 2 }}>
          <Panel>
            <SectionHead title={t("aan.monthlyPerf")} sub={t("aan.monthlyPerfSub")} />
            <div style={{ height: 170 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={d.monthlyPerformance}>
                  <defs><linearGradient id="gMonthlyScore" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={LIME} stopOpacity={0.35} /><stop offset="100%" stopColor={LIME} stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid stroke="rgba(255,255,255,0.03)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="month" tick={{ fill: DIM, fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fill: DIM, fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<DarkTooltip />} />
                  <Area type="monotone" dataKey="score" name={t("aan.stOverallScore")} stroke={LIME} strokeWidth={2} fill="url(#gMonthlyScore)" dot={{ r: 3.5, fill: LIME, stroke: CARD, strokeWidth: 2 }} connectNulls />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel>
            <div className="flex items-start justify-between">
              <SectionHead title={t("aan.scoreDistribution")} sub={t("aan.scoreDistributionSub")} />
              {!d.scoreDistribution.every((b) => b.count === 0) && (
                <div className="flex shrink-0 gap-1">
                  <button
                    onClick={() => { const svg = scoreChartRef.current?.querySelector("svg"); if (svg) downloadPng(svg, "score-distribution.png", CARD); }}
                    title={t("aan.exportPng")}
                    aria-label={t("aan.exportPng")}
                    className="rounded-md p-1.5 hover:bg-white/[0.06]"
                    style={{ color: DIM }}
                  >
                    <ImageIcon className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => { const svg = scoreChartRef.current?.querySelector("svg"); if (svg) downloadSvg(svg, "score-distribution.svg"); }}
                    title={t("aan.exportSvg")}
                    aria-label={t("aan.exportSvg")}
                    className="rounded-md p-1.5 hover:bg-white/[0.06]"
                    style={{ color: DIM }}
                  >
                    <FileCode className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
            {d.scoreDistribution.every((b) => b.count === 0) ? <Empty t={t} /> : (
              <div ref={scoreChartRef} style={{ height: 170 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.scoreDistribution} barGap={2}>
                    <CartesianGrid stroke="rgba(255,255,255,0.03)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: DIM, fontSize: 9 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: DIM, fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip content={<DarkTooltip />} cursor={{ fill: "rgba(255,255,255,0.02)" }} />
                    <Bar dataKey="count" name={t("aan.students")} fill={CYAN} radius={[3, 3, 0, 0]} maxBarSize={36} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            <p style={{ fontSize: 10, color: DIM, marginTop: 8 }}>{t("aan.scoreDistributionHint")}</p>
          </Panel>
        </div>

        {/* Row 5 — real cohort/term comparisons and at-risk flagging computed
            server-side (GET /api/admin/analytics/cohorts) with no frontend
            consumer until now. */}
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 2, marginTop: 2 }}>
          <Panel>
            <SectionHead title={t("aan.riskTitle")} sub={t("aan.atRiskSub")} />
            {!cohorts ? <Empty t={t} /> : cohorts.atRisk.length === 0 ? (
              <p style={{ fontSize: 12, color: DIM }}>{t("aan.atRiskNone")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full" style={{ fontSize: 11 }}>
                  <caption className="sr-only">{t("aan.riskTitle")}</caption>
                  <thead>
                    <tr style={{ color: DIM, textAlign: "left" }}>
                      <th scope="col" style={{ fontWeight: 600, paddingBottom: 8 }}>{t("aan.riskColStudent")}</th>
                      <th scope="col" style={{ fontWeight: 600, paddingBottom: 8 }}>{t("aan.riskColReason")}</th>
                      <th scope="col" style={{ fontWeight: 600, paddingBottom: 8 }}>{t("aan.riskColAction")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cohorts.atRisk.slice(0, 8).map((r) => (
                      <tr key={r.candidateId} style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                        <td style={{ padding: "8px 0" }}>
                          <Link to={`/admin/students/${r.candidateId}`} style={{ color: "#f0f0f0", textDecoration: "none" }} className="hover:underline">
                            <span className="flex items-center gap-1.5">
                              <AlertTriangle className="h-3 w-3 shrink-0" style={{ color: r.level === "high" ? "#ef4444" : ORANGE }} />
                              {r.name}
                            </span>
                          </Link>
                        </td>
                        <td style={{ padding: "8px 8px 8px 0", color: "#c0c0c0" }}>{r.reasons.join(" · ")}</td>
                        <td style={{ padding: "8px 0", color: DIM }}>{t(r.level === "high" ? "aan.actionHigh" : "aan.actionMedium")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel>
            <SectionHead title={t("aan.cohortCompareTitle")} sub={t("aan.cohortComparisonSub")} />
            {!cohorts || cohorts.cohorts.length === 0 ? <Empty t={t} /> : (
              <div className="flex flex-col" style={{ gap: 14 }}>
                {cohorts.cohorts.slice(0, 6).map((c, i) => (
                  <HBar key={c.id} label={`${c.name} (${c.members})`} score={c.avgScore ?? 0} color={SUBJECT_COLORS[i % SUBJECT_COLORS.length]} />
                ))}
              </div>
            )}
          </Panel>
        </div>

        {/* Row 6 — Demographic Analysis: only the dimensions this app has
            real data for (gender always did; department since Phase 0's
            student↔department linkage). Programme/campus/age-group/category
            stay out rather than being faked. */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, marginTop: 2 }}>
          <Panel>
            <SectionHead title={t("aan.demoByGender")} sub={t("aan.demoSub")} />
            {d.demographics.byGender.length === 0 ? <Empty t={t} /> : (
              <div className="flex flex-col" style={{ gap: 14 }}>
                {d.demographics.byGender.map((g, i) => <HBar key={g.label} label={`${g.label} (${g.count})`} score={g.avgScore} color={SUBJECT_COLORS[i % SUBJECT_COLORS.length]} />)}
              </div>
            )}
          </Panel>
          <Panel>
            <SectionHead title={t("aan.demoByDepartment")} sub={t("aan.demoSub")} />
            {d.demographics.byDepartment.length === 0 ? (
              <p style={{ fontSize: 12, color: DIM }}>{t("aan.demoNoDept")}</p>
            ) : (
              <div className="flex flex-col" style={{ gap: 14 }}>
                {d.demographics.byDepartment.map((g, i) => <HBar key={g.label} label={`${g.label} (${g.count})`} score={g.avgScore} color={SUBJECT_COLORS[i % SUBJECT_COLORS.length]} />)}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </AdminShell>
  );
}

// ── Shared bits ───────────────────────────────────────────────────────────
function Panel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ backgroundColor: CARD, padding: 20, ...style }}>{children}</div>;
}
function SectionHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <p style={{ fontSize: 12, fontWeight: 600, color: "#f0f0f0" }}>{title}</p>
      {sub && <p style={{ fontSize: 10, color: DIM, marginTop: 2 }}>{sub}</p>}
    </div>
  );
}
function Empty({ t }: { t: TFn }) {
  return <p style={{ fontSize: 12, color: DIM }}>{t("aan.noDataShort")}</p>;
}
function HBar({ label, score, color }: { label: string; score: number; color: string }) {
  return (
    <div>
      <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 500, color: "#d0d0d0" }}>{label}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color }}>{score}%</span>
      </div>
      <div style={{ height: 5, backgroundColor: INNER, borderRadius: 9999, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${score}%`, backgroundColor: color, borderRadius: 9999 }} />
      </div>
    </div>
  );
}
function PaceRow({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="flex items-center justify-between" style={{ padding: 8, borderRadius: 8, backgroundColor: INNER }}>
      <span className="flex items-center gap-2"><span style={{ width: 8, height: 8, borderRadius: "50%", background: color }} /><span style={{ fontSize: 10, color: "#c0c0c0" }}>{label}</span></span>
      <span style={{ fontSize: 12, fontWeight: 700, color }}>{count}</span>
    </div>
  );
}
function StatCard({ label, value, delta, note, color }: { label: string; value: string | number; delta: number | null; note: string; color: string }) {
  const TrendIcon = delta === null ? Minus : delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const trendColor = delta === null || delta === 0 ? DIM : delta > 0 ? LIME : "#ef4444";
  const trendBg = delta === null || delta === 0 ? "rgba(90,90,106,0.20)" : delta > 0 ? "rgba(200,245,61,0.10)" : "rgba(239,68,68,0.10)";
  return (
    <div className="relative flex h-full flex-col justify-between" style={{ backgroundColor: CARD, padding: 20 }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
        <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: DIM }}>{label}</span>
        {delta !== null && (
          <span className="flex items-center gap-1 rounded-full" style={{ padding: "2px 8px", fontSize: 10, fontWeight: 600, background: trendBg, color: trendColor }}>
            <TrendIcon className="h-2.5 w-2.5" /> {delta > 0 ? "+" : ""}{delta}
          </span>
        )}
      </div>
      <div>
        <p style={{ fontSize: 30, fontWeight: 700, color, letterSpacing: "-1px" }}>{value}</p>
        <p style={{ fontSize: 10, color: DIM, marginTop: 6 }}>{note}</p>
      </div>
      <span className="absolute inset-x-0 bottom-0" style={{ height: 1, backgroundColor: `${color}28` }} />
    </div>
  );
}

function DarkTooltip({ active, payload, label }: { active?: boolean; payload?: { name?: string; value?: number | string; color?: string; fill?: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ backgroundColor: "#1e1e1e", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "10px 12px", boxShadow: "0 8px 24px rgba(0,0,0,0.6)" }}>
      {label && <p style={{ fontSize: 11, fontWeight: 600, color: "#f0f0f0", marginBottom: 6 }}>{label}</p>}
      {payload.map((p, i) => (
        <p key={i} style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: p.color || p.fill, display: "inline-block" }} />
          <span style={{ color: "#888" }}>{p.name}:</span>
          <span style={{ color: "#f0f0f0", fontWeight: 600 }}>{p.value}</span>
        </p>
      ))}
    </div>
  );
}
