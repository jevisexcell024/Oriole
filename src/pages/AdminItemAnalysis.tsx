import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2, ArrowLeft, BarChart3, Users, Activity } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column, type TableFilter } from "@/components/DataTable";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { clsx } from "clsx";

interface Distractor { option: string; picks: number; pct: number; correct: boolean }
interface Item {
  id: string; prompt: string; type: string; points: number; sectionId: string | null;
  answered: number; correct: number; correctRate: number | null; avgPoints: number | null;
  difficulty: "easy" | "medium" | "hard" | null; discrimination: number | null;
  distractors: Distractor[] | null;
}
interface Resp { exam: { id: string; title: string; code: string }; attempts: number; items: Item[]; alpha: number | null; }

const TYPE_LABEL: Record<string, string> = { mcq: "MCQ", multi_select: "Multi", true_false: "T/F", short: "Text", numeric: "Numeric", essay: "Essay", code: "Code", matching: "Match", ordering: "Order", cloze: "Cloze", hotspot: "Hotspot", file_upload: "File" };
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

export function AdminItemAnalysis() {
  const t = useT();
  const { examId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.get<Resp>(`/admin/exams/${examId}/item-analysis`).then(setData).catch((e) => setError(e.message)); }, [examId]);

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
  ];

  const filters: TableFilter<Item>[] = [
    { id: "diff", label: t("aitem.allDifficulties"), options: [{ value: "easy", label: t("aitem.easy") }, { value: "medium", label: t("aitem.medium") }, { value: "hard", label: t("aitem.hard") }], match: (i, v) => i.difficulty === v },
    { id: "type", label: t("aitem.allTypes"), options: Object.entries(TYPE_LABEL).map(([v, l]) => ({ value: v, label: l })), match: (i, v) => i.type === v },
  ];

  return (
    <AdminShell wide>
      <div className="fade-in max-w-[1100px]">
        <PageHeader
          title={<span className="inline-flex items-center gap-2"><BarChart3 className="h-6 w-6" /> {t("aitem.title")}</span>}
          subtitle={data ? `${data.exam.title}${data.exam.code ? ` · ${data.exam.code}` : ""}` : t("aitem.subtitleFallback")}
          actions={<button onClick={() => navigate("/admin/results")} className="btn btn-ghost-teal"><ArrowLeft className="h-4 w-4" /> {t("aitem.backResults")}</button>}
        />

        {error && <p className="mt-6 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</p>}
        {!data && !error && <div className="mt-8 flex items-center gap-2 text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}</div>}

        {data && (
          <>
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
      </div>
    </AdminShell>
  );
}
