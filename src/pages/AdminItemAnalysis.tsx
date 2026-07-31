import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Loader2, ArrowLeft, BarChart3, Users, Activity, MessageSquareText, Sheet, ListChecks, LineChart, FileBarChart2, FileDown, ExternalLink, ShieldAlert, Printer, Presentation } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { ErrorBanner, Modal, TableSkeleton } from "@/components/ui";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column, type TableFilter } from "@/components/DataTable";
import { api } from "@/lib/api";
import { useT, type TFn } from "@/lib/i18n";
import { clsx } from "clsx";

interface Distractor { option: string; picks: number; pct: number; correct: boolean }
export interface Item {
  id: string; prompt: string; type: string; points: number; sectionId: string | null;
  answered: number; correct: number; correctRate: number | null; avgPoints: number | null;
  difficulty: "easy" | "medium" | "hard" | null; discrimination: number | null;
  distractors: Distractor[] | null; tags: string[];
}
export interface Topic { topic: string; items: number; answered: number; correctRate: number | null; }
export interface Resp { exam: { id: string; title: string; code: string }; attempts: number; items: Item[]; alpha: number | null; topics: Topic[]; }

// Reuses GET /api/admin/results — already computes every submitted attempt
// with everything the Student Responses tab needs (score, grading status,
// integrity, submission time) — filtering it to this exam client-side avoids
// standing up a second, duplicate per-exam attempts endpoint.
export interface AttemptRow {
  id: string; candidateName: string; candidateEmail: string; examId: string;
  score: number; passed: boolean; submittedAt: string | null; flagCount: number; integrity: number; gradingStatus: string;
}

type Tab = "analytics" | "responses" | "infographics" | "reports" | "exports";

const TYPE_LABEL: Record<string, string> = { mcq: "MCQ", multi_select: "Multi", true_false: "T/F", short: "Text", numeric: "Numeric", essay: "Essay", code: "Code", matching: "Match", ordering: "Order", cloze: "Cloze", hotspot: "Hotspot", file_upload: "File", media_comprehension: "Media" };
const DIFF_CLS: Record<string, string> = { easy: "bg-emerald-500/15 text-emerald-500", medium: "bg-amber-500/15 text-amber-500", hard: "bg-rose-500/15 text-rose-500" };

/** Interpretation band for Cronbach's alpha. */
function alphaBand(a: number) {
  if (a >= 0.9) return { labelKey: "aitem.bandExcellent", cls: "text-emerald-500" };
  if (a >= 0.8) return { labelKey: "aitem.bandGood", cls: "text-emerald-500" };
  if (a >= 0.7) return { labelKey: "aitem.bandAcceptable", cls: "text-amber-500" };
  if (a >= 0.6) return { labelKey: "aitem.bandQuestionable", cls: "text-amber-500" };
  return { labelKey: "aitem.bandPoor", cls: "text-rose-500" };
}
const DIFF_KEY: Record<string, string> = { easy: "aitem.easy", medium: "aitem.medium", hard: "aitem.hard" };

/** Deterministic executive-insight sentences — every one traces to a number
 *  already computed elsewhere on this page (items/topics/alpha from
 *  item-analysis, pass/fail from the Student Responses attempts). No inference,
 *  no fabricated comparison: an insight that needs data this page doesn't have
 *  (e.g. a trend against "the previous assessment") is simply never generated
 *  rather than approximated. Exported as a plain function so it's unit-testable
 *  without mounting the component. */
export function buildInsights(data: Resp, attempts: AttemptRow[] | null, t: TFn): string[] {
  const insights: string[] = [];

  if (attempts && attempts.length > 0) {
    const passRate = Math.round((attempts.filter((a) => a.passed).length / attempts.length) * 100);
    insights.push(t("aitem.insightPassRate", { pct: passRate }));
  }

  const answeredItems = data.items.filter((i) => i.correctRate !== null);
  if (answeredItems.length > 0) {
    const weakest = [...answeredItems].sort((a, b) => (a.correctRate ?? 0) - (b.correctRate ?? 0))[0];
    const idx = data.items.findIndex((i) => i.id === weakest.id) + 1;
    insights.push(t("aitem.insightWeakestQuestion", { n: idx, pct: weakest.correctRate ?? 0 }));
  }

  const answeredTopics = data.topics.filter((tp) => tp.correctRate !== null);
  if (answeredTopics.length > 1) {
    const weakest = [...answeredTopics].sort((a, b) => (a.correctRate ?? 0) - (b.correctRate ?? 0))[0];
    insights.push(t("aitem.insightWeakestTopic", { topic: weakest.topic, pct: weakest.correctRate ?? 0 }));
  }

  if (data.alpha !== null) {
    insights.push(t("aitem.insightReliability", { alpha: data.alpha.toFixed(2), band: t(alphaBand(data.alpha).labelKey).toLowerCase() }));
  }

  return insights;
}

export function AdminItemAnalysis() {
  const t = useT();
  const { examId } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("analytics");
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openQuestion, setOpenQuestion] = useState<Item | null>(null);
  const [exportingSheet, setExportingSheet] = useState(false);
  const [exportingPptx, setExportingPptx] = useState(false);
  const [attempts, setAttempts] = useState<AttemptRow[] | null>(null);

  useEffect(() => { api.get<Resp>(`/admin/exams/${examId}/item-analysis`).then(setData).catch((e) => setError(e.message)); }, [examId]);
  useEffect(() => {
    api.get<{ attempts: AttemptRow[] }>("/admin/results").then((d) => setAttempts(d.attempts.filter((a) => a.examId === examId))).catch(() => setAttempts([]));
  }, [examId]);

  async function exportAnswerSheet() {
    if (!examId || !data) return;
    setExportingSheet(true);
    try {
      const res = await fetch(`/api/admin/exams/${examId}/answers.csv`, { credentials: "include" });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${data.exam.code || data.exam.id}-answers.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { setError((e as Error).message); }
    finally { setExportingSheet(false); }
  }

  // Dynamically imported so the ~1MB pptxgenjs bundle only ever loads for an
  // admin who actually clicks this button, not on every visit to this page.
  async function exportPowerPoint() {
    if (!data) return;
    setExportingPptx(true);
    try {
      const PptxGenJS = (await import("pptxgenjs")).default;
      const pptx = new PptxGenJS();
      pptx.author = "Oriole";
      pptx.title = data.exam.title;
      const insights = buildInsights(data, attempts, t);

      const slide1 = pptx.addSlide();
      slide1.background = { color: "0E0E0D" };
      slide1.addText(data.exam.title, { x: 0.5, y: 0.4, w: 9, h: 0.6, fontSize: 24, bold: true, color: "FFFFFF" });
      slide1.addText(`${data.exam.code} · ${new Date().toLocaleDateString()}`, { x: 0.5, y: 1.0, w: 9, h: 0.3, fontSize: 12, color: "9FBCC2" });
      slide1.addText(t("aitem.summary", { attempts: data.attempts, items: data.items.length }), { x: 0.5, y: 1.5, w: 9, h: 0.4, fontSize: 14, color: "C6FF34" });
      if (insights.length > 0) {
        slide1.addText(insights.map((line) => ({ text: line, options: { bullet: true, breakLine: true } })), { x: 0.5, y: 2.1, w: 9, h: 3, fontSize: 13, color: "DCE8EA" });
      }

      const slide2 = pptx.addSlide();
      slide2.background = { color: "0E0E0D" };
      slide2.addText(t("aitem.tabAnalytics"), { x: 0.5, y: 0.3, w: 9, h: 0.5, fontSize: 20, bold: true, color: "FFFFFF" });
      const header = [t("aitem.colQuestion"), t("aitem.colType"), t("aitem.colCorrectRate"), t("aitem.colDifficulty")].map((text) => ({ text, options: { bold: true, color: "C6FF34" } }));
      const rows = data.items.map((it, i) => [
        `Q${i + 1}. ${(it.prompt || t("aitem.noPrompt")).slice(0, 70)}`,
        TYPE_LABEL[it.type] ?? it.type,
        it.correctRate === null ? "—" : `${it.correctRate}%`,
        it.difficulty ? t(DIFF_KEY[it.difficulty]) : "—",
      ].map((text) => ({ text })));
      slide2.addTable([header, ...rows], { x: 0.5, y: 0.9, w: 9, fontSize: 10, color: "DCE8EA", border: { type: "solid", color: "333333", pt: 0.5 }, autoPage: true });

      await pptx.writeFile({ fileName: `${data.exam.code || data.exam.id}-summary.pptx` });
    } catch (e) { setError((e as Error).message); }
    finally { setExportingPptx(false); }
  }

  const columns: Column<Item>[] = [
    { key: "q", header: t("aitem.colQuestion"), sortValue: (i) => i.prompt, csv: (i) => i.prompt, td: "max-w-[360px]", render: (i) => <span className="line-clamp-2">{i.prompt || <span className="text-[var(--muted)]">{t("aitem.noPrompt")}</span>}</span> },
    { key: "type", header: t("aitem.colType"), sortValue: (i) => i.type, csv: (i) => TYPE_LABEL[i.type] ?? i.type, render: (i) => <span className="rounded-full bg-[var(--card-2)] px-2 py-0.5 text-[11px] font-semibold">{TYPE_LABEL[i.type] ?? i.type}</span> },
    { key: "answered", header: t("aitem.colAnswered"), sortValue: (i) => i.answered, csv: (i) => String(i.answered), th: "text-right", td: "text-right tabular-nums", render: (i) => i.answered },
    { key: "rate", header: t("aitem.colCorrectRate"), sortValue: (i) => i.correctRate ?? -1, csv: (i) => (i.correctRate === null ? "" : `${i.correctRate}%`), render: (i) => i.correctRate === null ? <span className="text-[var(--muted)]">—</span> : (
      <span className="inline-flex items-center gap-2">
        <span className="h-1.5 w-20 overflow-hidden rounded-full bg-[var(--card-2)]"><span className="block h-full rounded-full" style={{ width: `${i.correctRate}%`, background: i.correctRate >= 70 ? "#16A34A" : i.correctRate >= 40 ? "#E9B949" : "#DC2626" }} /></span>
        <span className="tabular-nums text-xs">{i.correctRate}%</span>
      </span>
    ) },
    { key: "diff", header: t("aitem.colDifficulty"), sortValue: (i) => i.correctRate ?? -1, csv: (i) => i.difficulty ?? "", render: (i) => i.difficulty ? <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-semibold", DIFF_CLS[i.difficulty])}>{t(DIFF_KEY[i.difficulty] ?? i.difficulty)}</span> : <span className="text-[var(--muted)]">—</span> },
    { key: "disc", header: t("aitem.colDiscrimination"), sortValue: (i) => i.discrimination ?? -2, csv: (i) => (i.discrimination === null ? "" : String(i.discrimination)), th: "text-right", td: "text-right", render: (i) => i.discrimination === null ? <span className="text-[var(--muted)]">—</span> : (
      <span className={clsx("font-semibold tabular-nums", i.discrimination >= 0.3 ? "text-emerald-500" : i.discrimination >= 0.1 ? "text-amber-500" : "text-rose-500")} title={i.discrimination >= 0.3 ? t("aitem.discGood") : i.discrimination >= 0.1 ? t("aitem.discFair") : t("aitem.discWeak")}>{i.discrimination > 0 ? "+" : ""}{i.discrimination.toFixed(2)}</span>
    ) },
    { key: "distractors", header: t("aitem.colOptionPicks"), sortValue: () => 0, csv: (i) => (i.distractors ?? []).map((d) => `${d.option}${d.correct ? "*" : ""}: ${d.pct}%`).join(" | "), td: "min-w-[180px]", render: (i) => !i.distractors ? <span className="text-[var(--muted)]">—</span> : (
      <div className="space-y-0.5">
        {i.distractors.map((d, di) => (
          <div key={di} className="flex items-center gap-1.5 text-[11px]" title={`${d.picks} pick${d.picks === 1 ? "" : "s"}`}>
            <span className={clsx("w-14 shrink-0 truncate", d.correct ? "font-semibold text-emerald-500" : "text-[var(--muted)]")}>{d.correct ? "✓ " : ""}{d.option}</span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--card-2)]"><span className="block h-full rounded-full" style={{ width: `${d.pct}%`, background: d.correct ? "#16A34A" : d.pct === 0 ? "var(--border)" : "#DC2626" }} /></span>
            <span className="w-8 shrink-0 text-right tabular-nums text-[var(--muted)]">{d.pct}%</span>
          </div>
        ))}
      </div>
    ) },
    { key: "actions", header: t("aitem.colActions"), sortValue: () => 0, th: "text-right", td: "text-right", render: (i) => (
      <button onClick={() => setOpenQuestion(i)} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-[#c6ff34] hover:bg-[#c6ff34]/10" title={t("aitem.viewResponses")}>
        <MessageSquareText className="h-3.5 w-3.5" /> {t("aitem.viewResponses")}
      </button>
    ) },
  ];

  const filters: TableFilter<Item>[] = [
    { id: "diff", label: t("aitem.allDifficulties"), options: [{ value: "easy", label: t("aitem.easy") }, { value: "medium", label: t("aitem.medium") }, { value: "hard", label: t("aitem.hard") }], match: (i, v) => i.difficulty === v },
    { id: "type", label: t("aitem.allTypes"), options: Object.entries(TYPE_LABEL).map(([v, l]) => ({ value: v, label: l })), match: (i, v) => i.type === v },
  ];

  const responseColumns: Column<AttemptRow>[] = [
    { key: "name", header: t("aitem.colStudent"), sortValue: (a) => a.candidateName, csv: (a) => a.candidateName, render: (a) => (
      <span><span className="block font-medium">{a.candidateName}</span><span className="block text-xs text-[var(--muted)]">{a.candidateEmail}</span></span>
    ) },
    { key: "score", header: t("aitem.colScore"), sortValue: (a) => a.score, csv: (a) => `${a.score}%`, th: "text-right", td: "text-right tabular-nums font-semibold", render: (a) => `${a.score}%` },
    { key: "result", header: t("aitem.colResult"), sortValue: (a) => (a.passed ? 1 : 0), csv: (a) => (a.passed ? "Pass" : "Fail"), render: (a) => (
      <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-semibold", a.passed ? "bg-emerald-500/15 text-emerald-500" : "bg-rose-500/15 text-rose-500")}>{a.passed ? t("common.pass") : t("common.fail")}</span>
    ) },
    { key: "grading", header: t("aitem.colGrading"), sortValue: (a) => a.gradingStatus, csv: (a) => a.gradingStatus, render: (a) => a.gradingStatus === "pending_review" ? <span className="text-amber-500">{t("aitem.pendingReview")}</span> : <span className="text-[var(--muted)]">{t("aitem.autoGraded")}</span> },
    { key: "integrity", header: t("aitem.colIntegrity"), sortValue: (a) => a.integrity, csv: (a) => String(a.integrity), th: "text-right", td: "text-right tabular-nums", render: (a) => a.flagCount > 0 ? <span className="text-rose-500">{a.integrity}</span> : a.integrity },
    { key: "submitted", header: t("aitem.colSubmitted"), sortValue: (a) => a.submittedAt ?? "", csv: (a) => a.submittedAt ?? "", render: (a) => a.submittedAt ? new Date(a.submittedAt).toLocaleString() : "—" },
    { key: "actions", header: t("aitem.colActions"), sortValue: () => 0, th: "text-right", td: "text-right", render: (a) => (
      <Link to={`/admin/attempts/${a.id}`} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-[#c6ff34] hover:bg-[#c6ff34]/10">
        <ExternalLink className="h-3.5 w-3.5" /> {t("aitem.viewAttempt")}
      </Link>
    ) },
  ];

  const TABS: { id: Tab; labelKey: string; icon: typeof BarChart3 }[] = [
    { id: "analytics", labelKey: "aitem.tabAnalytics", icon: BarChart3 },
    { id: "responses", labelKey: "aitem.tabResponses", icon: ListChecks },
    { id: "infographics", labelKey: "aitem.tabInfographics", icon: LineChart },
    { id: "reports", labelKey: "aitem.tabReports", icon: FileBarChart2 },
    { id: "exports", labelKey: "aitem.tabExports", icon: FileDown },
  ];

  return (
    <AdminShell wide>
      <div className="fade-in max-w-[1100px]">
        <PageHeader
          title={<span className="inline-flex items-center gap-2"><BarChart3 className="h-6 w-6" /> {t("aitem.title")}</span>}
          subtitle={data ? `${data.exam.title}${data.exam.code ? ` · ${data.exam.code}` : ""}` : t("aitem.subtitleFallback")}
          actions={<button onClick={() => navigate("/admin/results")} className="btn btn-ghost-teal"><ArrowLeft className="h-4 w-4" /> {t("aitem.backResults")}</button>}
        />

        {error && <ErrorBanner className="mt-6">{error}</ErrorBanner>}
        {!data && !error && <div className="mt-8 flex items-center gap-2 text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}</div>}

        {data && (
          <>
            {/* Printable Report — the one always-rendered-but-screen-hidden view
                the Exports tab's "Print report" button triggers via
                window.print(), same convention as StudentRecord.tsx's existing
                print letterhead. Everything else on this page (tab bar +
                every tab's content) is print:hidden, so only this shows up
                in the printout or a "Save as PDF" from the print dialog —
                the same route this app already uses for every other
                downloadable report, rather than a second, parallel
                PDF-generation pipeline. */}
            <div className="hidden print:block">
              <h1 className="text-lg font-bold">{data.exam.title}</h1>
              <p className="text-xs text-[var(--muted)]">{data.exam.code} · {t("aitem.generatedOn", { date: new Date().toLocaleDateString() })}</p>
              <div className="mt-4 flex gap-6 text-sm">
                <span>{t("aitem.summary", { attempts: data.attempts, items: data.items.length })}</span>
                <span>{t("aitem.reliability")}: {data.alpha === null ? "—" : `${data.alpha.toFixed(2)} (${t(alphaBand(data.alpha).labelKey)})`}</span>
              </div>
              {(() => {
                const insights = buildInsights(data, attempts, t);
                return insights.length > 0 ? (
                  <div className="mt-4">
                    <p className="text-xs font-semibold uppercase tracking-wide">{t("aitem.insightsTitle")}</p>
                    <ul className="mt-1 space-y-1">{insights.map((line, i) => <li key={i} className="text-sm">• {line}</li>)}</ul>
                  </div>
                ) : null;
              })()}
              <table className="mt-5 w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-1.5 pr-2">{t("aitem.colQuestion")}</th>
                    <th className="py-1.5 pr-2">{t("aitem.colType")}</th>
                    <th className="py-1.5 pr-2 text-right">{t("aitem.colCorrectRate")}</th>
                    <th className="py-1.5 text-right">{t("aitem.colDifficulty")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((it, i) => (
                    <tr key={it.id} className="border-b">
                      <td className="max-w-[360px] py-1.5 pr-2">Q{i + 1}. {it.prompt || t("aitem.noPrompt")}</td>
                      <td className="py-1.5 pr-2">{TYPE_LABEL[it.type] ?? it.type}</td>
                      <td className="py-1.5 pr-2 text-right">{it.correctRate === null ? "—" : `${it.correctRate}%`}</td>
                      <td className="py-1.5 text-right">{it.difficulty ? t(DIFF_KEY[it.difficulty]) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Tab bar — the "Responses" hub the spec asks for, one page per
                exam instead of five separate pages so nothing here re-fetches
                data another tab already loaded. A real ARIA tablist (not just
                styled buttons): only the active tab is in the Tab order,
                Left/Right cycles between tabs, matching how a screen reader
                or keyboard-only user actually expects this widget to behave. */}
            <div className="mt-5 flex flex-wrap gap-1 border-b border-[var(--border)] print:hidden" role="tablist" aria-label={t("aitem.tabsLabel")}>
              {TABS.map((tb, i) => (
                <button
                  key={tb.id}
                  id={`aitem-tab-${tb.id}`}
                  role="tab"
                  aria-selected={tab === tb.id}
                  aria-controls="aitem-tabpanel"
                  tabIndex={tab === tb.id ? 0 : -1}
                  onClick={() => setTab(tb.id)}
                  onKeyDown={(e) => {
                    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                    e.preventDefault();
                    const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
                    setTab(next.id);
                    document.getElementById(`aitem-tab-${next.id}`)?.focus();
                  }}
                  className={clsx(
                    "inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition",
                    tab === tb.id ? "border-[#c6ff34] text-[var(--fg)]" : "border-transparent text-[var(--muted)] hover:text-[var(--fg)]",
                  )}
                >
                  <tb.icon className="h-4 w-4" /> {t(tb.labelKey)}
                </button>
              ))}
            </div>

            <div className="print:hidden" role="tabpanel" id="aitem-tabpanel" aria-labelledby={`aitem-tab-${tab}`} tabIndex={0}>
            {tab === "analytics" && (
              <>
                {(() => {
                  const insights = buildInsights(data, attempts, t);
                  return insights.length > 0 ? (
                    <div className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
                      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]"><BarChart3 className="h-3.5 w-3.5" /> {t("aitem.insightsTitle")}</p>
                      <ul className="mt-2 space-y-1.5">
                        {insights.map((line, i) => <li key={i} className="flex gap-2 text-sm"><span className="text-[#c6ff34]">•</span><span>{line}</span></li>)}
                      </ul>
                    </div>
                  ) : null;
                })()}
                <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto]">
                  <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm">
                    <Users className="h-4 w-4 text-[#c6ff34]" /> {t("aitem.summary", { attempts: data.attempts, items: data.items.length })}
                    <span className="ml-2 hidden text-xs text-[var(--muted)] lg:inline">{t("aitem.summaryHint")}</span>
                  </div>
                  <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3" title={t("aitem.alphaTitle")}>
                    <Activity className="h-4 w-4 text-[#c6ff34]" />
                    <div className="leading-tight">
                      <p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{t("aitem.reliability")}</p>
                      {data.alpha === null ? (
                        <p className="text-sm font-semibold text-[var(--muted)]">— <span className="text-xs font-normal">{t("aitem.needItems")}</span></p>
                      ) : (
                        <p className="text-sm font-bold tabular-nums">{data.alpha.toFixed(2)} <span className={clsx("text-xs font-semibold", alphaBand(data.alpha).cls)}>{t(alphaBand(data.alpha).labelKey)}</span></p>
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-4">
                  <DataTable
                    rows={data.items}
                    columns={columns}
                    getId={(i) => i.id}
                    searchText={(i) => i.prompt}
                    searchPlaceholder={t("aitem.searchPlaceholder")}
                    filters={filters}
                    initialSort={{ key: "rate", dir: "asc" }}
                    pageSize={20}
                    exportName={`item-analysis-${data.exam.code || data.exam.id}`}
                    empty={data.attempts === 0 ? t("aitem.emptyNoAttempts") : t("aitem.emptyNoMatch")}
                  />
                </div>
              </>
            )}

            {tab === "responses" && (
              <div className="mt-4">
                {!attempts ? (
                  <TableSkeleton rows={5} cells={6} />
                ) : (
                  <DataTable
                    rows={attempts}
                    columns={responseColumns}
                    getId={(a) => a.id}
                    searchText={(a) => `${a.candidateName} ${a.candidateEmail}`}
                    searchPlaceholder={t("aitem.searchStudents")}
                    initialSort={{ key: "submitted", dir: "desc" }}
                    pageSize={20}
                    exportName={`student-responses-${data.exam.code || data.exam.id}`}
                    empty={t("aitem.emptyNoAttempts")}
                  />
                )}
              </div>
            )}

            {tab === "infographics" && (
              <div className="mt-6">
                <TopicPerformancePanel topics={data.topics} />
                <div className="mt-8">
                  <DifficultyHeatmap items={data.items} onSelect={setOpenQuestion} />
                </div>
              </div>
            )}

            {tab === "reports" && (
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <Link to="/admin/reports" className="card card-hover flex items-center gap-3 p-4">
                  <FileBarChart2 className="h-5 w-5 shrink-0 text-[#c6ff34]" />
                  <span>
                    <span className="block text-sm font-semibold">{t("aitem.reportsLinkTitle")}</span>
                    <span className="block text-xs text-[var(--muted)]">{t("aitem.reportsLinkBody")}</span>
                  </span>
                </Link>
                <Link to={`/admin/exams/${examId}/similarity`} className="card card-hover flex items-center gap-3 p-4">
                  <ShieldAlert className="h-5 w-5 shrink-0 text-[#c6ff34]" />
                  <span>
                    <span className="block text-sm font-semibold">{t("aitem.similarityLinkTitle")}</span>
                    <span className="block text-xs text-[var(--muted)]">{t("aitem.similarityLinkBody")}</span>
                  </span>
                </Link>
              </div>
            )}

            {tab === "exports" && (
              <div className="mt-6">
                <p className="mb-4 max-w-2xl text-xs text-[var(--muted)]">{t("aitem.exportsTabHint")}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                <div className="card p-4">
                  <p className="flex items-center gap-2 text-sm font-semibold"><Sheet className="h-4 w-4 text-[#c6ff34]" /> {t("aitem.exportAnswerSheet")}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">{t("aitem.exportAnswerSheetBody")}</p>
                  <button onClick={exportAnswerSheet} disabled={exportingSheet} className="btn btn-primary mt-3 disabled:opacity-50">
                    {exportingSheet ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sheet className="h-4 w-4" />} {t("aitem.exportAnswerSheet")}
                  </button>
                </div>
                <div className="card p-4">
                  <p className="flex items-center gap-2 text-sm font-semibold"><Printer className="h-4 w-4 text-[#c6ff34]" /> {t("aitem.printReport")}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">{t("aitem.printReportBody")}</p>
                  <button onClick={() => window.print()} className="btn btn-primary mt-3">
                    <Printer className="h-4 w-4" /> {t("aitem.printReport")}
                  </button>
                </div>
                <div className="card p-4">
                  <p className="flex items-center gap-2 text-sm font-semibold"><Presentation className="h-4 w-4 text-[#c6ff34]" /> {t("aitem.exportPptx")}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">{t("aitem.exportPptxBody")}</p>
                  <button onClick={exportPowerPoint} disabled={exportingPptx} className="btn btn-primary mt-3 disabled:opacity-50">
                    {exportingPptx ? <Loader2 className="h-4 w-4 animate-spin" /> : <Presentation className="h-4 w-4" />} {t("aitem.exportPptx")}
                  </button>
                </div>
                </div>
              </div>
            )}
            </div>
          </>
        )}
      </div>

      {openQuestion && examId && <QuestionResponsesModal examId={examId} question={openQuestion} onClose={() => setOpenQuestion(null)} />}
    </AdminShell>
  );
}

/** Rolls up the same per-question correct-rate data the Analytics tab already
 *  shows, grouped by Question.tags (existing topic tags, no new metadata) —
 *  sorted weakest-first so a lecturer sees the topic needing attention first,
 *  matching the spec's "identify weak teaching areas immediately." */
function TopicPerformancePanel({ topics }: { topics: Topic[] }) {
  const t = useT();
  if (topics.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-[var(--border)] py-16 text-center">
        <ListChecks className="h-10 w-10 text-[var(--muted)]" />
        <div>
          <p className="text-sm font-semibold">{t("aitem.topicsEmptyTitle")}</p>
          <p className="mt-1 max-w-sm text-xs text-[var(--muted)]">{t("aitem.topicsEmptyBody")}</p>
        </div>
      </div>
    );
  }
  return (
    <div>
      <h3 className="text-sm font-semibold">{t("aitem.topicPerformance")}</h3>
      <p className="mt-1 text-xs text-[var(--muted)]">{t("aitem.topicPerformanceSub")}</p>
      <div className="mt-4 space-y-4">
        {topics.map((tp) => {
          const rate = tp.correctRate;
          const color = rate === null ? "var(--muted)" : rate >= 70 ? "#16A34A" : rate >= 40 ? "#E9B949" : "#DC2626";
          return (
            <div key={tp.topic}>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{tp.topic}</span>
                <span className="font-semibold tabular-nums" style={{ color }}>{rate === null ? "—" : `${rate}%`}</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--card-2)]">
                <div className="h-full rounded-full" style={{ width: `${rate ?? 0}%`, background: color }} />
              </div>
              <p className="mt-1 text-[11px] text-[var(--muted)]">{t("aitem.topicMeta", { items: tp.items, answered: tp.answered })}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Colour-intensity-only heatmap (no gradient fill, no glow) — each cell's
 *  opacity is driven purely by how hard that question was (100 − correctRate),
 *  the same correctRate the Analytics tab's table already shows, just laid
 *  out spatially instead of in rows. Click drills into the same per-question
 *  response modal the Analytics tab's "View responses" action opens. */
function DifficultyHeatmap({ items, onSelect }: { items: Item[]; onSelect: (item: Item) => void }) {
  const t = useT();
  const answered = items.filter((i) => i.correctRate !== null);
  if (answered.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-[var(--border)] py-16 text-center">
        <LineChart className="h-10 w-10 text-[var(--muted)]" />
        <div>
          <p className="text-sm font-semibold">{t("aitem.heatmapEmptyTitle")}</p>
          <p className="mt-1 max-w-sm text-xs text-[var(--muted)]">{t("aitem.heatmapEmptyBody")}</p>
        </div>
      </div>
    );
  }
  return (
    <div>
      <h3 className="text-sm font-semibold">{t("aitem.heatmapTitle")}</h3>
      <p className="mt-1 text-xs text-[var(--muted)]">{t("aitem.heatmapSub")}</p>
      <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-2">
        {items.map((it, i) => {
          const rate = it.correctRate;
          const intensity = rate === null ? 0 : 0.12 + ((100 - rate) / 100) * 0.78;
          return (
            <button
              key={it.id}
              onClick={() => onSelect(it)}
              title={`${it.prompt || t("aitem.noPrompt")} — ${rate === null ? "—" : `${rate}%`}`}
              aria-label={t("aitem.heatmapCellLabel", { n: i + 1, prompt: it.prompt || t("aitem.noPrompt"), pct: rate === null ? "—" : `${rate}%` })}
              className="flex aspect-square flex-col items-center justify-center rounded-lg border border-[var(--border)] text-xs font-semibold transition hover:scale-[1.04]"
              style={{ background: rate === null ? "var(--card-2)" : `rgba(220,38,38,${intensity})`, color: rate === null ? "var(--muted)" : intensity > 0.5 ? "#fff" : "var(--fg)" }}
            >
              <span>Q{i + 1}</span>
              <span className="text-[10px] font-normal opacity-80">{rate === null ? "—" : `${rate}%`}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] text-[var(--muted)]">{t("aitem.heatmapLegend")}</p>
    </div>
  );
}

interface QResponse {
  attemptId: string; candidateName: string; anonymous: boolean; answered: boolean;
  answer: string | null; correct: boolean; awardedPoints: number; needsReview: boolean; feedback: string | null; submittedAt: string | null;
}
interface QResponsesResp {
  exam: { id: string; title: string; code: string };
  question: { id: string; prompt: string; type: string; points: number; correctAnswer: string };
  total: number; answered: number; responses: QResponse[];
}

const GRADED_TYPES = new Set(["essay", "code", "file_upload"]);

function QuestionResponsesModal({ examId, question, onClose }: { examId: string; question: Item; onClose: () => void }) {
  const t = useT();
  const [data, setData] = useState<QResponsesResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<QResponsesResp>(`/admin/exams/${examId}/questions/${question.id}/responses`).then(setData).catch((e) => setError(e.message));
  }, [examId, question.id]);

  const showCorrectness = !GRADED_TYPES.has(question.type);

  return (
    <Modal title={t("aitem.responsesTitle")} onClose={onClose}>
      <p className="mt-1 text-sm font-medium">{question.prompt || t("aitem.noPrompt")}</p>
      {error && <ErrorBanner className="mt-3">{error}</ErrorBanner>}
      {!data && !error && <TableSkeleton rows={4} cells={2} avatar={false} />}
      {data && (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
            <span>{t("aitem.responsesSummary", { answered: data.answered, total: data.total })}</span>
            {showCorrectness && data.question.correctAnswer && <span>{t("aitem.correctAnswerLabel")}: <span className="font-medium text-[var(--fg)]">{data.question.correctAnswer}</span></span>}
          </div>
          <div className="mt-4 max-h-[55vh] space-y-2 overflow-y-auto pr-1">
            {data.responses.length === 0 && <p className="py-6 text-center text-sm text-[var(--muted)]">{t("aitem.responsesEmpty")}</p>}
            {data.responses.map((r) => (
              <div key={r.attemptId} className="rounded-lg border border-[var(--border)] bg-[var(--card-2)] p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{r.candidateName}</span>
                  <div className="flex items-center gap-1.5">
                    {r.needsReview && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-500">{t("aitem.needsReview")}</span>}
                    {r.answered && !r.needsReview && showCorrectness && (
                      <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-semibold", r.correct ? "bg-emerald-500/15 text-emerald-500" : "bg-rose-500/15 text-rose-500")}>
                        {r.correct ? "✓" : "✕"} {t("aitem.pointsAwarded", { awarded: r.awardedPoints, points: question.points })}
                      </span>
                    )}
                    {r.answered && !showCorrectness && (
                      <span className="rounded-full bg-[var(--card)] px-2 py-0.5 text-[11px] font-semibold text-[var(--muted)]">{t("aitem.pointsAwarded", { awarded: r.awardedPoints, points: question.points })}</span>
                    )}
                  </div>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-sm">
                  {r.answered ? r.answer : <span className="italic text-[var(--muted)]">{t("aitem.notAnswered")}</span>}
                </p>
                {r.feedback && <p className="mt-1.5 border-t border-[var(--border)] pt-1.5 text-xs text-[var(--muted)]">{r.feedback}</p>}
              </div>
            ))}
          </div>
        </>
      )}
      <div className="mt-5 flex justify-end">
        <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--fg)]">{t("aitem.close")}</button>
      </div>
    </Modal>
  );
}
