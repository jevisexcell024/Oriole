import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus, FileText, Loader2, Search, ArrowUpRight, Clock, CalendarClock, ClipboardCheck,
  BookOpen, LayoutGrid, List, ArrowLeft, CheckCircle2, PencilLine, Library, SlidersHorizontal,
  ListChecks, ToggleLeft, Type as TypeIcon, CheckSquare, Hash, Code as CodeIcon, Trash2,
  ArrowLeftRight, ListOrdered, MousePointerClick, Upload, TextCursorInput, Copy, Calculator, Headphones,
} from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { PageHeader } from "@/components/PageHeader";
import { api } from "@/lib/api";
import { useT, type TFn } from "@/lib/i18n";
import type { Exam, Question, QuestionType } from "@shared/types";
import { clsx } from "clsx";

const G = { btn: "#111110", accent: "#c6ff34" };
const STATUS_KEY: Record<string, string> = { published: "aex.statusPublished", draft: "aex.statusDraft" };

interface ExamRow {
  id: string; title: string; code: string; status: string; className: string | null;
  scheduledStart: string | null; durationMinutes: number; marks: number; questionCount: number; type: string;
  subject: string | null; coverImage: string | null;
}
interface Overview { exams: ExamRow[] }

const TYPE_TABS = [
  { id: "all", labelKey: "alib.allTypes" },
  { id: "shorts", labelKey: "aex.tabShorts" },
  { id: "mcq", labelKey: "aex.mcq" },
  { id: "written", labelKey: "aex.tabWritten" },
  { id: "viva", labelKey: "aex.viva" },
] as const;

const STATUS_TABS = [
  { id: "all", labelKey: "alib.statAll" },
  { id: "published", labelKey: "aex.statusPublished" },
  { id: "draft", labelKey: "aex.statusDraft" },
] as const;

const SORTS = [
  { id: "recent", labelKey: "alib.sortRecent" },
  { id: "title", labelKey: "alib.sortTitle" },
  { id: "questions", labelKey: "alib.sortQuestions" },
  { id: "marks", labelKey: "alib.sortMarks" },
] as const;

const fmtDur = (m: number, t: TFn) => (m >= 60 ? t(m >= 120 ? "aex.durHrs" : "aex.durHr", { n: Math.round((m / 60) * 10) / 10 }) : t("aex.durMin", { m }));
const fmtWhen = (iso: string | null, t: TFn) => (iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : t("aex.notScheduled"));

export function AdminExamLibrary() {
  const t = useT();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"exams" | "questions">("exams");
  const [data, setData] = useState<Overview | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => { api.get<Overview>("/admin/exams-overview").then(setData).catch(() => setData(null)); }, []);

  const create = async () => {
    setCreating(true);
    try { const { exam } = await api.post<{ exam: Exam }>("/admin/exams", {}); navigate(`/admin/exams/${exam.id}`); }
    finally { setCreating(false); }
  };

  const duplicate = async (id: string) => {
    try { const { exam } = await api.post<{ exam: Exam }>(`/admin/exams/${id}/duplicate`); navigate(`/admin/exams/${exam.id}`); }
    catch (e) { alert((e as Error).message); }
  };

  const deleteExam = async (id: string, title: string) => {
    if (!confirm(`Delete "${title || "Untitled exam"}"?\n\nThis will permanently remove all questions, registrations, and attempt records for this exam. This cannot be undone.`)) return;
    setData((prev) => prev ? { exams: prev.exams.filter((e) => e.id !== id) } : prev);
    try { await api.del(`/admin/exams/${id}`); }
    catch (e) {
      alert((e as Error).message);
      // Restore if the delete failed
      api.get<Overview>("/admin/exams-overview").then(setData).catch(() => {});
    }
  };

  return (
    <AdminShell wide>
      <div className="fade-in">
        <PageHeader
          title={<span className="inline-flex items-center gap-2"><Library className="h-6 w-6" /> {t("alib.title")}</span>}
          subtitle={t("alib.subtitle")}
          actions={
            <>
              <button onClick={() => navigate("/admin/exams")} className="btn btn-ghost-teal"><ArrowLeft className="h-4 w-4" /> {t("alib.backConsole")}</button>
              <button onClick={create} disabled={creating} className="btn btn-on-teal disabled:opacity-60">
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {t("aex.addNew")}
              </button>
            </>
          }
        />

        {/* Exams / Questions switch */}
        <div className="mb-4 inline-flex rounded-full border border-[var(--border)] bg-[var(--card-2)] p-1">
          {([["exams", t("alib.exams"), BookOpen], ["questions", t("alib.questions"), ListChecks]] as const).map(([id, label, Icon]) => (
            <button key={id} onClick={() => setMode(id as "exams" | "questions")}
              className={clsx("inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold transition", mode === id ? "text-white" : "text-[var(--muted)] hover:text-[var(--fg)]")}
              style={mode === id ? { background: G.btn } : undefined}>
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>

        {mode === "exams"
          ? <ExamsView data={data} onCreate={create} creating={creating} onOpen={(id) => navigate(`/admin/exams/${id}`)} onDuplicate={duplicate} onDelete={deleteExam} />
          : <QuestionsView />}
      </div>
    </AdminShell>
  );
}

/* ───────────────────────── Exams view ───────────────────────── */

function ExamsView({ data, onCreate, creating, onOpen, onDuplicate, onDelete }: { data: Overview | null; onCreate: () => void; creating: boolean; onOpen: (id: string) => void; onDuplicate: (id: string) => void; onDelete: (id: string, title: string) => void }) {
  const t = useT();
  const [tab, setTab] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [sort, setSort] = useState<string>("recent");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");

  const counts = useMemo(() => {
    const ex = data?.exams ?? [];
    return {
      total: ex.length,
      published: ex.filter((e) => e.status === "published").length,
      draft: ex.filter((e) => e.status !== "published").length,
      scheduled: ex.filter((e) => e.scheduledStart).length,
    };
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    const rows = data.exams
      .filter((e) => tab === "all" || e.type === tab)
      .filter((e) => status === "all" || (status === "published" ? e.status === "published" : e.status !== "published"))
      .filter((e) => !q || e.title.toLowerCase().includes(q) || (e.code ?? "").toLowerCase().includes(q) || (e.subject ?? "").toLowerCase().includes(q));
    const sorted = [...rows];
    switch (sort) {
      case "title": sorted.sort((a, b) => (a.title || "Untitled").localeCompare(b.title || "Untitled")); break;
      case "questions": sorted.sort((a, b) => b.questionCount - a.questionCount); break;
      case "marks": sorted.sort((a, b) => b.marks - a.marks); break;
      default: sorted.sort((a, b) => {
        const ta = a.scheduledStart ? Date.parse(a.scheduledStart) : -Infinity;
        const tb = b.scheduledStart ? Date.parse(b.scheduledStart) : -Infinity;
        return tb - ta;
      });
    }
    return sorted;
  }, [data, tab, status, sort, search]);

  return (
    <>
      {/* Summary chips */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("aex.statTotalExams")} value={counts.total} icon={BookOpen} tint={G.accent} />
        <Stat label={t("aex.statusPublished")} value={counts.published} icon={CheckCircle2} tint="#16A34A" />
        <Stat label={t("alib.statDrafts")} value={counts.draft} icon={PencilLine} tint="#E9B949" />
        <Stat label={t("alib.statScheduled")} value={counts.scheduled} icon={CalendarClock} tint="#0EA5E9" />
      </div>

      {/* Toolbar */}
      <div className="card rounded-2xl p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card-2)] px-3.5 py-2">
            <Search className="h-4 w-4 text-[var(--muted)]" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("alib.searchExams")} className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--muted)]" />
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <SlidersHorizontal className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
              <select value={sort} onChange={(e) => setSort(e.target.value)} className="h-10 rounded-full border border-[var(--border)] bg-[var(--card-2)] pl-9 pr-8 text-sm font-medium outline-none">
                {SORTS.map((s) => <option key={s.id} value={s.id}>{t(s.labelKey)}</option>)}
              </select>
            </div>
            <div className="flex rounded-full border border-[var(--border)] bg-[var(--card-2)] p-1">
              <button onClick={() => setView("grid")} title={t("alib.gridView")} className={clsx("flex h-8 w-8 items-center justify-center rounded-full transition", view === "grid" ? "text-white" : "text-[var(--muted)]")} style={view === "grid" ? { background: G.btn } : undefined}><LayoutGrid className="h-4 w-4" /></button>
              <button onClick={() => setView("list")} title={t("alib.listView")} className={clsx("flex h-8 w-8 items-center justify-center rounded-full transition", view === "list" ? "text-white" : "text-[var(--muted)]")} style={view === "list" ? { background: G.btn } : undefined}><List className="h-4 w-4" /></button>
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex flex-wrap gap-1.5">
            {TYPE_TABS.map((tb) => (
              <button key={tb.id} onClick={() => setTab(tb.id)}
                className={clsx("rounded-full border px-3 py-1.5 text-xs font-semibold transition", tab === tb.id ? "text-white" : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)]")}
                style={tab === tb.id ? { background: G.btn, borderColor: G.btn } : undefined}>
                {t(tb.labelKey)}
              </button>
            ))}
          </div>
          <span className="hidden h-5 w-px bg-[var(--border)] sm:block" />
          <div className="flex flex-wrap gap-1.5">
            {STATUS_TABS.map((s) => (
              <button key={s.id} onClick={() => setStatus(s.id)}
                className={clsx("rounded-full border px-3 py-1.5 text-xs font-semibold transition", status === s.id ? "border-transparent text-white" : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)]")}
                style={status === s.id ? { background: G.accent, color: G.btn } : undefined}>
                {t(s.labelKey)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Results */}
      {!data ? (
        <div className="flex items-center gap-2 py-16 text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> {t("alib.loadingLibrary")}</div>
      ) : filtered.length === 0 ? (
        <div className="mt-4 card rounded-2xl py-16 text-center">
          <FileText className="mx-auto h-8 w-8 text-[var(--muted)]" />
          <p className="mt-2 text-sm text-[var(--muted)]">{search || tab !== "all" || status !== "all" ? t("alib.noMatchFilters") : t("alib.noExamsLib")}</p>
          <button onClick={onCreate} disabled={creating} className="mx-auto mt-4 inline-flex items-center gap-1.5 rounded-[6px] px-4 py-2 text-sm font-semibold text-white" style={{ background: G.btn }}><Plus className="h-4 w-4" /> {t("aex.addNew")}</button>
        </div>
      ) : (
        <>
          <p className="mb-3 mt-4 text-xs text-[var(--muted)]">{t("alib.showingExams", { n: filtered.length })}</p>

          {view === "grid" ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filtered.map((e) => <ExamCard key={e.id} e={e} onOpen={() => onOpen(e.id)} onDuplicate={() => onDuplicate(e.id)} onDelete={() => onDelete(e.id, e.title)} />)}
            </div>
          ) : (
            <div className="card overflow-hidden rounded-2xl">
              <div className="hidden grid-cols-[1.6fr_0.8fr_0.8fr_0.7fr_0.5fr_auto] gap-3 border-b border-[var(--border)] bg-[var(--card-2)] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)] md:grid">
                <span>{t("alib.colExam")}</span><span>{t("alib.colSchedule")}</span><span>{t("alib.colDuration")}</span><span>{t("alib.colQuestions")}</span><span>{t("alib.colMarks")}</span><span className="text-right">{t("alib.colOpen")}</span>
              </div>
              {filtered.map((e) => <ExamListRow key={e.id} e={e} onOpen={() => onOpen(e.id)} onDuplicate={() => onDuplicate(e.id)} onDelete={() => onDelete(e.id, e.title)} />)}
            </div>
          )}
        </>
      )}
    </>
  );
}

/* ──────────────────────── Questions view ─────────────────────── */

type BankQuestion = Question & { examTitle: string; examCode: string; examStatus: string };

const Q_TYPE_LABEL: Record<QuestionType, string> = {
  mcq: "aqt.mcq", multi_select: "aqt.multi_select", true_false: "aqt.true_false",
  short: "aqt.short", numeric: "aqt.numeric", essay: "aqt.essay", code: "aqt.code",
  matching: "aqt.matching", ordering: "aqt.ordering", cloze: "aqt.cloze", hotspot: "aqt.hotspot", file_upload: "aqt.file_upload",
  parameterized: "aqt.parameterized", media_comprehension: "aqt.media_comprehension",
};
const Q_TYPE_ICON: Record<QuestionType, typeof ListChecks> = {
  mcq: ListChecks, multi_select: CheckSquare, true_false: ToggleLeft,
  short: TypeIcon, numeric: Hash, essay: FileText, code: CodeIcon,
  matching: ArrowLeftRight, ordering: ListOrdered, cloze: TextCursorInput, hotspot: MousePointerClick, file_upload: Upload,
  parameterized: Calculator, media_comprehension: Headphones,
};

function QuestionsView() {
  const t = useT();
  const [questions, setQuestions] = useState<BankQuestion[] | null>(null);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | QuestionType>("all");
  const [examFilter, setExamFilter] = useState("all");

  useEffect(() => { api.get<{ questions: BankQuestion[] }>("/admin/questions").then((d) => setQuestions(d.questions)).catch(() => setQuestions([])); }, []);

  const exams = useMemo(() => {
    const m = new Map<string, string>();
    (questions ?? []).forEach((q) => m.set(q.examId, q.examTitle));
    return [...m.entries()];
  }, [questions]);

  const filtered = (questions ?? []).filter((q) => {
    if (typeFilter !== "all" && q.type !== typeFilter) return false;
    if (examFilter !== "all" && q.examId !== examFilter) return false;
    if (query.trim() && !q.prompt.toLowerCase().includes(query.trim().toLowerCase())) return false;
    return true;
  });

  const byType = (t: QuestionType) => (questions ?? []).filter((q) => q.type === t).length;

  const remove = async (id: string) => {
    const prev = questions;
    setQuestions((qs) => (qs ?? []).filter((q) => q.id !== id));
    try {
      await api.del(`/admin/questions/${id}`);
    } catch {
      setQuestions(prev); // restore — never silently drop a row that wasn't deleted
      alert(t("alib.couldNotDelete"));
    }
  };

  if (!questions) return <div className="flex items-center gap-2 py-16 text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> {t("alib.loadingQuestions")}</div>;

  return (
    <>
      {/* Summary chips */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("alib.statTotalQuestions")} value={questions.length} icon={Library} tint={G.accent} />
        <Stat label={t("aqt.mcq")} value={byType("mcq")} icon={ListChecks} tint="#16A34A" />
        <Stat label={t("aqt.true_false")} value={byType("true_false")} icon={ToggleLeft} tint="#0EA5E9" />
        <Stat label={t("aqt.short")} value={byType("short")} icon={TypeIcon} tint="#E9B949" />
      </div>

      {/* Toolbar — same look as the Exams view */}
      <div className="card rounded-2xl p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card-2)] px-3.5 py-2">
            <Search className="h-4 w-4 text-[var(--muted)]" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("alib.searchQuestion")} className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--muted)]" />
          </div>
          <div className="flex items-center gap-2">
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)} className="h-10 rounded-full border border-[var(--border)] bg-[var(--card-2)] px-4 text-sm font-medium outline-none">
              <option value="all">{t("alib.allTypes")}</option>
              <option value="mcq">{t("aqt.mcq")}</option>
              <option value="multi_select">{t("aqt.multi_select")}</option>
              <option value="true_false">{t("aqt.true_false")}</option>
              <option value="short">{t("aqt.short")}</option>
              <option value="numeric">{t("aqt.numeric")}</option>
              <option value="essay">{t("aqt.essay")}</option>
              <option value="code">{t("aqt.code")}</option>
              <option value="matching">{t("aqt.matching")}</option>
              <option value="ordering">{t("aqt.ordering")}</option>
              <option value="cloze">{t("aqt.cloze")}</option>
              <option value="hotspot">{t("aqt.hotspot")}</option>
              <option value="file_upload">{t("aqt.file_upload")}</option>
            </select>
            <select value={examFilter} onChange={(e) => setExamFilter(e.target.value)} className="h-10 max-w-[220px] rounded-full border border-[var(--border)] bg-[var(--card-2)] px-4 text-sm font-medium outline-none">
              <option value="all">{t("alib.allExamsOpt")}</option>
              {exams.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* List */}
      <p className="mb-3 mt-4 text-xs text-[var(--muted)]">{t("alib.showingQuestions", { n: filtered.length })}</p>
      <div className="card overflow-hidden rounded-2xl">
        {filtered.length === 0 ? (
          <p className="p-10 text-center text-sm text-[var(--muted)]">{t("alib.noQuestionsMatch")}</p>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {filtered.map((q) => {
              const Icon = Q_TYPE_ICON[q.type];
              return (
                <div key={q.id} className="flex items-start gap-4 px-5 py-4 hover:bg-[var(--card-2)]">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: "rgba(198,255,52,0.14)", color: G.accent }}>
                    <Icon className="h-[18px] w-[18px]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{q.prompt || <span className="text-[var(--muted)]">{t("aitem.noPrompt")}</span>}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
                      <span className="rounded-full bg-[var(--bg)] px-2 py-0.5 font-medium">{t(Q_TYPE_LABEL[q.type])}</span>
                      <span>{t("alib.ptsN", { n: q.points })}</span>
                      <span>· {q.examTitle}</span>
                      {q.correctAnswer && <span className="text-emerald-400">✓ {q.correctAnswer}</span>}
                    </div>
                  </div>
                  <span className={clsx("mt-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                    q.examStatus === "published" ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400")}>
                    {t(STATUS_KEY[q.examStatus] ?? q.examStatus)}
                  </span>
                  <button onClick={() => remove(q.id)} title={t("alib.deleteQuestion")} className="mt-0.5 rounded-lg p-2 text-[var(--muted)] hover:bg-rose-500/15 hover:text-rose-400">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

/* ───────────────────────── Shared pieces ───────────────────────── */

function StatusPill({ status }: { status: string }) {
  const t = useT();
  const published = status === "published";
  return (
    <span className={clsx("rounded-full px-2 py-0.5 text-[10px] font-semibold", published ? "text-white" : "border border-[var(--border)] text-[var(--muted)]")} style={published ? { background: G.btn } : undefined}>{t(STATUS_KEY[status] ?? status)}</span>
  );
}

function ExamCard({ e, onOpen, onDuplicate, onDelete }: { e: ExamRow; onOpen: () => void; onDuplicate: () => void; onDelete: () => void }) {
  const t = useT();
  return (
    <div className="group card flex flex-col overflow-hidden transition hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:shadow-lg">
      {e.coverImage
        ? <div className="relative h-28 w-full"><img src={e.coverImage} alt="" className="h-full w-full object-cover" /><span className="absolute right-2 top-2"><StatusPill status={e.status} /></span></div>
        : <div className="flex h-28 w-full items-center justify-center" style={{ background: "rgba(198,255,52,0.12)" }}><BookOpen className="h-9 w-9" style={{ color: G.accent }} /></div>}
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ background: "rgba(198,255,52,0.14)", color: G.accent }}>{e.type}</span>
          {!e.coverImage && <StatusPill status={e.status} />}
        </div>
        <h3 className="mt-2.5 font-semibold leading-snug">{e.title || t("aex.untitled")}</h3>
        <p className="mt-0.5 text-xs text-[var(--muted)]">{e.subject || e.code || t("acls.noCode")}{e.className ? ` · ${e.className}` : ""}</p>
        <div className="mt-3 space-y-1.5 text-[11px] text-[var(--muted)]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1.5"><CalendarClock className="h-3.5 w-3.5" /> {fmtWhen(e.scheduledStart, t)}</span>
            <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> {fmtDur(e.durationMinutes, t)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" /> {t("prac.questions", { n: e.questionCount })}</span>
            <span className="inline-flex items-center gap-1.5"><ClipboardCheck className="h-3.5 w-3.5" /> {t("aex.marksN", { n: e.marks })}</span>
          </div>
        </div>
        <div className="mt-auto flex items-center gap-2 pt-4">
          <button onClick={onOpen} className="btn btn-primary flex-1 justify-center">{t("alib.openExam")} <ArrowUpRight className="h-4 w-4" /></button>
          <button onClick={onDuplicate} title={t("alib.duplicate")} className="btn btn-outline h-9 shrink-0 px-2.5"><Copy className="h-4 w-4" /></button>
          <button onClick={onDelete} title="Delete exam" className="btn btn-outline h-9 shrink-0 px-2.5 hover:border-rose-500/40 hover:bg-rose-500/15 hover:text-rose-400"><Trash2 className="h-4 w-4" /></button>
        </div>
      </div>
    </div>
  );
}

function ExamListRow({ e, onOpen, onDuplicate, onDelete }: { e: ExamRow; onOpen: () => void; onDuplicate: () => void; onDelete: () => void }) {
  const t = useT();
  return (
    <div className="grid grid-cols-1 items-center gap-3 border-b border-[var(--border)] px-4 py-3 last:border-0 transition hover:bg-[var(--card-2)] md:grid-cols-[1.6fr_0.8fr_0.8fr_0.7fr_0.5fr_auto]">
      <div className="flex min-w-0 items-center gap-3">
        {e.coverImage
          ? <img src={e.coverImage} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
          : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" style={{ background: "rgba(198,255,52,0.14)", color: G.accent }}><BookOpen className="h-5 w-5" /></span>}
        <div className="min-w-0">
          <div className="flex items-center gap-2"><p className="truncate font-semibold">{e.title || t("aex.untitled")}</p><StatusPill status={e.status} /></div>
          <p className="truncate text-xs text-[var(--muted)]">{e.subject || e.code || t("acls.noCode")}{e.className ? ` · ${e.className}` : ""}</p>
        </div>
      </div>
      <span className="text-xs text-[var(--muted)]"><span className="md:hidden">{t("alib.scheduleLbl")}</span>{fmtWhen(e.scheduledStart, t)}</span>
      <span className="text-xs text-[var(--muted)]"><span className="md:hidden">{t("alib.durationLbl")}</span>{fmtDur(e.durationMinutes, t)}</span>
      <span className="text-xs text-[var(--muted)]">{t("alib.qShort", { n: e.questionCount })}</span>
      <span className="text-xs text-[var(--muted)]">{t("aex.marksN", { n: e.marks })}</span>
      <div className="flex items-center gap-1.5 md:justify-end">
        <button onClick={onDelete} title="Delete exam" className="btn btn-outline inline-flex h-9 px-2.5 hover:border-rose-500/40 hover:bg-rose-500/15 hover:text-rose-400"><Trash2 className="h-4 w-4" /></button>
        <button onClick={onDuplicate} title={t("alib.duplicate")} className="btn btn-outline inline-flex h-9 px-2.5"><Copy className="h-4 w-4" /></button>
        <button onClick={onOpen} className="btn btn-primary inline-flex h-9"><span>{t("alib.open")}</span> <ArrowUpRight className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

function Stat({ label, value, icon: Icon, tint }: { label: string; value: number; icon: typeof BookOpen; tint: string }) {
  return (
    <div className="card rounded-xl p-3.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-[var(--muted)]">{label}</span>
        <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: `${tint}22`, color: tint }}><Icon className="h-4 w-4" /></span>
      </div>
      <div className="stat-num mt-2 font-display text-2xl font-semibold leading-none">{value}</div>
    </div>
  );
}
