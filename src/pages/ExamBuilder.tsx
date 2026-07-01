import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, Eye, Send, Plus, Trash2, Copy, ChevronUp, ChevronDown, ChevronRight, Check,
  Circle, X, CircleDot, ListChecks, ToggleLeft, Type as TypeIcon, AlertTriangle,
  Users, Globe, Lock, UserCheck, ShieldAlert, Shuffle, CheckSquare, Square, Hash, FileText,
  Code as CodeIcon, Target, Layers, GripVertical, Bold, Italic, Underline, List, Image as ImageIcon,
  Save, Loader2, Settings as SettingsIcon, ListTree, ArrowLeftRight, ListOrdered, MousePointerClick,
  Upload, TextCursorInput, Tag, Library, Search, BookmarkPlus, Sparkles, Clock, Calculator,
} from "lucide-react";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Skeleton } from "@/components/ui";
import { MathText } from "@/lib/richtext";
import { parseTableFile, IMPORT_ACCEPT } from "@/lib/importTable";
import { DEFAULT_GRADE_BANDS } from "@shared/grades";
import { tryEvalExpr } from "@shared/expr";
import type { Exam, LockdownConfig, Question, QuestionType, RubricCriterion } from "@shared/types";
import { clsx } from "clsx";

type SaveStatus = "idle" | "saving" | "saved";
type Tab = "structure" | "settings" | "proctoring";

const G = { accent: "#c6ff34", deep: "#111110" };

const LOCKDOWN_RULES: { key: Exclude<keyof LockdownConfig, "violationLimit">; label: string; desc: string }[] = [
  { key: "fullscreen", label: "Fullscreen lock", desc: "Block the exam when fullscreen is exited." },
  { key: "blockCopyPaste", label: "Block copy / paste", desc: "Disable copy, paste, selection, right-click." },
  { key: "blockShortcuts", label: "Block shortcuts", desc: "Devtools, print, save, view-source." },
  { key: "tabSwitchDetection", label: "Tab-switch detection", desc: "Flag focus loss and tab changes." },
  { key: "blockSecondScreen", label: "Block second screen", desc: "Lock the exam when an extra monitor is detected (single-display only). Off = flag only." },
  { key: "webcam", label: "Require webcam", desc: "Camera required to start and during the exam." },
  { key: "faceMonitoring", label: "Face monitoring", desc: "Continuous face-presence checks." },
  { key: "requireIdentity", label: "Identity check", desc: "Collect student / registration no. at check-in." },
  { key: "requireIdDocument", label: "Photo-ID capture", desc: "Candidate submits a photo ID for the proctor to verify." },
  { key: "audioMonitoring", label: "Audio monitoring", desc: "Flag sustained talking / background noise during the exam." },
  { key: "requireRoomScan", label: "Room scan", desc: "Capture a short webcam room scan at check-in." },
  { key: "requireAgreement", label: "Rules agreement", desc: "Require accepting rules & policies." },
];

const TYPE_META: Record<QuestionType, { label: string; short: string; icon: typeof Circle }> = {
  mcq: { label: "Multiple Choice (MCQ)", short: "MCQ", icon: ListChecks },
  multi_select: { label: "Multi-select", short: "Multi", icon: CheckSquare },
  true_false: { label: "True / False", short: "T/F", icon: ToggleLeft },
  short: { label: "Short Text", short: "Text", icon: TypeIcon },
  numeric: { label: "Numeric", short: "Numeric", icon: Hash },
  essay: { label: "Descriptive", short: "Descriptive", icon: FileText },
  code: { label: "Code", short: "Code", icon: CodeIcon },
  matching: { label: "Matching", short: "Match", icon: ArrowLeftRight },
  ordering: { label: "Ordering / Sequence", short: "Order", icon: ListOrdered },
  cloze: { label: "Fill in the blank", short: "Cloze", icon: TextCursorInput },
  hotspot: { label: "Image Hotspot", short: "Hotspot", icon: MousePointerClick },
  file_upload: { label: "File Upload", short: "File", icon: Upload },
  parameterized: { label: "Parameterized (Math)", short: "Math", icon: Calculator },
};

const DIFFICULTIES = [
  { id: "easy", label: "Easy", color: "#16A34A" },
  { id: "medium", label: "Medium", color: "#E9B949" },
  { id: "hard", label: "Hard", color: "#DC2626" },
] as const;

const fmtDur = (m: number) => (m >= 60 ? `${Math.round((m / 60) * 10) / 10} hr` : `${m} min`);

export function ExamBuilder() {
  const { examId } = useParams();
  const navigate = useNavigate();
  const t = useT();
  const [exam, setExam] = useState<Exam | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("structure");
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [preview, setPreview] = useState(false);
  const [publishErrors, setPublishErrors] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [audienceMsg, setAudienceMsg] = useState<string | null>(null);
  const [classesAll, setClassesAll] = useState<{ id: string; name: string; members: number }[]>([]);
  const [assignedClasses, setAssignedClasses] = useState<{ id: string; name: string; members: number; scheduledStart: string | null }[]>([]);
  const [pickClass, setPickClass] = useState("");
  const [pickWhen, setPickWhen] = useState("");
  const [bankOpen, setBankOpen] = useState(false);
  const [aiOn, setAiOn] = useState(false);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pending = useRef<Record<string, Record<string, unknown>>>({});

  useEffect(() => {
    api.get<{ exam: Exam; questions: Question[]; aiEnabled?: boolean }>(`/admin/exams/${examId}`)
      .then((d) => { setExam(d.exam); setQuestions(d.questions); setActiveId(d.questions[0]?.id ?? null); setAiOn(!!d.aiEnabled); })
      .catch((e) => setError(e.message));
    api.get<{ classes: { id: string; name: string; members: number }[] }>("/admin/classes")
      .then((d) => setClassesAll(d.classes)).catch(() => {});
    api.get<{ classes: typeof assignedClasses }>(`/admin/exams/${examId}/classes`)
      .then((d) => setAssignedClasses(d.classes)).catch(() => {});
  }, [examId]);

  const assignClass = async () => {
    if (!pickClass) return;
    setAudienceMsg(null);
    try {
      await api.post(`/admin/classes/${pickClass}/assign-exam`, {
        examId,
        scheduledStart: pickWhen ? new Date(pickWhen).toISOString() : null,
      });
      setPickClass(""); setPickWhen("");
      const d = await api.get<{ classes: typeof assignedClasses }>(`/admin/exams/${examId}/classes`);
      setAssignedClasses(d.classes);
    } catch (e) { setAudienceMsg((e as Error).message); }
  };

  const flag = (fn: () => Promise<unknown>) => {
    setStatus("saving");
    return fn().then(() => setStatus("saved")).catch(() => setStatus("idle"));
  };
  const debounce = (key: string, fn: () => void, ms = 600) => {
    setStatus("saving");
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(fn, ms);
  };
  const queueSave = (key: string, url: string, partial: Record<string, unknown>) => {
    pending.current[key] = { ...(pending.current[key] ?? {}), ...partial };
    debounce(key, () => {
      const body = pending.current[key];
      delete pending.current[key];
      void flag(() => api.patch(url, body));
    });
  };
  // Force-flush every pending debounced write immediately (used by Save Draft / Save Question).
  const flushSaves = async () => {
    const keys = Object.keys(pending.current);
    if (keys.length === 0) { setStatus("saved"); return; }
    for (const key of keys) {
      clearTimeout(timers.current[key]);
      const body = pending.current[key];
      delete pending.current[key];
      const url = key === "exam" ? `/admin/exams/${examId}` : `/admin/questions/${key}`;
      await flag(() => api.patch(url, body));
    }
  };

  const patchExam = (partial: Partial<Exam>) => {
    setExam((e) => (e ? { ...e, ...partial } : e));
    queueSave("exam", `/admin/exams/${examId}`, partial);
  };
  const patchQuestion = (id: string, partial: Partial<Question>) => {
    setQuestions((qs) => qs.map((q) => (q.id === id ? { ...q, ...partial } : q)));
    queueSave(id, `/admin/questions/${id}`, partial);
  };

  const addQuestion = async (sectionId: string | null) => {
    const { question } = await api.post<{ question: Question }>(`/admin/exams/${examId}/questions`, { type: "mcq" });
    let q = question;
    if (sectionId) { await api.patch(`/admin/questions/${question.id}`, { sectionId }); q = { ...question, sectionId }; }
    setQuestions((qs) => [...qs, q]);
    setActiveId(q.id);
    setTab("structure");
    setStatus("saved");
    setPublishErrors([]);
  };

  // Pick-from-bank: clone selected bank questions into this exam.
  const cloneFromBank = async (ids: string[]) => {
    if (!ids.length) return;
    const { created } = await api.post<{ created: Question[] }>(`/admin/exams/${examId}/questions/clone`, { questionIds: ids });
    setQuestions((qs) => [...qs, ...created]);
    if (created[0]) { setActiveId(created[0].id); setTab("structure"); }
    setBankOpen(false);
    setStatus("saved");
  };

  const changeType = async (id: string, type: QuestionType) => {
    const { question } = await api.patch<{ question: Question }>(`/admin/questions/${id}`, { type });
    setQuestions((qs) => qs.map((q) => (q.id === id ? question : q)));
  };

  const duplicate = async (q: Question) => {
    const { question } = await api.post<{ question: Question }>(`/admin/exams/${examId}/questions`, { type: q.type });
    const carry: Partial<Question> = {
      prompt: q.prompt, options: q.options, correctAnswer: q.correctAnswer, acceptedAnswers: q.acceptedAnswers,
      correctAnswers: q.correctAnswers, tolerance: q.tolerance, points: q.points, difficulty: q.difficulty, sectionId: q.sectionId,
      tags: q.tags, matchPairs: q.matchPairs, sequence: q.sequence, blanks: q.blanks, imageUrl: q.imageUrl, hotspots: q.hotspots,
      rubric: q.rubric, codeLanguage: q.codeLanguage, starterCode: q.starterCode, testCases: q.testCases,
    };
    await api.patch(`/admin/questions/${question.id}`, carry);
    const dup = { ...question, ...carry };
    setQuestions((qs) => {
      const idx = qs.findIndex((x) => x.id === q.id);
      const copy = [...qs];
      copy.splice(idx + 1, 0, dup);
      return copy;
    });
    setActiveId(dup.id);
  };

  const remove = async (id: string) => {
    setQuestions((qs) => {
      const next = qs.filter((q) => q.id !== id);
      if (activeId === id) setActiveId(next[0]?.id ?? null);
      return next;
    });
    await api.del(`/admin/questions/${id}`);
  };

  // Reorder a question within its display group (swap with the previous/next sibling).
  const moveInGroup = (groupItems: Question[], id: string, dir: -1 | 1) => {
    const gi = groupItems.findIndex((q) => q.id === id);
    const target = groupItems[gi + dir];
    if (!target) return;
    setQuestions((qs) => {
      const copy = [...qs];
      const a = copy.findIndex((q) => q.id === id);
      const b = copy.findIndex((q) => q.id === target.id);
      [copy[a], copy[b]] = [copy[b], copy[a]];
      void api.post(`/admin/exams/${examId}/questions/reorder`, { orderedIds: copy.map((q) => q.id) });
      return copy;
    });
  };

  const addSection = () => {
    const sections = exam?.sections ?? [];
    patchExam({ sections: [...sections, { id: Math.random().toString(36).slice(2, 8), title: `Section ${sections.length + 1}` }] });
  };
  const renameSection = (sid: string, title: string) =>
    patchExam({ sections: (exam?.sections ?? []).map((s) => (s.id === sid ? { ...s, title } : s)) });
  const deleteSection = (sid: string) =>
    patchExam({ sections: (exam?.sections ?? []).filter((s) => s.id !== sid) });
  const setSectionDraw = (sid: string, n: number | undefined) =>
    patchExam({ sections: (exam?.sections ?? []).map((s) => (s.id === sid ? { ...s, drawCount: n && n > 0 ? n : undefined } : s)) });
  const setSectionTime = (sid: string, n: number | undefined) =>
    patchExam({ sections: (exam?.sections ?? []).map((s) => (s.id === sid ? { ...s, timeLimitMinutes: n && n > 0 ? n : undefined } : s)) });

  const csvRef = useRef<HTMLInputElement>(null);
  const exportCsv = () => {
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const header = "type,prompt,options,correctAnswer,points";
    const lines = questions.map((q) => [q.type, q.prompt, (q.options ?? []).join("|"), q.correctAnswer ?? "", String(q.points)].map((c) => esc(String(c))).join(","));
    const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${exam?.code || "exam"}-questions.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    let rows: Record<string, string>[];
    try { rows = await parseTableFile(file); }
    catch { alert("Could not read that file. Use a CSV, Excel (.xlsx) or Word (.docx) file with a header row."); return; }
    if (!rows.length) { alert("No question rows found. Use columns: type, prompt (or question), options, correctAnswer (or correct answer), points (a header row is required; Word files should contain a table)."); return; }
    const mapped = rows.map((r) => ({
      type: r.type,
      prompt: r.prompt ?? r.question ?? r.stem ?? r["question stem"] ?? "",
      options: r.options,
      correctAnswer: r.correctanswer ?? r["correct answer"] ?? r.answer ?? "",
      points: r.points,
    }));
    try {
      const { created } = await api.post<{ created: number }>(`/admin/exams/${examId}/questions/import`, { questions: mapped });
      const d = await api.get<{ questions: Question[] }>(`/admin/exams/${examId}`);
      setQuestions(d.questions);
      alert(`Imported ${created} question${created === 1 ? "" : "s"}.`);
    } catch (err) { alert((err as Error).message); }
  };

  const publish = async () => {
    setPublishErrors([]);
    await flushSaves();
    const res = await fetch(`/api/admin/exams/${examId}/publish`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ publish: exam?.status !== "published" }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.exam) setExam(data.exam);
    else if (data?.errors) setPublishErrors(data.errors);
    else setPublishErrors([data?.error ?? "Could not publish."]);
  };

  if (error) return <div className="flex min-h-screen items-center justify-center text-rose-400">{error}</div>;
  if (!exam) return <BuilderSkeleton />;

  // ---- group questions by section for the structure tree ----
  const sections = exam.sections ?? [];
  const groups: { id: string | null; title: string; instructions?: string; drawCount?: number; timeLimitMinutes?: number; items: Question[] }[] = [
    ...sections.map((s) => ({ id: s.id, title: s.title, instructions: s.instructions, drawCount: s.drawCount, timeLimitMinutes: s.timeLimitMinutes, items: questions.filter((q) => q.sectionId === s.id) })),
  ];
  const orphans = questions.filter((q) => !q.sectionId || !sections.some((s) => s.id === q.sectionId));
  if (orphans.length || sections.length === 0) groups.push({ id: null, title: sections.length ? "General" : "Questions", items: orphans });

  const active = questions.find((q) => q.id === activeId) ?? null;
  const activeGroup = groups.find((g) => g.items.some((q) => q.id === activeId));
  const activeIndexInGroup = activeGroup ? activeGroup.items.findIndex((q) => q.id === activeId) : -1;

  const totalMarks = questions.reduce((s, q) => s + (q.points || 0), 0);

  return (
    <div className="flex h-screen flex-col bg-[var(--bg)]">
      {/* Top bar */}
      <header className="sticky top-0 z-30 shrink-0 border-b border-[var(--border)] bg-[var(--card)]">
        <div className="flex h-14 items-center justify-between gap-2 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link to="/admin/exams" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--card-2)] hover:text-[var(--fg)]" title={t("eb.backToExams")}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <h1 className="truncate text-base font-bold tracking-tight">{t("eb.title")}</h1>
            <span className={clsx("hidden shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold sm:inline",
              exam.status === "published" ? "bg-emerald-500/15 text-emerald-500" : "bg-amber-500/15 text-amber-500")}>
              {exam.status === "published" ? t("eb.published") : t("eb.draftMode")}
            </span>
          </div>
          <div className="flex items-center gap-2 sm:gap-2.5">
            <span className="hidden text-xs text-[var(--muted)] sm:inline">
              {status === "saving" ? t("eb.saving") : status === "saved" ? t("eb.allSaved") : ""}
            </span>
            <button className="btn btn-ghost h-9" onClick={() => setPreview((p) => !p)}>
              <Eye className="h-4 w-4" /> {preview ? t("eb.edit") : t("eb.preview")}
            </button>
            <button className="btn btn-outline h-9" onClick={flushSaves}><Save className="h-4 w-4" /> {t("eb.saveDraft")}</button>
            <button className="btn btn-primary h-9" onClick={publish}>
              <Send className="h-4 w-4" /> {exam.status === "published" ? t("eb.unpublish") : t("eb.publishExam")}
            </button>
          </div>
        </div>
      </header>

      {publishErrors.length > 0 && (
        <div className="shrink-0 border-b border-rose-500/30 bg-rose-500/10 px-6 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-rose-400"><AlertTriangle className="h-4 w-4" /> {t("eb.cantPublish")}</div>
          <ul className="mt-1 list-disc pl-6 text-xs text-rose-400">{publishErrors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}

      {preview ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
          <div className="mx-auto max-w-3xl"><PreviewView exam={exam} questions={questions} /></div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* Left panel */}
          <aside className="flex w-[300px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--card)]">
            {/* Tabs */}
            <div className="flex shrink-0 gap-4 border-b border-[var(--border)] px-4">
              {([["structure", t("eb.tabStructure")], ["settings", t("eb.tabSettings")], ["proctoring", t("eb.tabProctoring")]] as const).map(([id, label]) => (
                <button key={id} onClick={() => setTab(id)}
                  className={clsx("relative -mb-px border-b-2 py-3 text-[13px] font-semibold transition",
                    tab === id ? "border-[#c6ff34] text-[var(--fg)]" : "border-transparent text-[var(--muted)] hover:text-[var(--fg)]")}>
                  {label}
                </button>
              ))}
            </div>

            {/* Structure tree (always shown — it's the navigator) */}
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <StructureTree
                groups={groups}
                activeId={activeId}
                onSelect={(id) => { setActiveId(id); setTab("structure"); }}
                onAddQuestion={addQuestion}
                onAddSection={addSection}
                onRenameSection={renameSection}
                onDeleteSection={deleteSection}
                onSectionDraw={setSectionDraw}
                onSectionTime={setSectionTime}
                onMove={moveInGroup}
                onDelete={remove}
              />
              <button onClick={() => setBankOpen(true)} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[#c6ff34]/40 py-2 text-xs font-semibold text-[#c6ff34] hover:bg-[rgba(198,255,52,0.08)]">
                <Library className="h-3.5 w-3.5" /> {t("eb.pickFromBank")}
              </button>
              <div className="mt-3 flex items-center gap-2 border-t border-[var(--border)] pt-3">
                <button className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--muted)] hover:text-[var(--fg)]" onClick={() => csvRef.current?.click()} title={t("eb.importTooltip")}><FileText className="h-3.5 w-3.5" /> {t("eb.import")}</button>
                <span className="h-3 w-px bg-[var(--border)]" />
                <button className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--muted)] hover:text-[var(--fg)] disabled:opacity-40" onClick={exportCsv} disabled={questions.length === 0}><FileText className="h-3.5 w-3.5" /> {t("eb.exportCsv")}</button>
                <span className="h-3 w-px bg-[var(--border)]" />
                <a href="/templates/MCQ-Import-Template.docx" download className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--muted)] hover:text-[var(--fg)]" title="Download the MCQ import template (.docx)"><FileText className="h-3.5 w-3.5" /> Template</a>
                <input ref={csvRef} type="file" accept={IMPORT_ACCEPT} className="hidden" onChange={importCsv} />
              </div>
            </div>

            {/* Footer summary */}
            <div className="shrink-0 border-t border-[var(--border)] px-4 py-3 text-[11px] text-[var(--muted)]">
              {questions.length} question{questions.length === 1 ? "" : "s"} · {totalMarks} marks · {fmtDur(exam.durationMinutes)}
            </div>
          </aside>

          {/* Center workspace */}
          <main className="relative min-h-0 flex-1 overflow-y-auto bg-[var(--bg)]">
            {tab === "settings" ? (
              <div className="mx-auto max-w-3xl px-6 py-6">
                <SettingsPanel
                  exam={exam} questions={questions} patchExam={patchExam}
                  classesAll={classesAll} assignedClasses={assignedClasses} pickClass={pickClass}
                  setPickClass={setPickClass} pickWhen={pickWhen} setPickWhen={setPickWhen}
                  assignClass={assignClass} audienceMsg={audienceMsg}
                />
              </div>
            ) : tab === "proctoring" ? (
              <div className="mx-auto max-w-3xl px-6 py-6"><ProctoringPanel exam={exam} patchExam={patchExam} /></div>
            ) : active ? (
              <div className="mx-auto max-w-3xl px-6 py-6 pb-24">
                <QuestionEditor
                  key={active.id}
                  q={active}
                  exam={exam}
                  sectionTitle={activeGroup?.title ?? "General"}
                  numberInGroup={activeIndexInGroup + 1}
                  patch={(p) => patchQuestion(active.id, p)}
                  patchExam={patchExam}
                  onChangeType={(t) => changeType(active.id, t)}
                  onDuplicate={() => duplicate(active)}
                  onDelete={() => remove(active.id)}
                  sections={sections}
                  aiEnabled={aiOn}
                />
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <ListTree className="h-9 w-9 text-[var(--muted)]" />
                <p className="mt-3 text-sm font-semibold">{t("eb.noQuestionSelected")}</p>
                <p className="mt-1 max-w-xs text-sm text-[var(--muted)]">{t("eb.noQuestionHint")}</p>
                <button onClick={() => addQuestion(sections[0]?.id ?? null)} className="btn btn-primary mt-4 h-9"><Plus className="h-4 w-4" /> {t("eb.addQuestion")}</button>
              </div>
            )}

            {/* Floating save bar (structure view) */}
            {tab === "structure" && active && (
              <div className="pointer-events-none sticky bottom-5 z-10 flex justify-end px-6">
                <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--card)] p-1 shadow-lg">
                  <button onClick={flushSaves} className="inline-flex items-center gap-1.5 rounded-full bg-[rgba(198,255,52,0.14)] px-4 py-1.5 text-sm font-semibold text-[#c6ff34]">
                    {status === "saving" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {status === "saving" ? t("eb.saving") : t("eb.saveQuestion")}
                  </button>
                </div>
              </div>
            )}
          </main>
        </div>
      )}

      {bankOpen && (
        <PickFromBankModal
          excludeExamId={examId!}
          onClose={() => setBankOpen(false)}
          onAdd={cloneFromBank}
        />
      )}
    </div>
  );
}

/* ─────────────────────────── Structure tree ─────────────────────────── */
function StructureTree({
  groups, activeId, onSelect, onAddQuestion, onAddSection, onRenameSection, onDeleteSection, onSectionDraw, onSectionTime, onMove, onDelete,
}: {
  groups: { id: string | null; title: string; instructions?: string; drawCount?: number; timeLimitMinutes?: number; items: Question[] }[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onAddQuestion: (sectionId: string | null) => void;
  onAddSection: () => void;
  onRenameSection: (sid: string, title: string) => void;
  onDeleteSection: (sid: string) => void;
  onSectionDraw: (sid: string, n: number | undefined) => void;
  onSectionTime: (sid: string, n: number | undefined) => void;
  onMove: (groupItems: Question[], id: string, dir: -1 | 1) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="space-y-3">
      {groups.map((g) => {
        const pts = g.items.reduce((s, q) => s + (q.points || 0), 0);
        return (
          <div key={g.id ?? "__none"} className="rounded-xl border border-[var(--border)] bg-[var(--card-2)]/40">
            <div className="flex items-center gap-1.5 px-2.5 pt-2.5">
              <Layers className="h-3.5 w-3.5 shrink-0 text-[#c6ff34]" />
              {g.id ? (
                <input
                  className="min-w-0 flex-1 border-0 bg-transparent text-[13px] font-bold outline-none focus:ring-0"
                  value={g.title}
                  onChange={(e) => onRenameSection(g.id!, e.target.value)}
                  placeholder="Section title"
                />
              ) : (
                <span className="flex-1 text-[13px] font-bold">{g.title}</span>
              )}
              {g.id && (
                <button onClick={() => onDeleteSection(g.id!)} title="Delete section" className="rounded p-1 text-[var(--muted)] hover:text-rose-500"><X className="h-3.5 w-3.5" /></button>
              )}
            </div>
            <p className="px-2.5 pb-1.5 pl-7 text-[11px] text-[var(--muted)]">{g.items.length} question{g.items.length === 1 ? "" : "s"} · {pts} marks</p>
            {g.id && g.items.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 pb-2 pl-7 text-[11px] text-[var(--muted)]">
                <label className="flex items-center gap-1.5" title="Pool: serve a random subset from this section each attempt">
                  <Shuffle className="h-3 w-3" /> Draw
                  <input type="number" min={0} max={g.items.length} value={g.drawCount ?? ""} placeholder="all"
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => onSectionDraw(g.id!, e.target.value === "" ? undefined : Math.max(0, Math.min(g.items.length, Number(e.target.value))))}
                    className="h-6 w-12 rounded border border-[var(--border)] bg-[var(--card-2)] px-1 text-center text-[11px] outline-none" />
                  of {g.items.length}
                </label>
                <label className="flex items-center gap-1.5" title="Suggested time for this section (advisory; shown to candidates)">
                  <Clock className="h-3 w-3" /> Time
                  <input type="number" min={0} value={g.timeLimitMinutes ?? ""} placeholder="—"
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => onSectionTime(g.id!, e.target.value === "" ? undefined : Math.max(0, Number(e.target.value)))}
                    className="h-6 w-12 rounded border border-[var(--border)] bg-[var(--card-2)] px-1 text-center text-[11px] outline-none" />
                  min
                </label>
              </div>
            )}

            <div className="space-y-1 px-1.5 pb-1.5">
              {g.items.map((q, i) => {
                const M = TYPE_META[q.type];
                const isActive = q.id === activeId;
                return (
                  <div key={q.id}
                    onClick={() => onSelect(q.id)}
                    className={clsx("group/q flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition",
                      isActive ? "bg-[var(--card)] shadow-sm ring-1 ring-[#c6ff34]/40" : "hover:bg-[var(--card)]")}>
                    <span className="hidden text-[var(--muted)] group-hover/q:block"><GripVertical className="h-3.5 w-3.5" /></span>
                    <span className={clsx("flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] font-bold", isActive ? "bg-[#c6ff34] text-[#111110]" : "bg-[var(--card-2)] text-[var(--muted)] group-hover/q:hidden")}>{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{q.prompt || <span className="text-[var(--muted)]">Untitled question</span>}</span>
                    <span className="hidden shrink-0 items-center gap-0.5 group-hover/q:flex">
                      <button onClick={(e) => { e.stopPropagation(); onMove(g.items, q.id, -1); }} disabled={i === 0} className="rounded p-0.5 text-[var(--muted)] hover:text-[var(--fg)] disabled:opacity-30"><ChevronUp className="h-3.5 w-3.5" /></button>
                      <button onClick={(e) => { e.stopPropagation(); onMove(g.items, q.id, 1); }} disabled={i === g.items.length - 1} className="rounded p-0.5 text-[var(--muted)] hover:text-[var(--fg)] disabled:opacity-30"><ChevronDown className="h-3.5 w-3.5" /></button>
                      <button onClick={(e) => { e.stopPropagation(); onDelete(q.id); }} className="rounded p-0.5 text-[var(--muted)] hover:text-rose-500"><Trash2 className="h-3.5 w-3.5" /></button>
                    </span>
                    <span className={clsx("shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold group-hover/q:hidden", isActive ? "bg-[rgba(198,255,52,0.16)] text-[#c6ff34]" : "bg-[var(--card-2)] text-[var(--muted)]")}>{M.short}</span>
                  </div>
                );
              })}
              <button onClick={() => onAddQuestion(g.id)} className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] py-1.5 text-xs font-semibold text-[#c6ff34] hover:bg-[var(--card)]">
                <Plus className="h-3.5 w-3.5" /> Add Question
              </button>
            </div>
          </div>
        );
      })}

      <button onClick={onAddSection} className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--border)] py-2.5 text-sm font-semibold text-[var(--muted)] hover:text-[var(--fg)]">
        <Layers className="h-4 w-4" /> Add New Section
      </button>
    </div>
  );
}

/* ─────────────────────────── Question editor ─────────────────────────── */
function QuestionEditor({
  q, exam, sectionTitle, numberInGroup, patch, patchExam, onChangeType, onDuplicate, onDelete, sections, aiEnabled,
}: {
  q: Question; exam: Exam; sectionTitle: string; numberInGroup: number;
  patch: (p: Partial<Question>) => void; patchExam: (p: Partial<Exam>) => void;
  onChangeType: (t: QuestionType) => void; onDuplicate: () => void; onDelete: () => void;
  sections: { id: string; title: string }[]; aiEnabled: boolean;
}) {
  const [advanced, setAdvanced] = useState(false);
  const [acceptedRaw, setAcceptedRaw] = useState((q.acceptedAnswers ?? []).join(", "));
  const [rubricLib, setRubricLib] = useState<{ id: string; name: string; criteria: RubricCriterion[] }[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiResult, setAiResult] = useState<{ difficulty: "easy" | "medium" | "hard"; confidence: number; rationale: string } | null>(null);
  const [aiErr, setAiErr] = useState<string | null>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const options = q.options ?? [];

  const suggestDifficulty = async () => {
    setAiBusy(true); setAiErr(null);
    try {
      const r = await api.post<{ difficulty: "easy" | "medium" | "hard"; confidence: number; rationale: string }>(`/admin/questions/${q.id}/assess-difficulty`);
      setAiResult(r);
    } catch (e) { setAiErr((e as Error).message); }
    finally { setAiBusy(false); }
  };

  useEffect(() => { api.get<{ rubrics: typeof rubricLib }>("/admin/rubric-library").then((d) => setRubricLib(d.rubrics)).catch(() => {}); }, []);

  const editOption = (i: number, value: string) => {
    const next = [...options];
    const old = next[i]; next[i] = value;
    const p: Partial<Question> = { options: next };
    if (q.correctAnswer === old) p.correctAnswer = value;
    if ((q.correctAnswers ?? []).includes(old)) p.correctAnswers = (q.correctAnswers ?? []).map((x) => (x === old ? value : x));
    patch(p);
  };
  const addOption = () => patch({ options: [...options, `Option ${options.length + 1}`] });
  const removeOption = (i: number) => {
    const removed = options[i];
    const p: Partial<Question> = { options: options.filter((_, idx) => idx !== i) };
    if (q.correctAnswer === removed) p.correctAnswer = "";
    if ((q.correctAnswers ?? []).includes(removed)) p.correctAnswers = (q.correctAnswers ?? []).filter((x) => x !== removed);
    patch(p);
  };
  const markCorrect = (value: string) => patch({ correctAnswer: value });
  const toggleMultiCorrect = (value: string) => {
    const cur = q.correctAnswers ?? [];
    patch({ correctAnswers: cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value] });
  };

  // Lightweight rich-text helpers — wrap the current textarea selection.
  const wrap = (before: string, after = before) => {
    const ta = promptRef.current; if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd, v = q.prompt;
    const sel = v.slice(s, e) || "text";
    const next = v.slice(0, s) + before + sel + after + v.slice(e);
    patch({ prompt: next });
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(s + before.length, s + before.length + sel.length); });
  };
  const prefixLine = (prefix: string) => {
    const ta = promptRef.current; if (!ta) return;
    const s = ta.selectionStart, v = q.prompt;
    const lineStart = v.lastIndexOf("\n", s - 1) + 1;
    patch({ prompt: v.slice(0, lineStart) + prefix + v.slice(lineStart) });
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(s + prefix.length, s + prefix.length); });
  };

  const rubric = q.rubric ?? [];
  const rubricSum = rubric.reduce((s, c) => s + c.maxPoints, 0);
  const addCriterion = () => patch({ rubric: [...rubric, { id: Math.random().toString(36).slice(2, 8), label: "Criterion", maxPoints: 5 }] });
  const editCriterion = (id: string, p: Partial<{ label: string; maxPoints: number }>) => patch({ rubric: rubric.map((c) => (c.id === id ? { ...c, ...p } : c)) });
  const removeCriterion = (id: string) => patch({ rubric: rubric.filter((c) => c.id !== id) });
  const applyRubricTemplate = (id: string) => {
    const t = rubricLib.find((r) => r.id === id);
    if (t) patch({ rubric: t.criteria.map((c) => ({ ...c, id: Math.random().toString(36).slice(2, 8) })) });
  };
  const saveRubricTemplate = async () => {
    if (!rubric.length) return;
    const name = window.prompt("Name this rubric template:");
    if (!name?.trim()) return;
    try {
      const { rubric: saved } = await api.post<{ rubric: { id: string; name: string; criteria: RubricCriterion[] } }>("/admin/rubric-library", { name: name.trim(), criteria: rubric });
      setRubricLib((l) => [...l, saved]);
    } catch (e) { alert((e as Error).message); }
  };

  const isChoice = q.type === "mcq" || q.type === "multi_select" || q.type === "true_false";

  return (
    <div className="space-y-4">
      {/* Breadcrumb + actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
          <span>{sectionTitle}</span> <ChevronRight className="h-3.5 w-3.5" /> <span className="font-semibold text-[var(--fg)]">Question {numberInGroup}</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onDuplicate} title="Duplicate question" className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--card-2)] hover:text-[var(--fg)]"><Copy className="h-4 w-4" /></button>
          <button onClick={onDelete} title="Delete question" className="rounded-lg p-2 text-[var(--muted)] hover:bg-rose-500/15 hover:text-rose-500"><Trash2 className="h-4 w-4" /></button>
        </div>
      </div>

      {/* Editor card */}
      <div className="card rounded-2xl p-6">
        {/* Type / difficulty / points */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Question type">
            <select className="input h-10" value={q.type} onChange={(e) => onChangeType(e.target.value as QuestionType)}>
              {(Object.keys(TYPE_META) as QuestionType[]).map((t) => <option key={t} value={t}>{TYPE_META[t].label}</option>)}
            </select>
          </Field>
          <Field label="Difficulty">
            <select className="input h-10" value={q.difficulty ?? "medium"} onChange={(e) => patch({ difficulty: e.target.value as Question["difficulty"] })}>
              {DIFFICULTIES.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </Field>
          <Field label="Points">
            <input className="input h-10" type="number" min={0} step={0.5} value={q.points} disabled={rubric.length > 0}
              onChange={(e) => patch({ points: Number(e.target.value) })} />
          </Field>
        </div>

        {/* AI difficulty checker */}
        {aiEnabled && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={suggestDifficulty} disabled={aiBusy || !q.prompt.trim()}
              title={!q.prompt.trim() ? "Add a question prompt first" : "Estimate this question's difficulty with AI"}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--muted)] transition hover:border-[#c6ff34]/40 hover:text-[#c6ff34] disabled:opacity-50">
              {aiBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Suggest difficulty (AI)
            </button>
            {aiResult && (
              <span className="inline-flex items-center gap-2 rounded-lg bg-[var(--card-2)] px-2.5 py-1.5 text-xs">
                <span className={clsx("rounded-full px-2 py-0.5 font-bold capitalize",
                  aiResult.difficulty === "easy" ? "bg-emerald-500/15 text-emerald-500" : aiResult.difficulty === "medium" ? "bg-amber-500/15 text-amber-500" : "bg-rose-500/15 text-rose-500")}>{aiResult.difficulty}</span>
                <span className="text-[var(--muted)]">{Math.round(aiResult.confidence * 100)}% confident</span>
                {aiResult.difficulty !== (q.difficulty ?? "medium")
                  ? <button type="button" onClick={() => patch({ difficulty: aiResult.difficulty })} className="font-semibold text-[#c6ff34] hover:underline">Apply</button>
                  : <span className="inline-flex items-center gap-0.5 text-emerald-500"><Check className="h-3 w-3" /> matches</span>}
              </span>
            )}
            {aiResult?.rationale && <span className="w-full text-[11px] italic text-[var(--muted)]">“{aiResult.rationale}”</span>}
            {aiErr && <span className="w-full text-[11px] text-rose-400">{aiErr}</span>}
          </div>
        )}

        {/* Question text */}
        <div className="mt-5">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Question text</span>
          <div className="overflow-hidden rounded-lg border border-[var(--border)]">
            <div className="flex items-center gap-0.5 border-b border-[var(--border)] bg-[var(--card-2)] px-2 py-1.5">
              <TbBtn title="Bold" onClick={() => wrap("**")}><Bold className="h-4 w-4" /></TbBtn>
              <TbBtn title="Italic" onClick={() => wrap("*")}><Italic className="h-4 w-4" /></TbBtn>
              <TbBtn title="Underline" onClick={() => wrap("<u>", "</u>")}><Underline className="h-4 w-4" /></TbBtn>
              <span className="mx-1 h-4 w-px bg-[var(--border)]" />
              <TbBtn title="Bullet list" onClick={() => prefixLine("- ")}><List className="h-4 w-4" /></TbBtn>
              <TbBtn title="Code" onClick={() => wrap("`")}><CodeIcon className="h-4 w-4" /></TbBtn>
              <TbBtn title="Image" onClick={() => { const url = prompt("Image URL"); if (url) wrap(`![](${url})`, ""); }}><ImageIcon className="h-4 w-4" /></TbBtn>
            </div>
            <textarea
              ref={promptRef}
              className="min-h-[110px] w-full resize-y bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-[var(--muted)]"
              value={q.prompt}
              placeholder="Type your question here…"
              onChange={(e) => patch({ prompt: e.target.value })}
            />
          </div>
        </div>

        {/* Answer area by type */}
        {isChoice ? (
          <div className="mt-5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Answer options</span>
              <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
                <input type="checkbox" className="h-3.5 w-3.5 accent-[#c6ff34]" checked={exam.shuffleOptions !== false} onChange={(e) => patchExam({ shuffleOptions: e.target.checked })} />
                Shuffle Options
              </label>
            </div>
            <div className="mt-2 space-y-2">
              {options.map((opt, i) => {
                const isTF = q.type === "true_false";
                const isMulti = q.type === "multi_select";
                const correct = isMulti ? (q.correctAnswers ?? []).includes(opt) && opt !== "" : q.correctAnswer === opt && opt !== "";
                return (
                  <div key={i} className={clsx("flex items-center gap-2 rounded-lg border px-2.5 py-2 transition",
                    correct ? "border-emerald-500/50 bg-emerald-500/[0.07]" : "border-[var(--border)]")}>
                    <GripVertical className="h-4 w-4 shrink-0 text-[var(--border)]" />
                    <button type="button" title={correct ? "Correct answer" : "Mark as correct"} onClick={() => (isMulti ? toggleMultiCorrect(opt) : markCorrect(opt))} className="shrink-0">
                      {isMulti
                        ? (correct ? <span className="flex h-5 w-5 items-center justify-center rounded bg-emerald-500 text-white"><Check className="h-3.5 w-3.5" /></span> : <Square className="h-5 w-5 text-[var(--muted)] hover:text-[#c6ff34]" />)
                        : (correct ? <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white"><Check className="h-3.5 w-3.5" /></span> : <CircleDot className="h-5 w-5 text-[var(--muted)] hover:text-[#c6ff34]" />)}
                    </button>
                    {isTF
                      ? <span className="flex-1 text-sm capitalize">{opt}</span>
                      : <input className="flex-1 bg-transparent text-sm outline-none" value={opt} onChange={(e) => editOption(i, e.target.value)} placeholder={`Option ${i + 1}`} />}
                    {correct && <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold text-emerald-500">CORRECT</span>}
                    {!isTF && options.length > 2 && (
                      <button type="button" onClick={() => removeOption(i)} className="shrink-0 text-[var(--muted)] hover:text-rose-500"><X className="h-4 w-4" /></button>
                    )}
                  </div>
                );
              })}
            </div>
            {(q.type === "mcq" || q.type === "multi_select") && (
              <button type="button" onClick={addOption} className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-[#c6ff34] hover:underline"><Plus className="h-4 w-4" /> Add Option</button>
            )}
            {q.type === "multi_select" && <p className="mt-1.5 text-[11px] text-[var(--muted)]">Tick every correct option — candidates must select all of them, and no extras, to score.</p>}
          </div>
        ) : q.type === "short" ? (
          <div className="mt-5 space-y-3">
            <Field label="Primary accepted answer (auto-graded)">
              <input className="input h-10" value={q.correctAnswer} placeholder="e.g. plagiarism" onChange={(e) => patch({ correctAnswer: e.target.value })} />
            </Field>
            <Field label="Also accept (comma-separated)">
              <input className="input h-10" value={acceptedRaw} placeholder="e.g. plagiarising, plagiarizing"
                onChange={(e) => { setAcceptedRaw(e.target.value); patch({ acceptedAnswers: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) }); }} />
            </Field>
            <p className="text-[11px] text-[var(--muted)]">Any of these (case-insensitive) auto-grades as correct. Other answers go to manual review.</p>
          </div>
        ) : q.type === "numeric" ? (
          <div className="mt-5 flex flex-wrap items-end gap-3">
            <Field label="Correct value (auto-graded)"><input className="input h-10 w-40" type="number" step="any" value={q.correctAnswer} placeholder="e.g. 42" onChange={(e) => patch({ correctAnswer: e.target.value })} /></Field>
            <Field label="± Tolerance"><input className="input h-10 w-32" type="number" min={0} step="any" value={q.tolerance ?? 0} onChange={(e) => patch({ tolerance: Math.max(0, Number(e.target.value) || 0) })} /></Field>
            <span className="pb-2.5 text-[11px] text-[var(--muted)]">Accepts answers within ± tolerance.</span>
          </div>
        ) : q.type === "matching" ? (
          <MatchingEditor q={q} patch={patch} />
        ) : q.type === "ordering" ? (
          <OrderingEditor q={q} patch={patch} />
        ) : q.type === "cloze" ? (
          <ClozeEditor q={q} patch={patch} />
        ) : q.type === "hotspot" ? (
          <HotspotEditor q={q} patch={patch} />
        ) : q.type === "parameterized" ? (
          <ParameterizedEditor q={q} patch={patch} />
        ) : (
          <div className="mt-5 rounded-lg border border-dashed border-[var(--border)] px-3 py-3 text-sm text-[var(--muted)]">
            {q.type === "code" ? "Code answer — candidates get a VS Code-style editor and can run their code."
              : q.type === "file_upload" ? "File-upload answer — candidates attach a file (≤ 5 MB)."
              : "Descriptive / long-form written answer."} Graded manually after submission. Configure the rubric{q.type === "code" ? " and runner" : ""} under Advanced Logic &amp; Settings.
          </div>
        )}

        {/* Advanced */}
        <div className="mt-5 rounded-lg border border-[var(--border)]">
          <button onClick={() => setAdvanced((a) => !a)} className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-semibold">
            <span className="inline-flex items-center gap-2"><SettingsIcon className="h-4 w-4 text-[#c6ff34]" /> Advanced Logic &amp; Settings</span>
            <ChevronDown className={clsx("h-4 w-4 text-[var(--muted)] transition", advanced && "rotate-180")} />
          </button>
          {advanced && (
            <div className="space-y-4 border-t border-[var(--border)] p-3">
              <Field label="Section">
                <select className="input h-10" value={q.sectionId ?? ""} onChange={(e) => patch({ sectionId: e.target.value || null })}>
                  <option value="">No section (General)</option>
                  {sections.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
                </select>
              </Field>

              <TagsField q={q} patch={patch} />

              <Field label="Explanation (shown to candidates after results)">
                <textarea className="input min-h-[60px] w-full resize-y" value={q.explanation ?? ""} placeholder="Explain why the correct answer is correct — appears on the candidate's result once released." onChange={(e) => patch({ explanation: e.target.value })} />
              </Field>

              {q.type === "code" && <CodeQuestionFields q={q} patch={patch} />}

              {(q.type === "essay" || q.type === "code" || q.type === "file_upload") && (
                <div className="rounded-lg border border-[var(--border)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Grading rubric{rubric.length > 0 ? ` · ${rubricSum} pts total` : ""}</span>
                    <div className="flex items-center gap-2">
                      {rubricLib.length > 0 && (
                        <select className="input h-7 w-auto text-xs" value="" onChange={(e) => { if (e.target.value) applyRubricTemplate(e.target.value); }}>
                          <option value="">Load template…</option>
                          {rubricLib.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                      )}
                      {rubric.length > 0 && (
                        <button type="button" onClick={saveRubricTemplate} title="Save this rubric to your reusable library" className="inline-flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[#c6ff34]"><BookmarkPlus className="h-3.5 w-3.5" /> Save</button>
                      )}
                      <button type="button" onClick={addCriterion} className="inline-flex items-center gap-1 text-xs text-[#c6ff34] hover:underline"><Plus className="h-3.5 w-3.5" /> Criterion</button>
                    </div>
                  </div>
                  {rubric.length === 0 ? (
                    <p className="mt-2 text-[11px] text-[var(--muted)]">No rubric — the grader awards a single mark out of {q.points}. Add criteria to grade against a structured rubric (points become the sum).</p>
                  ) : (
                    <div className="mt-2 space-y-1.5">
                      {rubric.map((c) => (
                        <div key={c.id} className="flex items-center gap-2">
                          <input value={c.label} onChange={(e) => editCriterion(c.id, { label: e.target.value })} className="input h-8 flex-1 text-sm" placeholder="Criterion" />
                          <input type="number" min={0} value={c.maxPoints} onChange={(e) => editCriterion(c.id, { maxPoints: Math.max(0, Number(e.target.value) || 0) })} className="input h-8 w-20 text-sm" />
                          <span className="text-xs text-[var(--muted)]">pts</span>
                          <button type="button" onClick={() => removeCriterion(c.id)} className="text-[var(--muted)] hover:text-rose-500"><X className="h-4 w-4" /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TbBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" title={title} onClick={onClick} className="rounded p-1.5 text-[var(--muted)] hover:bg-[var(--card)] hover:text-[var(--fg)]">{children}</button>;
}

/* ─────────────────────────── Settings panel ─────────────────────────── */
function SettingsPanel({
  exam, questions, patchExam, classesAll, assignedClasses, pickClass, setPickClass, pickWhen, setPickWhen, assignClass, audienceMsg,
}: {
  exam: Exam; questions: Question[]; patchExam: (p: Partial<Exam>) => void;
  classesAll: { id: string; name: string; members: number }[];
  assignedClasses: { id: string; name: string; members: number; scheduledStart: string | null }[];
  pickClass: string; setPickClass: (v: string) => void;
  pickWhen: string; setPickWhen: (v: string) => void;
  assignClass: () => void; audienceMsg: string | null;
}) {
  const open = exam.enrollment === "open";
  return (
    <div className="space-y-4">
      {/* Details */}
      <div className="card rounded-2xl p-6">
        <h2 className="text-sm font-bold">Examination details</h2>
        <input className="mt-3 w-full border-0 border-b border-[var(--border)] bg-transparent pb-1.5 text-2xl font-bold outline-none focus:border-[#c6ff34]"
          value={exam.title} placeholder="Untitled examination" onChange={(e) => patchExam({ title: e.target.value })} />
        <textarea className="mt-3 w-full resize-y rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[#c6ff34]"
          rows={2} value={exam.description} placeholder="Add a description (instructions for candidates)…" onChange={(e) => patchExam({ description: e.target.value })} />
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <Field label="Exam code"><input className="input h-9" value={exam.code} placeholder="CS101-F2026" onChange={(e) => patchExam({ code: e.target.value })} /></Field>
          <Field label="Subject"><input className="input h-9" value={exam.subject ?? ""} placeholder="e.g. Physics" onChange={(e) => patchExam({ subject: e.target.value })} /></Field>
          <Field label="Duration (min)"><input className="input h-9" type="number" min={1} value={exam.durationMinutes} onChange={(e) => patchExam({ durationMinutes: Number(e.target.value) })} /></Field>
          <Field label="Pass mark (%)"><input className="input h-9" type="number" min={0} max={100} value={exam.passingScore} onChange={(e) => patchExam({ passingScore: Number(e.target.value) })} /></Field>
          <Field label="Proctoring">
            <button onClick={() => { const on = !exam.proctored; patchExam(on ? { proctored: true } : { proctored: false, lockdown: { ...exam.lockdown, violationLimit: 0 } }); }}
              className={clsx("flex h-9 items-center justify-between rounded-lg border px-3 text-sm font-medium", exam.proctored ? "border-[#c6ff34]/40 bg-[rgba(198,255,52,0.1)] text-[#c6ff34]" : "border-[var(--border)] text-[var(--muted)]")}>
              {exam.proctored ? "On" : "Off"}
              <span className={clsx("ml-2 inline-flex h-4 w-7 items-center rounded-full p-0.5 transition", exam.proctored ? "bg-[#c6ff34]" : "bg-[var(--border)]")}>
                <span className={clsx("h-3 w-3 rounded-full bg-white transition", exam.proctored && "translate-x-3")} />
              </span>
            </button>
          </Field>
        </div>
        <CoverImageField exam={exam} patch={patchExam} />
      </div>

      {/* Audience */}
      <div className="card rounded-2xl p-6">
        <div className="flex items-center gap-2 text-sm font-bold"><Users className="h-4 w-4 text-[#c6ff34]" /> Audience</div>
        <p className="mt-0.5 text-xs text-[var(--muted)]">Choose who can see and take this exam.</p>
        <button onClick={() => patchExam({ enrollment: open ? "assigned" : "open" })} className="mt-3 flex w-full items-center justify-between gap-4 rounded-xl border border-[var(--border)] p-4 text-left transition hover:bg-[var(--card-2)]">
          <div className="flex items-start gap-3">
            {open ? <Globe className="mt-0.5 h-4 w-4 text-[#c6ff34]" /> : <Lock className="mt-0.5 h-4 w-4 text-amber-500" />}
            <div>
              <p className="text-sm font-medium">Open to all candidates</p>
              <p className="text-xs text-[var(--muted)]">{open ? "Every candidate sees this exam once published." : "Restricted — only the students and classes you assign below can take it."}</p>
            </div>
          </div>
          <span className={clsx("inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition", open ? "bg-[#c6ff34]" : "bg-[var(--border)]")}>
            <span className={clsx("h-5 w-5 rounded-full bg-white transition", open && "translate-x-5")} />
          </span>
        </button>
        {exam.enrollment === "assigned" && (
          <div className="mt-4 border-t border-[var(--border)] pt-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Assign to a class</p>
            {audienceMsg && <p className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">{audienceMsg}</p>}
            {assignedClasses.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {assignedClasses.map((c) => (
                  <div key={c.id} className="flex items-center justify-between rounded-lg border border-[var(--border)] px-3 py-2.5 text-sm">
                    <div>
                      <span className="font-medium">{c.name}</span>
                      <span className="ml-1.5 text-xs text-[var(--muted)]">· {c.members} student{c.members === 1 ? "" : "s"}</span>
                      {c.scheduledStart && (
                        <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                          {new Date(c.scheduledStart).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </p>
                      )}
                    </div>
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-500"><UserCheck className="h-3.5 w-3.5" /> Assigned</span>
                  </div>
                ))}
              </div>
            )}
            {classesAll.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--muted)]">No classes yet. Create one under Classes.</p>
            ) : (
              <div className="mt-2 space-y-2">
                <select className="input h-9 w-full" value={pickClass} onChange={(e) => setPickClass(e.target.value)}>
                  <option value="">Select a class…</option>
                  {classesAll.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.members})</option>)}
                </select>
                <div className="flex items-center gap-2">
                  <input type="datetime-local" className="input h-9 flex-1 text-sm" value={pickWhen} onChange={(e) => setPickWhen(e.target.value)} title="Schedule exam for this class (optional)" />
                  <button onClick={assignClass} disabled={!pickClass} className="btn btn-primary h-9 shrink-0 disabled:opacity-50"><Users className="h-4 w-4" /> Assign</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Question delivery */}
      <div className="card rounded-2xl p-6">
        <div className="flex items-center gap-2 text-sm font-bold"><Shuffle className="h-4 w-4 text-[#c6ff34]" /> Question delivery</div>
        <p className="mt-0.5 text-xs text-[var(--muted)]">Randomize what each candidate sees so no two students get the same paper.</p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {([["shuffleQuestions", "Shuffle question order", "Each attempt gets questions in a different order."], ["shuffleOptions", "Shuffle answer options", "MCQ options are reordered per attempt."]] as const).map(([key, label, desc]) => {
            const on = (exam as unknown as Record<string, unknown>)[key] !== false;
            return (
              <button key={key} onClick={() => patchExam({ [key]: !on } as Partial<Exam>)}
                className={clsx("flex items-center justify-between gap-3 rounded-xl border p-3 text-left transition", on ? "border-[#c6ff34]/40 bg-[rgba(198,255,52,0.08)]" : "border-[var(--border)] hover:bg-[var(--card-2)]")}>
                <div><p className="text-sm font-medium">{label}</p><p className="text-xs text-[var(--muted)]">{desc}</p></div>
                <span className={clsx("inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition", on ? "bg-[#c6ff34]" : "bg-[var(--border)]")}><span className={clsx("h-4 w-4 rounded-full bg-white transition", on && "translate-x-4")} /></span>
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-4 text-sm">
          <Shuffle className="h-4 w-4 text-[var(--muted)]" /> Serve
          <input type="number" min={0} className="input h-8 w-20" placeholder="all" value={exam.questionsPerAttempt ?? ""} onChange={(e) => patchExam({ questionsPerAttempt: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })} />
          of {questions.length} questions per attempt <span className="text-xs text-[var(--muted)]">(blank = all — draws a random pool)</span>
        </div>
      </div>

      {/* Exam blueprint */}
      <BlueprintEditor exam={exam} questions={questions} patchExam={patchExam} />

      {/* Marking scheme */}
      <div className="card rounded-2xl p-6">
        <div className="flex items-center gap-2 text-sm font-bold"><Target className="h-4 w-4 text-[#c6ff34]" /> Marking scheme</div>
        <div className="mt-3 space-y-2">
          <button onClick={() => patchExam({ partialCredit: !exam.partialCredit })}
            className={clsx("flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left transition", exam.partialCredit ? "border-[#c6ff34]/40 bg-[rgba(198,255,52,0.08)]" : "border-[var(--border)] hover:bg-[var(--card-2)]")}>
            <div><p className="text-sm font-medium">Partial credit (multi-select)</p><p className="text-xs text-[var(--muted)]">Award proportional marks for partly-correct multi-select answers.</p></div>
            <span className={clsx("inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition", exam.partialCredit ? "bg-[#c6ff34]" : "bg-[var(--border)]")}><span className={clsx("h-4 w-4 rounded-full bg-white transition", exam.partialCredit && "translate-x-4")} /></span>
          </button>
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] p-3 text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-500" /> Negative marking — deduct
            <input type="number" min={0} max={100} step={5} className="input h-8 w-20" value={Math.round((exam.negativeMarking ?? 0) * 100)} onChange={(e) => patchExam({ negativeMarking: Math.max(0, Math.min(100, Number(e.target.value) || 0)) / 100 })} />
            % for a wrong objective answer <span className="text-xs text-[var(--muted)]">(0 = off)</span>
          </div>
        </div>
      </div>

      {/* Grading scheme & release */}
      <GradingSchemeCard exam={exam} patchExam={patchExam} />

      {/* Study materials / resources */}
      <div className="card rounded-2xl p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-bold"><FileText className="h-4 w-4 text-[#c6ff34]" /> Study materials</div>
          <button onClick={() => patchExam({ resources: [...(exam.resources ?? []), { label: "", url: "" }] })} className="inline-flex items-center gap-1 text-xs font-semibold text-[#c6ff34] hover:underline"><Plus className="h-3.5 w-3.5" /> Add link</button>
        </div>
        <p className="mt-0.5 text-xs text-[var(--muted)]">Links shown to candidates on the exam page — revision notes, syllabus, past papers.</p>
        <div className="mt-3 space-y-2">
          {(exam.resources ?? []).length === 0 ? (
            <p className="text-xs text-[var(--muted)]">No resources yet.</p>
          ) : (exam.resources ?? []).map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input className="input h-9 w-40" value={r.label} placeholder="Label" onChange={(e) => patchExam({ resources: (exam.resources ?? []).map((x, idx) => idx === i ? { ...x, label: e.target.value } : x) })} />
              <input className="input h-9 flex-1" value={r.url} placeholder="https://…" onChange={(e) => patchExam({ resources: (exam.resources ?? []).map((x, idx) => idx === i ? { ...x, url: e.target.value } : x) })} />
              <button onClick={() => patchExam({ resources: (exam.resources ?? []).filter((_, idx) => idx !== i) })} className="text-[var(--muted)] hover:text-rose-500"><X className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}

/* ─────────────────────────── Proctoring panel ─────────────────────────── */
function ProctoringPanel({ exam, patchExam }: { exam: Exam; patchExam: (p: Partial<Exam>) => void }) {
  return (
    <div className="card rounded-2xl p-6">
      <div className="flex items-center gap-2 text-sm font-bold"><ShieldAlert className="h-4 w-4 text-[#c6ff34]" /> Lockdown &amp; integrity</div>
      <p className="mt-0.5 text-xs text-[var(--muted)]">Rules enforced while a candidate takes this exam.</p>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {LOCKDOWN_RULES.map(({ key, label, desc }) => {
          const on = !!exam.lockdown?.[key];
          return (
            <button key={key} onClick={() => patchExam({ lockdown: { ...exam.lockdown, [key]: !on } })}
              className={clsx("flex items-center justify-between gap-3 rounded-xl border p-3 text-left transition", on ? "border-[#c6ff34]/40 bg-[rgba(198,255,52,0.08)]" : "border-[var(--border)] hover:bg-[var(--card-2)]")}>
              <div><p className="text-sm font-medium">{label}</p><p className="text-xs text-[var(--muted)]">{desc}</p></div>
              <span className={clsx("inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition", on ? "bg-[#c6ff34]" : "bg-[var(--border)]")}><span className={clsx("h-4 w-4 rounded-full bg-white transition", on && "translate-x-4")} /></span>
            </button>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-4 text-sm">
        <AlertTriangle className="h-4 w-4 text-amber-500" /> Auto-submit after
        <input type="number" min={0} className="input h-8 w-16" value={exam.lockdown?.violationLimit ?? 0} onChange={(e) => patchExam({ lockdown: { ...exam.lockdown, violationLimit: Number(e.target.value) } })} />
        integrity violations <span className="text-xs text-[var(--muted)]">(0 = submit on first violation)</span>
      </div>

      {/* Safe Exam Browser */}
      <div className="mt-4 border-t border-[var(--border)] pt-4">
        <button onClick={() => patchExam({ lockdown: { ...exam.lockdown, requireSafeExamBrowser: !exam.lockdown?.requireSafeExamBrowser } })}
          className={clsx("flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left transition", exam.lockdown?.requireSafeExamBrowser ? "border-[#c6ff34]/40 bg-[rgba(198,255,52,0.08)]" : "border-[var(--border)] hover:bg-[var(--card-2)]")}>
          <div>
            <p className="text-sm font-medium">Require Safe Exam Browser</p>
            <p className="text-xs text-[var(--muted)]">Hard OS-level lockdown. The exam can only be taken inside SEB — the server rejects any other browser.</p>
            <p className="mt-1 text-xs font-medium text-amber-500">Requires Windows, macOS or iPad — not available on Android or Chromebook.</p>
          </div>
          <span className={clsx("inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition", exam.lockdown?.requireSafeExamBrowser ? "bg-[#c6ff34]" : "bg-[var(--border)]")}><span className={clsx("h-4 w-4 rounded-full bg-white transition", exam.lockdown?.requireSafeExamBrowser && "translate-x-4")} /></span>
        </button>
        {exam.lockdown?.requireSafeExamBrowser && (
          <div className="mt-3 space-y-3">
            <div>
              <label className="text-xs font-medium">Config Key(s)</label>
              <p className="mb-1 text-xs text-[var(--muted)]">From the SEB Config Tool. One per line. SHA-256 hex.</p>
              <textarea className="input min-h-[64px] w-full font-mono text-xs" placeholder="e.g. 6b7a…f3c2" value={(exam.lockdown?.sebConfigKeys ?? []).join("\n")} onChange={(e) => patchExam({ lockdown: { ...exam.lockdown, sebConfigKeys: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) } })} />
            </div>
            <div>
              <label className="text-xs font-medium">Browser Exam Key(s) <span className="text-[var(--muted)]">(optional)</span></label>
              <textarea className="input min-h-[48px] w-full font-mono text-xs" placeholder="optional" value={(exam.lockdown?.sebBrowserExamKeys ?? []).join("\n")} onChange={(e) => patchExam({ lockdown: { ...exam.lockdown, sebBrowserExamKeys: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) } })} />
            </div>
            <div>
              <label className="text-xs font-medium">Launch link</label>
              <input className="input h-9 w-full text-xs" placeholder="sebs://lockdown.jevislab.com/exam.seb" value={exam.lockdown?.sebLaunchUrl ?? ""} onChange={(e) => patchExam({ lockdown: { ...exam.lockdown, sebLaunchUrl: e.target.value } })} />
            </div>
            {(exam.lockdown?.sebConfigKeys ?? []).length === 0 && (exam.lockdown?.sebBrowserExamKeys ?? []).length === 0 && (
              <p className="flex items-center gap-1.5 rounded-lg bg-amber-500/15 px-3 py-2 text-xs text-amber-500"><AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Add at least one Config Key, or no one will be able to start this exam.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── Shared helpers ─────────────────────────── */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">{label}</span>
      {children}
    </label>
  );
}

const CODE_LANGS = ["python", "javascript", "typescript", "c", "cpp", "java", "go", "ruby", "php", "rust", "csharp"] as const;
const CODE_LANG_LABEL: Record<string, string> = {
  python: "Python", javascript: "JavaScript", typescript: "TypeScript", c: "C", cpp: "C++",
  java: "Java", go: "Go", ruby: "Ruby", php: "PHP", rust: "Rust", csharp: "C#",
};

function CodeQuestionFields({ q, patch }: { q: Question; patch: (p: Partial<Question>) => void }) {
  const tests = q.testCases ?? [];
  const setTest = (i: number, key: "input" | "expected", val: string) => patch({ testCases: tests.map((t, idx) => (idx === i ? { ...t, [key]: val } : t)) });
  return (
    <div className="space-y-3 rounded-lg border border-[var(--border)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Language</span>
        <select className="input h-8 w-auto" value={q.codeLanguage ?? "python"} onChange={(e) => patch({ codeLanguage: e.target.value })}>
          {CODE_LANGS.map((l) => <option key={l} value={l}>{CODE_LANG_LABEL[l]}</option>)}
        </select>
      </div>
      <label className="block">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Starter code (optional)</span>
        <textarea className="input mt-1 min-h-[70px] resize-y font-mono text-xs" value={q.starterCode ?? ""} onChange={(e) => patch({ starterCode: e.target.value })} placeholder="Pre-filled in the candidate's editor…" />
      </label>
      <div>
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Sample test cases{tests.length > 0 ? ` · ${tests.length}` : ""}</span>
          <button type="button" onClick={() => patch({ testCases: [...tests, { input: "", expected: "" }] })} className="inline-flex items-center gap-1 text-xs text-[#c6ff34] hover:underline"><Plus className="h-3.5 w-3.5" /> Test case</button>
        </div>
        {tests.length > 0 && (
          <div className="mt-2 space-y-2">
            {tests.map((t, i) => (
              <div key={i} className="flex items-start gap-2">
                <textarea className="input min-h-[38px] flex-1 resize-y font-mono text-xs" value={t.input} onChange={(e) => setTest(i, "input", e.target.value)} placeholder="stdin" />
                <textarea className="input min-h-[38px] flex-1 resize-y font-mono text-xs" value={t.expected} onChange={(e) => setTest(i, "expected", e.target.value)} placeholder="expected stdout" />
                <button type="button" title="Remove" onClick={() => patch({ testCases: tests.filter((_, idx) => idx !== i) })} className="mt-1 rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--card-2)] hover:text-[var(--fg)]"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CoverImageField({ exam, patch }: { exam: Exam; patch: (p: Partial<Exam>) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1_000_000) { alert("Cover image must be under 1 MB."); return; }
    const r = new FileReader();
    r.onload = () => patch({ coverImage: String(r.result) });
    r.readAsDataURL(file);
    e.target.value = "";
  };
  return (
    <div className="mt-5 flex items-center gap-3">
      {exam.coverImage
        ? <img src={exam.coverImage} alt="" className="h-16 w-28 shrink-0 rounded-md object-cover" />
        : <div className="flex h-16 w-28 shrink-0 items-center justify-center rounded-md border border-dashed border-[var(--border)] text-[var(--muted)]"><ImageIcon className="h-5 w-5" /></div>}
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => ref.current?.click()} className="btn btn-outline h-8 text-xs"><Plus className="h-3.5 w-3.5" /> {exam.coverImage ? "Change cover" : "Add cover image"}</button>
        {exam.coverImage && <button type="button" onClick={() => patch({ coverImage: null })} className="btn btn-ghost h-8 text-xs">Remove</button>}
        <input ref={ref} type="file" accept="image/*" className="hidden" onChange={pick} />
      </div>
    </div>
  );
}

function BuilderSkeleton() {
  return (
    <div className="flex h-screen flex-col bg-[var(--bg)]">
      <header className="shrink-0 border-b border-[var(--border)] bg-[var(--card)]">
        <div className="flex h-14 items-center justify-between px-6"><Skeleton className="h-5 w-32" /><div className="flex gap-2"><Skeleton className="h-9 w-24 rounded-lg" /><Skeleton className="h-9 w-28 rounded-lg" /></div></div>
      </header>
      <div className="flex flex-1">
        <aside className="w-[300px] shrink-0 border-r border-[var(--border)] bg-[var(--card)] p-4 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
        </aside>
        <main className="flex-1 p-6"><Skeleton className="h-8 w-48" /><Skeleton className="mt-4 h-72 w-full max-w-3xl rounded-2xl" /></main>
      </div>
    </div>
  );
}

/* ─────────────────────── Topic tags ─────────────────────── */
function TagsField({ q, patch }: { q: Question; patch: (p: Partial<Question>) => void }) {
  const [raw, setRaw] = useState("");
  const tags = q.tags ?? [];
  const add = (t: string) => { const v = t.trim(); if (v && !tags.includes(v)) patch({ tags: [...tags, v] }); setRaw(""); };
  return (
    <Field label="Topic tags">
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-[var(--border)] px-2 py-1.5">
        {tags.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full bg-[rgba(198,255,52,0.14)] px-2 py-0.5 text-xs font-medium text-[#c6ff34]">
            <Tag className="h-3 w-3" />{t}
            <button type="button" onClick={() => patch({ tags: tags.filter((x) => x !== t) })}><X className="h-3 w-3" /></button>
          </span>
        ))}
        <input className="min-w-[120px] flex-1 bg-transparent text-sm outline-none" value={raw} placeholder="Add a topic…"
          onChange={(e) => setRaw(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(raw); } }}
          onBlur={() => add(raw)} />
      </div>
      <p className="mt-1 text-[11px] text-[var(--muted)]">Used for bank filtering and the exam blueprint (assemble “N from a topic”).</p>
    </Field>
  );
}

/* ─────────────────────── Matching editor ─────────────────────── */
function MatchingEditor({ q, patch }: { q: Question; patch: (p: Partial<Question>) => void }) {
  const pairs = q.matchPairs ?? [];
  const set = (i: number, key: "left" | "right", val: string) => patch({ matchPairs: pairs.map((p, idx) => (idx === i ? { ...p, [key]: val } : p)) });
  return (
    <div className="mt-5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Matching pairs</span>
      <p className="mb-2 text-[11px] text-[var(--muted)]">Candidates match each left prompt to its correct right value. Right values are shuffled when served.</p>
      <div className="space-y-2">
        {pairs.map((p, i) => (
          <div key={i} className="flex items-center gap-2">
            <input className="input h-9 flex-1" value={p.left} placeholder={`Prompt ${i + 1}`} onChange={(e) => set(i, "left", e.target.value)} />
            <ArrowLeftRight className="h-4 w-4 shrink-0 text-[var(--muted)]" />
            <input className="input h-9 flex-1" value={p.right} placeholder={`Match ${i + 1}`} onChange={(e) => set(i, "right", e.target.value)} />
            <button type="button" onClick={() => patch({ matchPairs: pairs.filter((_, idx) => idx !== i) })} disabled={pairs.length <= 1} className="text-[var(--muted)] hover:text-rose-500 disabled:opacity-30"><X className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => patch({ matchPairs: [...pairs, { left: "", right: "" }] })} className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-[#c6ff34] hover:underline"><Plus className="h-4 w-4" /> Add pair</button>
    </div>
  );
}

/* ─────────────────────── Ordering editor ─────────────────────── */
function OrderingEditor({ q, patch }: { q: Question; patch: (p: Partial<Question>) => void }) {
  const seq = q.sequence ?? [];
  const set = (i: number, val: string) => patch({ sequence: seq.map((s, idx) => (idx === i ? val : s)) });
  const move = (i: number, dir: -1 | 1) => { const j = i + dir; if (j < 0 || j >= seq.length) return; const c = [...seq]; [c[i], c[j]] = [c[j], c[i]]; patch({ sequence: c }); };
  return (
    <div className="mt-5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Items in correct order</span>
      <p className="mb-2 text-[11px] text-[var(--muted)]">List the items in their CORRECT sequence — they're shuffled when served, and candidates reorder them.</p>
      <div className="space-y-2">
        {seq.map((it, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-[var(--card-2)] text-[11px] font-bold text-[var(--muted)]">{i + 1}</span>
            <input className="input h-9 flex-1" value={it} placeholder={`Item ${i + 1}`} onChange={(e) => set(i, e.target.value)} />
            <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-0.5 text-[var(--muted)] hover:text-[var(--fg)] disabled:opacity-30"><ChevronUp className="h-4 w-4" /></button>
            <button type="button" onClick={() => move(i, 1)} disabled={i === seq.length - 1} className="rounded p-0.5 text-[var(--muted)] hover:text-[var(--fg)] disabled:opacity-30"><ChevronDown className="h-4 w-4" /></button>
            <button type="button" onClick={() => patch({ sequence: seq.filter((_, idx) => idx !== i) })} disabled={seq.length <= 2} className="text-[var(--muted)] hover:text-rose-500 disabled:opacity-30"><X className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => patch({ sequence: [...seq, ""] })} className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-[#c6ff34] hover:underline"><Plus className="h-4 w-4" /> Add item</button>
    </div>
  );
}

/* ─────────────────────── Cloze (fill-in-the-blank) editor ─────────────────────── */
function ClozeBlankRow({ index, value, onChange, onRemove }: { index: number; value: string[]; onChange: (v: string[]) => void; onRemove: () => void }) {
  const [raw, setRaw] = useState(value.join(", "));
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-xs font-semibold text-[var(--muted)]">Blank {index + 1}</span>
      <input className="input h-9 flex-1" value={raw} placeholder="accepted, answers"
        onChange={(e) => setRaw(e.target.value)}
        onBlur={() => onChange(raw.split(",").map((s) => s.trim()).filter(Boolean))} />
      <button type="button" onClick={onRemove} className="text-[var(--muted)] hover:text-rose-500"><X className="h-4 w-4" /></button>
    </div>
  );
}
function ClozeEditor({ q, patch }: { q: Question; patch: (p: Partial<Question>) => void }) {
  const blanks = q.blanks ?? [];
  const detected = (q.prompt.match(/___/g) ?? []).length;
  return (
    <div className="mt-5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Blanks &amp; accepted answers</span>
      <p className="mb-2 text-[11px] text-[var(--muted)]">Put <code className="rounded bg-[var(--card-2)] px-1">___</code> (three underscores) in the question text for each blank, in order. Add the accepted answers (comma-separated) for each — case-insensitive.</p>
      {detected !== blanks.length && (
        <p className="mb-2 flex items-center gap-1.5 rounded-lg bg-amber-500/15 px-2.5 py-1.5 text-[11px] text-amber-500"><AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Your prompt has {detected} blank{detected === 1 ? "" : "s"} but {blanks.length} answer set{blanks.length === 1 ? "" : "s"} — they should match.</p>
      )}
      <div className="space-y-2">
        {blanks.map((b, i) => (
          <ClozeBlankRow key={i} index={i} value={b}
            onChange={(v) => patch({ blanks: blanks.map((x, idx) => (idx === i ? v : x)) })}
            onRemove={() => patch({ blanks: blanks.filter((_, idx) => idx !== i) })} />
        ))}
      </div>
      <button type="button" onClick={() => patch({ blanks: [...blanks, [""]] })} className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-[#c6ff34] hover:underline"><Plus className="h-4 w-4" /> Add blank</button>
    </div>
  );
}

/* ─────────────────────── Parameterized editor ─────────────────────── */
function ParameterizedEditor({ q, patch }: { q: Question; patch: (p: Partial<Question>) => void }) {
  const vars = q.paramVariables ?? [];
  const setVar = (i: number, key: "name" | "min" | "max" | "decimals", val: string) =>
    patch({ paramVariables: vars.map((v, idx) => (idx === i ? { ...v, [key]: key === "name" ? val : Number(val) || 0 } : v)) });
  const addVar = () => patch({ paramVariables: [...vars, { name: "", min: 1, max: 10, decimals: 0 }] });
  const removeVar = (i: number) => patch({ paramVariables: vars.filter((_, idx) => idx !== i) });

  // Live preview from mid-range sample values.
  const sample: Record<string, number> = {};
  for (const v of vars) {
    if (!v.name) continue;
    const f = Math.pow(10, Math.max(0, v.decimals | 0));
    sample[v.name] = Math.round(((v.min + v.max) / 2) * f) / f;
  }
  const previewPrompt = q.prompt.replace(/\{(\w+)\}/g, (m, n) => (n in sample ? String(sample[n]) : m));
  const previewAnswer = q.paramFormula ? tryEvalExpr(q.paramFormula, sample) : null;

  return (
    <div className="mt-5 space-y-4">
      <div>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Variables</span>
        <p className="mb-2 text-[11px] text-[var(--muted)]">Use <code className="rounded bg-[var(--card-2)] px-1">{'{name}'}</code> in the question text. Each candidate gets a random value between min and max.</p>
        <div className="space-y-2">
          {vars.map((v, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <label className="text-[11px] text-[var(--muted)]">Name<input className="input mt-1 h-9 w-24" value={v.name} placeholder="d" onChange={(e) => setVar(i, "name", e.target.value)} /></label>
              <label className="text-[11px] text-[var(--muted)]">Min<input className="input mt-1 h-9 w-24" type="number" step="any" value={v.min} onChange={(e) => setVar(i, "min", e.target.value)} /></label>
              <label className="text-[11px] text-[var(--muted)]">Max<input className="input mt-1 h-9 w-24" type="number" step="any" value={v.max} onChange={(e) => setVar(i, "max", e.target.value)} /></label>
              <label className="text-[11px] text-[var(--muted)]">Decimals<input className="input mt-1 h-9 w-20" type="number" min={0} value={v.decimals} onChange={(e) => setVar(i, "decimals", e.target.value)} /></label>
              <button type="button" onClick={() => removeVar(i)} className="mb-1.5 text-[var(--muted)] hover:text-rose-500"><X className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
        <button type="button" onClick={addVar} className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-[#c6ff34] hover:underline"><Plus className="h-4 w-4" /> Add variable</button>
      </div>

      <Field label="Answer formula">
        <input className="input h-10" value={q.paramFormula ?? ""} placeholder="e.g. d / t" onChange={(e) => patch({ paramFormula: e.target.value })} />
      </Field>
      <p className="-mt-2 text-[11px] text-[var(--muted)]">Use the variable names with <code className="rounded bg-[var(--card-2)] px-1">+ − * / ^ ( )</code> and functions like <code className="rounded bg-[var(--card-2)] px-1">sqrt, round, abs, min, max</code>. Computed per candidate.</p>

      <Field label="± Tolerance">
        <input className="input h-10 w-32" type="number" min={0} step="any" value={q.paramTolerance ?? 0} onChange={(e) => patch({ paramTolerance: Math.max(0, Number(e.target.value) || 0) })} />
      </Field>

      {vars.length > 0 && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card-2)] p-3 text-xs">
          <p className="font-semibold text-[var(--muted)]">Preview · sample values</p>
          <p className="mt-1">{previewPrompt || <span className="text-[var(--muted)]">Add a prompt with {'{name}'} markers…</span>}</p>
          <p className="mt-1 text-[var(--muted)]">Correct answer: <span className="font-semibold text-emerald-400">{previewAnswer == null ? "— (check formula)" : String(Math.round(previewAnswer * 1e6) / 1e6)}</span></p>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────── Hotspot editor ─────────────────────── */
function HotspotEditor({ q, patch }: { q: Question; patch: (p: Partial<Question>) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const hotspots = q.hotspots ?? [];
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    if (file.size > 2_000_000) { alert("Image must be under 2 MB."); return; }
    const r = new FileReader();
    r.onload = () => patch({ imageUrl: String(r.result) });
    r.readAsDataURL(file);
  };
  const toPct = (cx: number, cy: number) => {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: clamp(((cx - r.left) / r.width) * 100), y: clamp(((cy - r.top) / r.height) * 100) };
  };
  const onDown = (e: React.MouseEvent) => { if (!q.imageUrl) return; const p = toPct(e.clientX, e.clientY); startRef.current = p; setDraft({ x: p.x, y: p.y, w: 0, h: 0 }); };
  const onMove = (e: React.MouseEvent) => { if (!startRef.current) return; const p = toPct(e.clientX, e.clientY); const s = startRef.current; setDraft({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) }); };
  const onUp = () => { if (draft && draft.w > 1.5 && draft.h > 1.5) patch({ hotspots: [...hotspots, { x: Math.round(draft.x), y: Math.round(draft.y), w: Math.round(draft.w), h: Math.round(draft.h) }] }); startRef.current = null; setDraft(null); };
  return (
    <div className="mt-5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Image &amp; correct regions</span>
        <button type="button" onClick={() => fileRef.current?.click()} className="btn btn-outline h-8 text-xs"><ImageIcon className="h-3.5 w-3.5" /> {q.imageUrl ? "Change image" : "Upload image"}</button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pick} />
      </div>
      <p className="mb-2 mt-1 text-[11px] text-[var(--muted)]">Click and drag on the image to draw the correct region(s). A click inside any region scores.</p>
      {q.imageUrl ? (
        <div ref={boxRef} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
          className="relative inline-block max-w-full cursor-crosshair select-none overflow-hidden rounded-lg border border-[var(--border)]">
          <img src={q.imageUrl} alt="" draggable={false} className="block max-h-[360px] max-w-full" />
          {hotspots.map((r, i) => (
            <div key={i} className="group absolute border-2 border-emerald-500 bg-emerald-500/20" style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` }}>
              <button type="button" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); patch({ hotspots: hotspots.filter((_, idx) => idx !== i) }); }}
                className="absolute -right-2 -top-2 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-white"><X className="h-2.5 w-2.5" /></button>
            </div>
          ))}
          {draft && <div className="absolute border-2 border-dashed border-emerald-400 bg-emerald-400/10" style={{ left: `${draft.x}%`, top: `${draft.y}%`, width: `${draft.w}%`, height: `${draft.h}%` }} />}
        </div>
      ) : (
        <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-[var(--border)] text-sm text-[var(--muted)]">Upload an image to mark hotspots.</div>
      )}
      {q.imageUrl && <p className="mt-1.5 text-[11px] text-[var(--muted)]">{hotspots.length} region{hotspots.length === 1 ? "" : "s"} marked.</p>}
    </div>
  );
}

/* ─────────────────────── Exam blueprint ─────────────────────── */
function BlueprintEditor({ exam, questions, patchExam }: { exam: Exam; questions: Question[]; patchExam: (p: Partial<Exam>) => void }) {
  const bp = exam.blueprint ?? [];
  const allTags = [...new Set(questions.flatMap((q) => q.tags ?? []))].sort();
  const set = (i: number, key: "tag" | "count", val: string | number) => patchExam({ blueprint: bp.map((r, idx) => (idx === i ? { ...r, [key]: val } : r)) });
  const total = bp.reduce((s, r) => s + (r.count || 0), 0);
  return (
    <div className="card rounded-2xl p-6">
      <div className="flex items-center gap-2 text-sm font-bold"><ListChecks className="h-4 w-4 text-[#c6ff34]" /> Exam blueprint</div>
      <p className="mt-0.5 text-xs text-[var(--muted)]">Auto-assemble each attempt by drawing a set number of questions from each topic tag. When set, this overrides the random pool draw above.</p>
      {allTags.length === 0 ? (
        <p className="mt-3 text-xs text-[var(--muted)]">Tag some questions first (in a question's Advanced settings) to build a blueprint.</p>
      ) : (
        <>
          <div className="mt-3 space-y-2">
            {bp.map((r, i) => {
              const avail = questions.filter((q) => (q.tags ?? []).some((t) => t.toLowerCase() === r.tag.toLowerCase())).length;
              return (
                <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                  <Shuffle className="h-4 w-4 text-[var(--muted)]" /> Draw
                  <input type="number" min={1} className="input h-8 w-16" value={r.count} onChange={(e) => set(i, "count", Math.max(1, Number(e.target.value) || 1))} /> from
                  <select className="input h-8 w-auto" value={r.tag} onChange={(e) => set(i, "tag", e.target.value)}>
                    {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <span className={clsx("text-xs", r.count > avail ? "text-amber-500" : "text-[var(--muted)]")}>({avail} available)</span>
                  <button type="button" onClick={() => patchExam({ blueprint: bp.filter((_, idx) => idx !== i) })} className="text-[var(--muted)] hover:text-rose-500"><X className="h-4 w-4" /></button>
                </div>
              );
            })}
          </div>
          <button type="button" onClick={() => patchExam({ blueprint: [...bp, { tag: allTags[0], count: 1 }] })} className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-[#c6ff34] hover:underline"><Plus className="h-4 w-4" /> Add blueprint rule</button>
          {bp.length > 0 && <p className="mt-2 text-xs text-[var(--muted)]">Assembles {total} question{total === 1 ? "" : "s"} per attempt{exam.shuffleQuestions === false ? "" : ", in shuffled order"}.</p>}
        </>
      )}
    </div>
  );
}

/* ─────────────────────── Grading scheme & release ─────────────────────── */
function pad2(n: number) { return String(n).padStart(2, "0"); }
function toLocalInput(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function GradingSchemeCard({ exam, patchExam }: { exam: Exam; patchExam: (p: Partial<Exam>) => void }) {
  const scale = exam.gradeScale ?? { mode: "none" as const, value: 0 };
  const bands = exam.gradeBands ?? [];
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const setBand = (i: number, key: "label" | "min", val: string | number) => patchExam({ gradeBands: bands.map((b, idx) => (idx === i ? { ...b, [key]: val } : b)) });
  const recompute = async () => {
    setBusy(true); setMsg(null);
    try { const r = await api.post<{ updated: number }>(`/admin/exams/${exam.id}/recompute-results`); setMsg(`Re-applied to ${r.updated} existing result${r.updated === 1 ? "" : "s"}.`); }
    catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <div className="card rounded-2xl p-6">
      <div className="flex items-center gap-2 text-sm font-bold"><Target className="h-4 w-4 text-[#c6ff34]" /> Grading scheme &amp; release</div>
      <p className="mt-0.5 text-xs text-[var(--muted)]">Curve raw scores, set letter-grade boundaries, and choose when students see their results.</p>

      {/* Curve */}
      <div className="mt-4">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Score curve</span>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
          <select className="input h-9 w-auto" value={scale.mode} onChange={(e) => patchExam({ gradeScale: { mode: e.target.value as "none" | "add" | "multiply", value: scale.value } })}>
            <option value="none">No curve</option>
            <option value="add">Add points</option>
            <option value="multiply">Multiply by factor</option>
          </select>
          {scale.mode !== "none" && (
            <>
              <input type="number" step={scale.mode === "multiply" ? 0.05 : 1} className="input h-9 w-24" value={scale.value}
                onChange={(e) => patchExam({ gradeScale: { mode: scale.mode, value: Number(e.target.value) || 0 } })} />
              <span className="text-xs text-[var(--muted)]">{scale.mode === "add" ? "points added to every score (capped at 100)" : "× every raw score (capped at 100)"}</span>
            </>
          )}
        </div>
      </div>

      {/* Letter boundaries */}
      <div className="mt-5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Grade boundaries{bands.length ? ` · ${bands.length}` : ""}</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => patchExam({ gradeBands: DEFAULT_GRADE_BANDS.map((b) => ({ ...b })) })} className="text-xs text-[var(--muted)] hover:text-[#c6ff34]">Use A–F default</button>
            <button type="button" onClick={() => patchExam({ gradeBands: [...bands, { label: "", min: 0 }] })} className="inline-flex items-center gap-1 text-xs text-[#c6ff34] hover:underline"><Plus className="h-3.5 w-3.5" /> Band</button>
          </div>
        </div>
        {bands.length === 0 ? (
          <p className="mt-1.5 text-[11px] text-[var(--muted)]">No letter grades — results show the percentage only.</p>
        ) : (
          <div className="mt-2 space-y-1.5">
            {bands.map((b, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <input className="input h-8 w-20" value={b.label} placeholder="A" maxLength={8} onChange={(e) => setBand(i, "label", e.target.value)} />
                <span className="text-xs text-[var(--muted)]">when score ≥</span>
                <input type="number" min={0} max={100} className="input h-8 w-20" value={b.min} onChange={(e) => setBand(i, "min", Math.max(0, Math.min(100, Number(e.target.value) || 0)))} />
                <span className="text-xs text-[var(--muted)]">%</span>
                <button type="button" onClick={() => patchExam({ gradeBands: bands.filter((_, idx) => idx !== i) })} className="text-[var(--muted)] hover:text-rose-500"><X className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Scheduled release */}
      <div className="mt-5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Scheduled result release</span>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
          <input type="datetime-local" className="input h-9 w-auto" value={toLocalInput(exam.resultsReleaseAt)}
            onChange={(e) => patchExam({ resultsReleaseAt: e.target.value ? new Date(e.target.value).toISOString() : null })} />
          {exam.resultsReleaseAt && <button type="button" onClick={() => patchExam({ resultsReleaseAt: null })} className="text-xs text-[var(--muted)] hover:text-rose-500">Clear</button>}
        </div>
        <p className="mt-1 text-[11px] text-[var(--muted)]">{exam.resultsReleaseAt ? "Students can't see their score until this time." : "Leave blank to release results as soon as they're graded."}</p>
      </div>

      {/* Anonymous grading */}
      <button type="button" onClick={() => patchExam({ anonymousGrading: !exam.anonymousGrading })}
        className={clsx("mt-5 flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left transition", exam.anonymousGrading ? "border-[#c6ff34]/40 bg-[rgba(198,255,52,0.08)]" : "border-[var(--border)] hover:bg-[var(--card-2)]")}>
        <div><p className="text-sm font-medium">Anonymous (double-blind) grading</p><p className="text-xs text-[var(--muted)]">Hide candidate identity from graders while marking — names, emails and webcam frames are revealed only after release.</p></div>
        <span className={clsx("inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition", exam.anonymousGrading ? "bg-[#c6ff34]" : "bg-[var(--border)]")}><span className={clsx("h-4 w-4 rounded-full bg-white transition", exam.anonymousGrading && "translate-x-4")} /></span>
      </button>

      {/* Apply to existing */}
      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-4">
        <button type="button" onClick={recompute} disabled={busy} className="btn btn-outline h-9 disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Apply scheme to existing results
        </button>
        {msg && <span className="text-xs text-[var(--muted)]">{msg}</span>}
      </div>
    </div>
  );
}

/* ─────────────────────── Pick-from-bank modal ─────────────────────── */
type BankQ = Question & { examTitle: string; examCode: string; examStatus: string };
function PickFromBankModal({ excludeExamId, onClose, onAdd }: { excludeExamId: string; onClose: () => void; onAdd: (ids: string[]) => Promise<void> }) {
  const [all, setAll] = useState<BankQ[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"all" | QuestionType>("all");
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get<{ questions: BankQ[] }>("/admin/questions").then((d) => setAll(d.questions)).catch(() => setAll([])); }, []);
  const filtered = (all ?? []).filter((q) =>
    q.examId !== excludeExamId &&
    (type === "all" || q.type === type) &&
    (!query.trim() || q.prompt.toLowerCase().includes(query.trim().toLowerCase()) || (q.tags ?? []).some((t) => t.toLowerCase().includes(query.trim().toLowerCase()))));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const confirm = async () => { if (!sel.size) return; setBusy(true); try { await onAdd([...sel]); } finally { setBusy(false); } };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3.5">
          <h2 className="inline-flex items-center gap-2 text-base font-bold"><Library className="h-5 w-5 text-[#c6ff34]" /> Pick from question bank</h2>
          <button onClick={onClose} className="rounded p-1 text-[var(--muted)] hover:text-[var(--fg)]"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-5 py-3">
          <div className="flex min-w-[180px] flex-1 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card-2)] px-3 py-1.5">
            <Search className="h-4 w-4 text-[var(--muted)]" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search prompt or tag…" className="w-full bg-transparent text-sm outline-none" />
          </div>
          <select value={type} onChange={(e) => setType(e.target.value as typeof type)} className="input h-9 w-auto text-sm">
            <option value="all">All types</option>
            {(Object.keys(TYPE_META) as QuestionType[]).map((t) => <option key={t} value={t}>{TYPE_META[t].short}</option>)}
          </select>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {!all ? (
            <div className="flex items-center gap-2 p-6 text-sm text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> Loading bank…</div>
          ) : filtered.length === 0 ? (
            <p className="p-6 text-center text-sm text-[var(--muted)]">No matching questions in other exams.</p>
          ) : filtered.map((q) => {
            const M = TYPE_META[q.type]; const on = sel.has(q.id);
            return (
              <button key={q.id} onClick={() => toggle(q.id)} className={clsx("flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left transition", on ? "bg-[rgba(198,255,52,0.1)] ring-1 ring-[#c6ff34]/40" : "hover:bg-[var(--card-2)]")}>
                <span className={clsx("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded", on ? "bg-[#c6ff34] text-[#111110]" : "border border-[var(--border)] text-transparent")}><Check className="h-3.5 w-3.5" /></span>
                <M.icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--muted)]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{q.prompt || "(no prompt)"}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-[var(--muted)]">
                    <span>{M.short}</span> · <span>{q.points} pts</span> · <span className="truncate">{q.examTitle}</span>
                    {(q.tags ?? []).slice(0, 3).map((t) => <span key={t} className="rounded-full bg-[var(--card-2)] px-1.5 py-px text-[#c6ff34]">{t}</span>)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-between border-t border-[var(--border)] px-5 py-3">
          <span className="text-xs text-[var(--muted)]">{sel.size} selected</span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="btn btn-outline h-9">Cancel</button>
            <button onClick={confirm} disabled={!sel.size || busy} className="btn btn-primary h-9 disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add {sel.size || ""} to exam</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewView({ exam, questions }: { exam: Exam; questions: Question[] }) {
  return (
    <div className="card overflow-hidden">
      <div className="h-2.5 w-full" style={{ background: G.accent }} />
      <div className="p-6">
        <h2 className="text-2xl font-bold">{exam.title}</h2>
        {exam.description && <p className="mt-1 text-sm text-[var(--muted)]">{exam.description}</p>}
        <p className="mt-2 text-xs text-[var(--muted)]">{exam.durationMinutes} min · Pass ≥ {exam.passingScore}%{exam.proctored ? " · Proctored" : ""}</p>
        <div className="mt-6 space-y-6">
          {questions.length === 0 && <p className="text-sm text-[var(--muted)]">No questions yet.</p>}
          {questions.map((q, i) => (
            <div key={q.id}>
              <p className="text-sm font-medium">{i + 1}. <MathText>{q.prompt || "(no prompt)"}</MathText> <span className="text-xs text-[var(--muted)]">· {q.points} pts</span></p>
              <div className="mt-2 space-y-2 pl-4">
                {q.type === "short" || q.type === "numeric" ? (
                  <div className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]">{q.type === "numeric" ? "Numeric answer…" : "Short text answer…"}</div>
                ) : q.type === "essay" || q.type === "code" || q.type === "file_upload" ? (
                  <div className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]">{q.type === "code" ? "Code editor…" : q.type === "file_upload" ? "File upload…" : "Long-form answer…"}</div>
                ) : q.type === "matching" ? (
                  <div className="space-y-1.5">
                    {(q.matchPairs ?? []).map((p, j) => (
                      <div key={j} className="flex items-center gap-2 text-sm"><span className="min-w-[120px] rounded-lg border border-[var(--border)] px-3 py-1.5"><MathText>{p.left}</MathText></span><ArrowLeftRight className="h-3.5 w-3.5 text-[var(--muted)]" /><span className="rounded-lg border border-dashed border-[var(--border)] px-3 py-1.5 text-[var(--muted)]">{p.right}</span></div>
                    ))}
                  </div>
                ) : q.type === "ordering" ? (
                  <ol className="list-decimal space-y-1 pl-5 text-sm">{(q.sequence ?? []).map((it, j) => <li key={j}>{it}</li>)}</ol>
                ) : q.type === "cloze" ? (
                  <p className="text-sm text-[var(--muted)]">{(q.blanks ?? []).length} blank{(q.blanks ?? []).length === 1 ? "" : "s"} to fill.</p>
                ) : q.type === "hotspot" ? (
                  q.imageUrl ? <img src={q.imageUrl} alt="" className="max-h-48 rounded-lg border border-[var(--border)]" /> : <div className="rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]">No image yet</div>
                ) : q.type === "parameterized" ? (
                  <div className="space-y-1.5 text-sm text-[var(--muted)]">
                    <input className="input max-w-xs" type="number" placeholder="Enter a number…" disabled />
                    <p className="text-[11px]"><span className="text-[#c6ff34]">⚙</span> Numbers in <code className="rounded bg-[var(--card-2)] px-1">{'{…}'}</code> are randomised per candidate; the answer is computed from the formula.</p>
                  </div>
                ) : (
                  (q.options ?? []).map((opt) => (
                    <div key={opt} className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm"><Circle className="h-4 w-4 text-[var(--muted)]" /> <span className="capitalize"><MathText>{opt}</MathText></span></div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
