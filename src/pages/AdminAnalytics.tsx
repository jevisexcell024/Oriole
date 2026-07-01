import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Loader2, Search, Bell, Download, Trophy, Clock, BarChart3, Layers, Target, ArrowUpRight, AlertTriangle,
} from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { RadialGauge, TrendLine } from "@/components/Charts";
import { api } from "@/lib/api";
import { useT, type TFn } from "@/lib/i18n";
import { clsx } from "clsx";

const PRIORITY_KEY: Record<string, string> = { Urgent: "aan.prUrgent", High: "aan.prHigh", Medium: "aan.prMedium", Low: "aan.prLow" };

const G = { btn: "#111110", accent: "#c6ff34", amber: "#E9B949", red: "#6E1423", deep: "#111110" };
// Score-band tiles for the heatmap (single-hue #111110 ramp, light → dark).
const BANDS = ["#DCE6E9", "#9DB6BD", "#5A8290", "#111110"];
const bandOf = (v: number | null) => (v == null ? -1 : v < 40 ? 0 : v < 60 ? 1 : v < 80 ? 2 : 3);

interface Analytics {
  cards: { avgScore: number; highest: number; totalAnalyzed: number; avgMin: number; top: { name: string; score: number } };
  heatMonths: string[];
  heatmap: { subject: string; cells: (number | null)[] }[];
  questionLevels: { tier: string; share: number; correct: number; tone: string }[];
  funnel: { students: number; enrolled: number; completed: number };
  recommendations: { subject: string; avg: number; under50: number } | null;
  growth: { attempt: number; avg: number }[];
  rapid: { priority: string; focus: string; status: string; action: string; impact: string }[];
}

interface CohortRow { id: string; name: string; members: number; attempts: number; avgScore: number | null; passRate: number | null }
interface TermRow { label: string; attempts: number; avgScore: number | null; passRate: number | null }
interface AtRiskRow { candidateId: string; name: string; attempts: number; avgScore: number; lastScore: number; fails: number; level: "high" | "medium"; reasons: string[] }
interface CohortAnalytics { cohorts: CohortRow[]; terms: TermRow[]; atRisk: AtRiskRow[] }

const fmtTime = (min: number, t: TFn) => (min >= 60 ? t("aan.hrMin", { h: Math.floor(min / 60), m: min % 60 }) : t("aan.min", { m: min }));

export function AdminAnalytics() {
  const t = useT();
  const navigate = useNavigate();
  const [d, setD] = useState<Analytics | null>(null);
  const [c, setC] = useState<CohortAnalytics | null>(null);
  const [search, setSearch] = useState("");
  useEffect(() => {
    api.get<Analytics>("/admin/analytics-overview").then(setD).catch(() => setD(null));
    api.get<CohortAnalytics>("/admin/analytics/cohorts").then(setC).catch(() => setC(null));
  }, []);

  const heatRows = useMemo(
    () => (d?.heatmap ?? []).filter((r) => r.subject.toLowerCase().includes(search.trim().toLowerCase())),
    [d, search],
  );

  return (
    <AdminShell wide>
      <div className="fade-in space-y-4">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[6px] bg-[#111110] px-5 py-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">{t("aan.title")}</h1>
            <p className="text-sm text-[#C7D6DA]">{t("aan.subtitle")}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-2 sm:flex">
              <Search className="h-4 w-4 text-[#C7D6DA]" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("aan.searchSubject")} className="w-36 bg-transparent text-sm text-white outline-none placeholder:text-[#C7D6DA]" />
            </div>
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white"><Bell className="h-4 w-4" /></span>
            <button onClick={() => navigate("/admin/reports")} className="btn btn-on-teal"><Download className="h-4 w-4" /> {t("aan.exportReport")}</button>
          </div>
        </div>

        {!d ? <div className="flex items-center gap-2 py-16 text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}</div> : (
          <>
            {/* KPI cards */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <Kpi icon={BarChart3} tint={G.accent} label={t("aan.kpiAvgScore")} value={`${d.cards.avgScore}%`} sub={t("aan.marks")} />
              <Kpi icon={Trophy} tint={G.amber} label={t("aan.kpiHighest")} value={`${d.cards.highest}%`} sub={t("aan.marks")} />
              <Kpi icon={Layers} tint="#0EA5E9" label={t("aan.kpiAnalyzed")} value={d.cards.totalAnalyzed} sub={t("aan.submissions")} />
              <Kpi icon={Clock} tint="#0EA5E9" label={t("aan.kpiAvgTime")} value={fmtTime(d.cards.avgMin, t)} sub={t("aan.perAttempt")} />
              <Kpi icon={Trophy} tint={G.btn} label={t("aan.kpiTop")} value={`${d.cards.top.score}%`} sub={d.cards.top.name} />
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.35fr_1fr]">
              {/* ===== Left ===== */}
              <div className="space-y-4">
                {/* Heatmap */}
                <div className="card rounded-2xl p-5">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-bold">{t("aan.bySubject")}</h2>
                    <span className="text-[11px] text-[var(--muted)]">{t("aan.avgLast8")}</span>
                  </div>
                  {heatRows.length === 0 ? (
                    <p className="mt-4 text-sm text-[var(--muted)]">{t("aan.noResults")}</p>
                  ) : (
                    <div className="mt-4 overflow-x-auto">
                      <div className="min-w-[460px]">
                        {heatRows.map((row) => (
                          <div key={row.subject} className="mb-1.5 flex items-center gap-2">
                            <span className="w-20 shrink-0 truncate text-xs text-[var(--muted)]">{row.subject}</span>
                            <div className="flex flex-1 gap-1.5">
                              {row.cells.map((v, i) => {
                                const b = bandOf(v);
                                return <div key={i} title={v == null ? t("aan.noData") : `${v}%`} className="h-6 flex-1 rounded-[3px]" style={{ background: b < 0 ? "var(--card-2)" : BANDS[b] }} />;
                              })}
                            </div>
                          </div>
                        ))}
                        <div className="mt-2 flex items-center gap-2">
                          <span className="w-20 shrink-0" />
                          <div className="flex flex-1 justify-between text-[9px] text-[var(--muted)]">
                            {d.heatMonths.map((m) => <span key={m}>{m}</span>)}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="mt-4 flex flex-wrap gap-3 text-[10px] text-[var(--muted)]">
                    {["0–40", "40–60", "60–80", "80–100"].map((l, i) => (
                      <span key={l} className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-[2px]" style={{ background: BANDS[i] }} /> {l}</span>
                    ))}
                  </div>
                </div>

                {/* Rapid performance acceleration */}
                <div className="card rounded-2xl p-5">
                  <h2 className="text-base font-bold">{t("aan.rapid")}</h2>
                  {d.rapid.length === 0 ? (
                    <p className="mt-3 text-sm text-[var(--muted)]">{t("aan.notEnoughRec")}</p>
                  ) : (
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
                            <th className="pb-2.5 font-semibold">{t("aan.colPriority")}</th>
                            <th className="pb-2.5 font-semibold">{t("aan.colFocus")}</th>
                            <th className="pb-2.5 font-semibold">{t("aan.colStatus")}</th>
                            <th className="hidden pb-2.5 font-semibold sm:table-cell">{t("aan.colAction")}</th>
                            <th className="pb-2.5 font-semibold">{t("aan.colImpact")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.rapid.map((r, i) => (
                            <tr key={i} className="border-b border-[var(--border)] last:border-0">
                              <td className="py-2.5"><PriorityTag p={r.priority} /></td>
                              <td className="py-2.5 font-medium">{r.focus}</td>
                              <td className="py-2.5 text-[var(--muted)]">{r.status}</td>
                              <td className="hidden py-2.5 text-[var(--muted)] sm:table-cell">{r.action}</td>
                              <td className="py-2.5 font-medium" style={{ color: G.btn }}>{r.impact}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              {/* ===== Right ===== */}
              <div className="space-y-4">
                {/* Question-level analysis */}
                <div className="card rounded-2xl p-5">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-bold">{t("aan.questionLevel")}</h2>
                    <button onClick={() => navigate("/admin/results")} className="text-[var(--muted)] hover:text-[var(--fg)]"><ArrowUpRight className="h-4 w-4" /></button>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-3">
                    {d.questionLevels.map((q) => {
                      const c = q.tone === "green" ? G.accent : q.tone === "amber" ? G.amber : G.red;
                      return (
                        <div key={q.tier} className="flex flex-col items-center text-center" title={t("aan.answeredCorrectly", { n: q.correct })}>
                          <RadialGauge size={74} thickness={7} color={c} value={q.correct} max={100} display={`${q.correct}%`} />
                          <p className="mt-2 text-[11px] font-medium leading-tight">{q.tier}</p>
                          <p className="text-[10px] leading-tight text-[var(--muted)]">{t("aan.ofItems", { n: q.share })}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Enrollment at a glance */}
                <div className="card rounded-2xl p-5">
                  <h2 className="text-sm font-bold">{t("aan.enrollGlance")}</h2>
                  <p className="stat-num mt-1 font-display text-2xl font-semibold">{d.funnel.students} <span className="text-xs font-medium text-[var(--muted)]">{t("aan.totalStudents")}</span></p>
                  <div className="mt-4 flex items-center justify-around gap-3">
                    <div className="flex flex-col items-center gap-1.5">
                      <RadialGauge size={84} thickness={8} color={G.btn} value={d.funnel.enrolled} max={Math.max(1, d.funnel.students)} display={d.funnel.enrolled} />
                      <span className="text-[11px] font-medium text-[var(--muted)]">{t("aan.enrolled")}</span>
                    </div>
                    <div className="flex flex-col items-center gap-1.5">
                      <RadialGauge size={84} thickness={8} color={G.accent} value={d.funnel.completed} max={Math.max(1, d.funnel.students)} display={d.funnel.completed} />
                      <span className="text-[11px] font-medium text-[var(--muted)]">{t("aan.completed")}</span>
                    </div>
                  </div>
                </div>

                {/* Recommendations */}
                <div className="card rounded-2xl p-5">
                  <h2 className="text-sm font-bold">{t("aan.recommendations")}{d.recommendations ? ` · ${d.recommendations.subject}` : ""}</h2>
                  {!d.recommendations ? (
                    <p className="mt-2 text-sm text-[var(--muted)]">{t("aan.noAttentionSubject")}</p>
                  ) : (
                    <div className="mt-3 space-y-2 text-xs">
                      <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2">
                        <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-bold text-rose-400">{t("aan.crisis")}</span>
                        <span className="text-[var(--muted)]">{t("aan.crisisLine", { avg: d.recommendations.avg, under: d.recommendations.under50 })}</span>
                      </div>
                      <div className="flex items-start gap-2 rounded-lg border px-3 py-2" style={{ borderColor: "rgba(43,174,132,0.3)", background: "rgba(43,174,132,0.08)" }}>
                        <span className="rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ background: "rgba(43,174,132,0.2)", color: G.btn }}>{t("aan.actionBadge")}</span>
                        <span className="text-[var(--muted)]">{t("aan.actionLine")}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Performance growth over attempts */}
                <div className="card rounded-2xl p-5">
                  <h2 className="text-sm font-bold">{t("aan.growth")}</h2>
                  {d.growth.length < 2 ? (
                    <p className="mt-2 text-sm text-[var(--muted)]">{t("aan.notEnoughRepeat")}</p>
                  ) : <GrowthChart data={d.growth} t={t} />}
                </div>
              </div>
            </div>

            {/* Cohort & term comparison + at-risk */}
            {c && (
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                <div className="card rounded-2xl p-5">
                  <h2 className="text-base font-bold">{t("aan.cohortComparison")}</h2>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">{t("aan.avgByClass")}</p>
                  {c.cohorts.length === 0 ? <p className="mt-3 text-sm text-[var(--muted)]">{t("aan.noClasses")}</p> : (
                    <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3">
                      {c.cohorts.map((co) => (
                        <div key={co.id} className="flex flex-col items-center gap-1.5 text-center" title={`${co.attempts} · ${co.members}`}>
                          <RadialGauge size={76} thickness={7} color={G.btn} value={co.avgScore ?? 0} max={100} display={co.avgScore != null ? `${co.avgScore}%` : "—"} />
                          <span className="max-w-full truncate text-[11px] font-medium">{co.name}</span>
                          {co.passRate != null && <span className="text-[10px] text-[var(--muted)]">{t("aan.passSuffix", { n: co.passRate })}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="card rounded-2xl p-5">
                  <h2 className="text-base font-bold">{t("aan.termOverTerm")}</h2>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">{t("aan.avgAcrossTerms")}</p>
                  {c.terms.length === 0 ? <p className="mt-3 text-sm text-[var(--muted)]">{t("aan.noDatedResults")}</p> : c.terms.length < 2 ? (
                    <div className="mt-4 flex items-center gap-4">
                      <RadialGauge size={88} thickness={9} color={G.accent} value={c.terms[0].avgScore ?? 0} max={100} display={c.terms[0].avgScore != null ? `${c.terms[0].avgScore}%` : "—"} />
                      <div className="text-sm"><p className="font-semibold">{c.terms[0].label}</p><p className="text-xs text-[var(--muted)]">{t("aan.avgScoreSmall")}{c.terms[0].passRate != null ? ` · ${t("aan.passSuffix", { n: c.terms[0].passRate })}` : ""}</p></div>
                    </div>
                  ) : (
                    <TrendLine data={c.terms.map((tm) => ({ label: tm.label, value: tm.avgScore ?? 0 }))} color={G.accent} yMax={100} />
                  )}
                </div>

                <div className="card rounded-2xl p-5">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-bold">{t("aan.atRisk")}</h2>
                    {c.atRisk.length > 0 && <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] font-semibold text-rose-400">{c.atRisk.length}</span>}
                  </div>
                  {c.atRisk.length === 0 ? <p className="mt-3 text-sm text-emerald-400">{t("aan.noneFlagged")}</p> : (
                    <div className="mt-3 max-h-[260px] space-y-2 overflow-y-auto">
                      {c.atRisk.map((s) => (
                        <button key={s.candidateId} onClick={() => navigate(`/admin/students/${s.candidateId}`)} className="flex w-full items-start gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-left hover:bg-[var(--card-2)]">
                          <span className={clsx("mt-0.5 h-2 w-2 shrink-0 rounded-full", s.level === "high" ? "bg-rose-500" : "bg-amber-500")} />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{s.name}</span><span className="shrink-0 text-xs tabular-nums text-[var(--muted)]">{t("aan.avgSmall", { n: s.avgScore })}</span></span>
                            <span className="text-[11px] text-[var(--muted)]">{s.reasons.join(" · ")}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AdminShell>
  );
}

function Kpi({ icon: Icon, tint, label, value, sub }: { icon: typeof Bell; tint: string; label: string; value: string | number; sub: string }) {
  return (
    <div className="card rounded-xl p-3.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-[var(--muted)]">{label}</span>
        <Icon className="h-4 w-4" style={{ color: tint }} />
      </div>
      <div className="mt-2 text-xl font-extrabold leading-none">{value}</div>
      <div className="mt-1.5 truncate text-[11px] text-[var(--muted)]">{sub}</div>
    </div>
  );
}

function PriorityTag({ p }: { p: string }) {
  const t = useT();
  const map: Record<string, string> = { Urgent: "#6E1423", High: "#E9B949", Medium: "#111110", Low: "#687069" };
  return <span className="text-xs font-semibold" style={{ color: map[p] ?? "#687069" }}>{t(PRIORITY_KEY[p] ?? p)}</span>;
}

function GrowthChart({ data, t }: { data: { attempt: number; avg: number }[]; t: TFn }) {
  const w = 300, h = 120, padL = 24, padB = 22, padT = 12;
  const max = 100;
  const stepX = (w - padL) / Math.max(1, data.length - 1);
  const x = (i: number) => padL + i * stepX;
  const y = (v: number) => padT + (1 - v / max) * (h - padT - padB);
  const line = data.map((d, i) => `${x(i)},${y(d.avg)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 w-full">
      {[0, 50, 100].map((g) => { const yy = y(g); return <g key={g}><line x1={padL} x2={w} y1={yy} y2={yy} stroke="var(--border)" /><text x={0} y={yy + 3} className="fill-[var(--muted)]" fontSize="8">{g}</text></g>; })}
      <polyline points={line} fill="none" stroke={G.btn} strokeWidth="2" />
      {data.map((d, i) => <circle key={i} cx={x(i)} cy={y(d.avg)} r="3" fill={G.btn} />)}
      {data.map((d, i) => <text key={i} x={x(i)} y={h - 6} textAnchor="middle" className="fill-[var(--muted)]" fontSize="8">{t("aan.attemptN", { n: d.attempt })}</text>)}
    </svg>
  );
}
