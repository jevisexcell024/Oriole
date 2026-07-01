import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  Loader2, Users, Award, CheckCircle2, AlertTriangle, Activity, ChevronDown,
  BarChart3, Download, Send, Copy, Search, Folder, ListChecks, PencilLine,
  FileText, Mic2, Pin, MoreHorizontal, ExternalLink, ArrowUpDown, Users2,
} from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { useT } from "@/lib/i18n";
import { clsx } from "clsx";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Overview {
  attempts: number; inProgress: number; passRate: number;
  avgScore: number; certificates: number; flags: number;
}
interface PerExam {
  examId: string; title: string; code: string; subject: string | null;
  status: string; type: string; attempts: number; avgScore: number; passRate: number;
}
interface AttemptRow {
  id: string; candidateId: string; candidateName: string; candidateEmail: string;
  examId: string; examTitle: string; examCode: string;
  score: number; rawScore: number; letter: string | null; passed: boolean;
  submittedAt: string | null; flagCount: number; integrity: number; gradingStatus: string;
}
interface FolderRow extends PerExam {
  highest: number; lowest: number; lastActivity: string | null;
  flagCount: number; pendingCount: number;
  palette: { accent: string; bg: string; border: string };
}
interface CohortExam {
  examId: string; title: string; code: string; scheduledStart: string | null;
  submitted: number; avgScore: number; passRate: number;
}
interface CohortRaw {
  id: string; name: string; code: string; memberCount: number; examCount: number;
  avgScore: number; passRate: number; lastActivity: string | null; exams: CohortExam[];
}
interface CohortRow extends CohortRaw {
  palette: { accent: string; bg: string; border: string };
}

// ── Palette & icons ───────────────────────────────────────────────────────────
const PALETTES = [
  { accent: "#fe3bed", bg: "rgba(254,59,237,0.1)",   border: "#fe3bed" },
  { accent: "#c6ff34", bg: "rgba(198,255,52,0.1)",   border: "#c6ff34" },
  { accent: "#ffffff", bg: "rgba(255,255,255,0.07)",  border: "#ffffff" },
];
const hashPalette = (id: string) =>
  PALETTES[id.split("").reduce((h, c) => h + c.charCodeAt(0), 0) % PALETTES.length];

const TYPE_META: Record<string, { Icon: typeof Folder; label: string }> = {
  mcq:     { Icon: ListChecks, label: "MCQ"          },
  shorts:  { Icon: PencilLine, label: "Short Answer" },
  written: { Icon: FileText,   label: "Written"      },
  viva:    { Icon: Mic2,       label: "Viva"         },
};
const typeMeta = (t: string) => TYPE_META[t] ?? { Icon: Folder, label: t };

// ── Formatters ────────────────────────────────────────────────────────────────
const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

const fmtAgo = (iso: string | null) => {
  if (!iso) return "—";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24); if (d === 1) return "Yesterday";
  return `${d}d ago`;
};

// ── CSV helpers ───────────────────────────────────────────────────────────────
const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function downloadCsv(name: string, text: string) {
  const blob = new Blob([text], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  URL.revokeObjectURL(a.href);
}

function buildGradebook(rows: AttemptRow[], format: "canvas" | "moodle"): string {
  const exams = [...new Map(rows.map((r) => [r.examId, r.examTitle])).entries()];
  const students = new Map<string, { name: string; email: string; scores: Record<string, number> }>();
  for (const r of [...rows].sort((a, b) => (a.submittedAt ?? "").localeCompare(b.submittedAt ?? ""))) {
    const s = students.get(r.candidateId) ?? { name: r.candidateName, email: r.candidateEmail, scores: {} };
    s.scores[r.examId] = r.score;
    students.set(r.candidateId, s);
  }
  if (format === "canvas") {
    const header = ["Student", "ID", "SIS Login ID", "Section", ...exams.map(([, t]) => `${t} (Score)`)];
    const points = ["    Points Possible", "", "", "", ...exams.map(() => "100")];
    const lines = [...students.entries()].map(([id, s]) =>
      [s.name, id, s.email, "Oriole", ...exams.map(([eid]) => s.scores[eid] != null ? String(s.scores[eid]) : "")]);
    return [header, points, ...lines].map((r) => r.map((c) => esc(String(c))).join(",")).join("\n");
  }
  const header = ["First name", "Last name", "Email address", ...exams.map(([, t]) => t)];
  const lines = [...students.values()].map((s) => {
    const parts = s.name.trim().split(/\s+/); const first = parts.shift() ?? "";
    return [first, parts.join(" "), s.email, ...exams.map(([eid]) => s.scores[eid] != null ? String(s.scores[eid]) : "")];
  });
  return [header, ...lines].map((r) => r.map((c) => esc(String(c))).join(",")).join("\n");
}

function exportFolderCsv(folder: FolderRow, attempts: AttemptRow[]) {
  const header = ["Candidate", "Email", "Score", "Grade", "Result", "Integrity", "Flags", "Status", "Submitted"];
  const lines = attempts.map((r) => [
    r.candidateName, r.candidateEmail, `${r.score}%`, r.letter ?? "",
    r.passed ? "Pass" : "Fail", String(r.integrity), String(r.flagCount),
    r.gradingStatus, fmt(r.submittedAt),
  ]);
  downloadCsv(`${folder.code || folder.examId}-results.csv`,
    [header, ...lines].map((r) => r.map((c) => esc(String(c))).join(",")).join("\n"));
}

// ── Main component ────────────────────────────────────────────────────────────
export function AdminResults() {
  const t = useT();
  const navigate = useNavigate();
  const [data, setData] = useState<{ overview: Overview; perExam: PerExam[]; attempts: AttemptRow[] } | null>(null);
  const [cohortsRaw, setCohortsRaw] = useState<CohortRaw[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [releasing, setReleasing] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"exam" | "cohort">("exam");

  const reload = () =>
    api.get<{ overview: Overview; perExam: PerExam[]; attempts: AttemptRow[] }>("/admin/results")
      .then(setData).catch((e) => setError((e as Error).message));

  const reloadCohorts = () =>
    api.get<{ cohorts: CohortRaw[] }>("/admin/results-by-cohort")
      .then((d) => setCohortsRaw(d.cohorts)).catch(() => setCohortsRaw([]));

  useEffect(() => { reload(); reloadCohorts(); }, []);

  const exportGradebook = (format: "canvas" | "moodle") => {
    if (!data) return;
    downloadCsv(`oriole-gradebook-${format}.csv`, buildGradebook(data.attempts, format));
    setExportOpen(false);
  };

  const releaseAll = async (examId: string, title: string) => {
    if (!confirm(t("ares.confirmRelease", { title }))) return;
    setReleasing(examId);
    try {
      const r = await api.post<{ released: number; skipped: number }>(`/admin/exams/${examId}/release-all`);
      await reload();
      alert(t("ares.released", { released: r.released, extra: r.skipped ? t("ares.releasedSkipped", { skipped: r.skipped }) : "" }));
    } catch (e) { alert((e as Error).message); }
    finally { setReleasing(null); }
  };

  // Enhance perExam with client-derived stats
  const folders = useMemo<FolderRow[]>(() => {
    if (!data) return [];
    return data.perExam.map((pe) => {
      const ax = data.attempts.filter((a) => a.examId === pe.examId);
      const scores = ax.map((a) => a.score);
      const byRecent = [...ax].sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""));
      return {
        ...pe,
        highest: scores.length ? Math.max(...scores) : 0,
        lowest:  scores.length ? Math.min(...scores) : 0,
        lastActivity: byRecent[0]?.submittedAt ?? null,
        flagCount: ax.reduce((s, a) => s + a.flagCount, 0),
        pendingCount: ax.filter((a) => a.gradingStatus === "pending_review").length,
        palette: hashPalette(pe.examId),
      };
    });
  }, [data]);

  const cohortFolders = useMemo<CohortRow[]>(() => {
    if (!cohortsRaw) return [];
    return cohortsRaw.map((c) => ({ ...c, palette: hashPalette(c.id) }));
  }, [cohortsRaw]);

  return (
    <AdminShell wide>
      <div className="fade-in">
        <PageHeader
          title={t("ares.title")}
          subtitle={t("ares.subtitle")}
          actions={
            <div className="relative">
              <button onClick={() => setExportOpen((o) => !o)} className="btn btn-on-teal">
                <Download className="h-4 w-4" /> {t("ares.exportGradebook")}
              </button>
              {exportOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
                  <div className="absolute right-0 z-20 mt-2 w-52 rounded-xl border border-[var(--border)] bg-[var(--card)] p-1 shadow-2xl">
                    <button onClick={() => exportGradebook("canvas")} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--card-2)]">
                      <Download className="h-4 w-4 text-[var(--muted)]" /> {t("ares.canvasCsv")}
                    </button>
                    <button onClick={() => exportGradebook("moodle")} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--card-2)]">
                      <Download className="h-4 w-4 text-[var(--muted)]" /> {t("ares.moodleCsv")}
                    </button>
                  </div>
                </>
              )}
            </div>
          }
        />

        {error && (
          <p className="mt-6 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</p>
        )}
        {!data && !error && (
          <div className="mt-10 flex items-center gap-2 text-[var(--muted)]">
            <Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}
          </div>
        )}

        {data && (
          <>
            {/* ── KPI cards — unchanged ── */}
            <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
              <Kpi icon={Users}         label={t("ares.kpiSubmitted")}   value={data.overview.attempts} />
              <Kpi icon={CheckCircle2}  label={t("ares.kpiPassRate")}    value={`${data.overview.passRate}%`}    tone="emerald" />
              <Kpi icon={BarChart3}     label={t("ares.kpiAvgScore")}    value={`${data.overview.avgScore}%`} />
              <Kpi icon={Award}         label={t("ares.kpiCertificates")} value={data.overview.certificates} />
              <Kpi icon={AlertTriangle} label={t("ares.kpiFlags")}       value={data.overview.flags} tone={data.overview.flags > 0 ? "amber" : undefined} />
            </div>

            {/* ── View toggle ── */}
            <div className="mt-8 flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                {viewMode === "exam"
                  ? <Folder className="h-4 w-4" style={{ color: "#c6ff34" }} />
                  : <Users2 className="h-4 w-4" style={{ color: "#c6ff34" }} />}
                {viewMode === "exam" ? "Examinations" : "Cohorts"}
                <span className="rounded-full bg-[var(--card-2)] px-2 py-0.5 text-xs font-medium text-[var(--muted)]">
                  {viewMode === "exam" ? folders.length : cohortFolders.length}
                </span>
              </h2>
              <ViewToggle mode={viewMode} setMode={setViewMode} />
            </div>

            {/* ── Folder Explorer ── */}
            {viewMode === "exam" ? (
              <FolderExplorer
                folders={folders}
                attempts={data.attempts}
                releasing={releasing}
                onReleaseAll={releaseAll}
                onNavigate={(path) => navigate(path)}
              />
            ) : (
              <CohortExplorer
                cohorts={cohortFolders}
                onNavigate={(path) => navigate(path)}
              />
            )}
          </>
        )}
      </div>
    </AdminShell>
  );
}

// ── Folder Explorer ───────────────────────────────────────────────────────────
type SortKey = "recent" | "alpha" | "attempts";
const SORT_OPTS: { id: SortKey; label: string }[] = [
  { id: "recent",   label: "Recent Activity" },
  { id: "alpha",    label: "Alphabetical"    },
  { id: "attempts", label: "Most Attempts"   },
];

function FolderExplorer({ folders, attempts, releasing, onReleaseAll, onNavigate }: {
  folders: FolderRow[];
  attempts: AttemptRow[];
  releasing: string | null;
  onReleaseAll: (examId: string, title: string) => void;
  onNavigate: (path: string) => void;
}) {
  const [search, setSearch]   = useState("");
  const [sort, setSort]       = useState<SortKey>("recent");
  const [openId, setOpenId]   = useState<string | null>(null);
  const [pinned, setPinned]   = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("oriole-pinned-exams") ?? "[]")); }
    catch { return new Set(); }
  });

  const togglePin = (id: string) => {
    setPinned((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      localStorage.setItem("oriole-pinned-exams", JSON.stringify([...next]));
      return next;
    });
  };

  const toggle = (id: string) => setOpenId((prev) => (prev === id ? null : id));

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = q
      ? folders.filter((f) =>
          f.title.toLowerCase().includes(q) ||
          f.code.toLowerCase().includes(q) ||
          (f.subject ?? "").toLowerCase().includes(q))
      : folders;
    const sorted = [...rows];
    if (sort === "alpha")    sorted.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === "attempts") sorted.sort((a, b) => b.attempts - a.attempts);
    else sorted.sort((a, b) => (b.lastActivity ?? "").localeCompare(a.lastActivity ?? ""));
    const pinnedRows   = sorted.filter((f) =>  pinned.has(f.examId));
    const unpinnedRows = sorted.filter((f) => !pinned.has(f.examId));
    return [...pinnedRows, ...unpinnedRows];
  }, [folders, search, sort, pinned]);

  return (
    <div className="mt-4">
      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center justify-end gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2">
            <Search className="h-3.5 w-3.5 text-[var(--muted)]" />
            <input
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search examinations…"
              className="w-40 bg-transparent text-sm outline-none placeholder:text-[var(--muted)]"
            />
          </div>
          <div className="flex rounded-lg border border-[var(--border)] bg-[var(--card)] p-0.5">
            {SORT_OPTS.map((o) => (
              <button key={o.id} onClick={() => setSort(o.id)}
                className={clsx("rounded-md px-3 py-1.5 text-xs font-medium transition",
                  sort === o.id
                    ? "bg-[var(--card-2)] text-[var(--fg)]"
                    : "text-[var(--muted)] hover:text-[var(--fg)]")}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* List */}
      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-[var(--border)] py-20 text-center">
          <Folder className="h-12 w-12 text-[var(--muted)]" />
          <p className="text-sm font-medium text-[var(--muted)]">
            {search ? "No examinations match your search." : "No submitted attempts yet."}
          </p>
          {!search && (
            <p className="max-w-sm text-xs text-[var(--muted)]">
              Student submissions will automatically appear here once candidates complete their assessments.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((folder) => (
            <ExamFolder
              key={folder.examId}
              folder={folder}
              attempts={attempts.filter((a) => a.examId === folder.examId)}
              isOpen={openId === folder.examId}
              onToggle={() => toggle(folder.examId)}
              isPinned={pinned.has(folder.examId)}
              onPin={() => togglePin(folder.examId)}
              releasing={releasing === folder.examId}
              onReleaseAll={() => onReleaseAll(folder.examId, folder.title)}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Exam Folder ───────────────────────────────────────────────────────────────
function ExamFolder({ folder, attempts, isOpen, onToggle, isPinned, onPin, releasing, onReleaseAll, onNavigate }: {
  folder: FolderRow; attempts: AttemptRow[]; isOpen: boolean; onToggle: () => void;
  isPinned: boolean; onPin: () => void; releasing: boolean;
  onReleaseAll: () => void; onNavigate: (path: string) => void;
}) {
  const { Icon, label: typeLabel } = typeMeta(folder.type);
  const p = folder.palette;
  const [menuOpen, setMenuOpen] = useState(false);

  const menuActions = [
    { label: "Open Analysis",       icon: ExternalLink, onClick: () => onNavigate(`/admin/exams/${folder.examId}/analysis`) },
    { label: "Release All Results", icon: Send,         onClick: onReleaseAll, loading: releasing },
    { label: "Similarity Report",   icon: Copy,         onClick: () => onNavigate(`/admin/exams/${folder.examId}/similarity`) },
    { label: "Export CSV",          icon: Download,     onClick: () => exportFolderCsv(folder, attempts) },
    { label: isPinned ? "Unpin" : "Pin to top", icon: Pin, onClick: onPin },
  ] as const;

  return (
    <div
      className="overflow-hidden rounded-2xl border transition-all duration-200"
      style={{ borderColor: isOpen ? p.border : "var(--border)", background: isOpen ? p.bg : "var(--card)" }}
    >
      {/* Header row */}
      <button className="flex w-full items-center gap-4 px-5 py-4 text-left" onClick={onToggle}>
        {/* Type icon */}
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
          style={{ background: p.bg, border: `1px solid ${p.border}` }}>
          <Icon className="h-5 w-5" style={{ color: p.accent }} />
        </div>

        {/* Title + meta */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-semibold leading-tight">{folder.title || "Untitled"}</span>
            {isPinned && <Pin className="h-3 w-3 shrink-0 text-[var(--muted)]" />}
            {folder.pendingCount > 0 && (
              <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-400">
                {folder.pendingCount} pending
              </span>
            )}
            {folder.flagCount > 0 && (
              <span className="shrink-0 rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-bold text-rose-400">
                {folder.flagCount} flag{folder.flagCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--muted)]">
            {folder.code    && <span className="font-mono">{folder.code}</span>}
            {folder.subject && <span>{folder.subject}</span>}
            <span className="inline-flex items-center gap-1" style={{ color: p.accent }}>
              <Icon className="h-3 w-3" />{typeLabel}
            </span>
          </div>
        </div>

        {/* Stats strip — hidden on mobile */}
        <div className="hidden items-center gap-6 lg:flex">
          <StatChip label="Attempts"      value={folder.attempts}               accent={p.accent} />
          <StatChip label="Avg Score"     value={`${folder.avgScore}%`}         accent={p.accent} />
          <StatChip label="Pass Rate"     value={`${folder.passRate}%`}         accent={folder.passRate >= 50 ? "#10b981" : "#ef4444"} />
          <StatChip label="Last Activity" value={fmtAgo(folder.lastActivity)}   muted />
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-2 pl-2" onClick={(e) => e.stopPropagation()}>
          <div className="relative">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--fg)]">
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 z-20 mt-1 w-52 rounded-xl border border-[var(--border)] bg-[var(--card)] p-1 shadow-2xl">
                  {menuActions.map((a) => (
                    <button key={a.label}
                      onClick={() => { a.onClick(); setMenuOpen(false); }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm text-[var(--muted)] transition hover:bg-[var(--card-2)] hover:text-[var(--fg)]">
                      {"loading" in a && a.loading
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <a.icon className="h-4 w-4" />}
                      {a.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <ChevronDown
            className={clsx("h-5 w-5 text-[var(--muted)] transition-transform duration-200", isOpen && "rotate-180")} />
        </div>
      </button>

      {/* Expanded body */}
      {isOpen && (
        <div className="fade-in border-t px-5 pb-6 pt-5" style={{ borderColor: p.border }}>
          <FolderBody folder={folder} attempts={attempts} onNavigate={onNavigate} palette={p} />
        </div>
      )}
    </div>
  );
}

function StatChip({ label, value, accent, muted }: { label: string; value: string | number; accent?: string; muted?: boolean }) {
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{label}</span>
      <span className="text-sm font-semibold tabular-nums"
        style={muted ? { color: "var(--muted)" } : { color: accent ?? "var(--fg)" }}>
        {value}
      </span>
    </div>
  );
}

// ── View Toggle ───────────────────────────────────────────────────────────────
function ViewToggle({ mode, setMode }: { mode: "exam" | "cohort"; setMode: (m: "exam" | "cohort") => void }) {
  return (
    <div className="flex rounded-lg border border-[var(--border)] bg-[var(--card)] p-0.5">
      {(["exam", "cohort"] as const).map((m) => (
        <button key={m} onClick={() => setMode(m)}
          className={clsx("rounded-md px-3 py-1.5 text-xs font-medium transition",
            mode === m
              ? "bg-[var(--card-2)] text-[var(--fg)]"
              : "text-[var(--muted)] hover:text-[var(--fg)]")}>
          {m === "exam" ? "By Exam" : "By Cohort"}
        </button>
      ))}
    </div>
  );
}

// ── Cohort Explorer ──────────────────────────────────────────────────────────
function CohortExplorer({ cohorts, onNavigate }: {
  cohorts: CohortRow[];
  onNavigate: (path: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"recent" | "alpha" | "members">("recent");
  const [openId, setOpenId] = useState<string | null>(null);
  const [pinned, setPinned] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("oriole-pinned-cohorts") ?? "[]")); }
    catch { return new Set(); }
  });

  const togglePin = (id: string) => {
    setPinned((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      localStorage.setItem("oriole-pinned-cohorts", JSON.stringify([...next]));
      return next;
    });
  };

  const toggle = (id: string) => setOpenId((prev) => (prev === id ? null : id));

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = q
      ? cohorts.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q))
      : cohorts;
    const sorted = [...rows];
    if (sort === "alpha")        sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "members") sorted.sort((a, b) => b.memberCount - a.memberCount);
    else sorted.sort((a, b) => (b.lastActivity ?? "").localeCompare(a.lastActivity ?? ""));
    const pinnedRows   = sorted.filter((c) =>  pinned.has(c.id));
    const unpinnedRows = sorted.filter((c) => !pinned.has(c.id));
    return [...pinnedRows, ...unpinnedRows];
  }, [cohorts, search, sort, pinned]);

  const sortOpts: { id: "recent" | "alpha" | "members"; label: string }[] = [
    { id: "recent",  label: "Recent Activity" },
    { id: "alpha",   label: "Alphabetical"    },
    { id: "members", label: "Most Students"   },
  ];

  return (
    <div className="mt-4">
      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center justify-end gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2">
            <Search className="h-3.5 w-3.5 text-[var(--muted)]" />
            <input
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search cohorts…"
              className="w-40 bg-transparent text-sm outline-none placeholder:text-[var(--muted)]"
            />
          </div>
          <div className="flex rounded-lg border border-[var(--border)] bg-[var(--card)] p-0.5">
            {sortOpts.map((o) => (
              <button key={o.id} onClick={() => setSort(o.id)}
                className={clsx("rounded-md px-3 py-1.5 text-xs font-medium transition",
                  sort === o.id
                    ? "bg-[var(--card-2)] text-[var(--fg)]"
                    : "text-[var(--muted)] hover:text-[var(--fg)]")}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* List */}
      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-[var(--border)] py-20 text-center">
          <Users2 className="h-12 w-12 text-[var(--muted)]" />
          <p className="text-sm font-medium text-[var(--muted)]">
            {search ? "No cohorts match your search." : "No classes have exams assigned yet."}
          </p>
          {!search && (
            <p className="max-w-sm text-xs text-[var(--muted)]">
              Assign an examination to a class from the Classes page to see cohort results here.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((cohort) => (
            <CohortFolder
              key={cohort.id}
              cohort={cohort}
              isOpen={openId === cohort.id}
              onToggle={() => toggle(cohort.id)}
              isPinned={pinned.has(cohort.id)}
              onPin={() => togglePin(cohort.id)}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CohortFolder({ cohort, isOpen, onToggle, isPinned, onPin, onNavigate }: {
  cohort: CohortRow; isOpen: boolean; onToggle: () => void;
  isPinned: boolean; onPin: () => void; onNavigate: (path: string) => void;
}) {
  const p = cohort.palette;

  return (
    <div
      className="overflow-hidden rounded-2xl border transition-all duration-200"
      style={{ borderColor: isOpen ? p.border : "var(--border)", background: isOpen ? p.bg : "var(--card)" }}
    >
      {/* Header row */}
      <button className="flex w-full items-center gap-4 px-5 py-4 text-left" onClick={onToggle}>
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
          style={{ background: p.bg, border: `1px solid ${p.border}` }}>
          <Users2 className="h-5 w-5" style={{ color: p.accent }} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-semibold leading-tight">{cohort.name || "Untitled"}</span>
            {isPinned && <Pin className="h-3 w-3 shrink-0 text-[var(--muted)]" />}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--muted)]">
            {cohort.code && <span className="font-mono">{cohort.code}</span>}
            <span>{cohort.memberCount} student{cohort.memberCount !== 1 ? "s" : ""}</span>
            <span>{cohort.examCount} exam{cohort.examCount !== 1 ? "s" : ""}</span>
          </div>
        </div>

        <div className="hidden items-center gap-6 lg:flex">
          <StatChip label="Avg Score"     value={`${cohort.avgScore}%`}       accent={p.accent} />
          <StatChip label="Pass Rate"     value={`${cohort.passRate}%`}       accent={cohort.passRate >= 50 ? "#10b981" : "#ef4444"} />
          <StatChip label="Last Activity" value={fmtAgo(cohort.lastActivity)} muted />
        </div>

        <div className="flex shrink-0 items-center gap-2 pl-2" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={onPin} title={isPinned ? "Unpin" : "Pin to top"}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--fg)]">
            <Pin className="h-4 w-4" />
          </button>
          <ChevronDown
            className={clsx("h-5 w-5 text-[var(--muted)] transition-transform duration-200", isOpen && "rotate-180")} />
        </div>
      </button>

      {/* Expanded body */}
      {isOpen && (
        <div className="fade-in border-t px-5 pb-6 pt-5" style={{ borderColor: p.border }}>
          {cohort.exams.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[var(--border)] py-12 text-center">
              <Activity className="h-8 w-8 text-[var(--muted)]" />
              <p className="text-sm font-medium text-[var(--muted)]">No exams assigned to this class yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--card-2)]">
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Exam</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Scheduled</th>
                    <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Submitted</th>
                    <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Avg Score</th>
                    <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Pass Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {cohort.exams.map((e) => (
                    <tr key={e.examId}
                      onClick={() => onNavigate(`/admin/exams/${e.examId}/analysis`)}
                      className="cursor-pointer transition hover:bg-[var(--card-2)]">
                      <td className="px-3 py-3">
                        <p className="font-medium leading-tight">{e.title}</p>
                        {e.code && <p className="font-mono text-xs text-[var(--muted)]">{e.code}</p>}
                      </td>
                      <td className="px-3 py-3 text-xs text-[var(--muted)] whitespace-nowrap">{fmt(e.scheduledStart)}</td>
                      <td className="px-3 py-3 text-right font-mono">{e.submitted}/{cohort.memberCount}</td>
                      <td className="px-3 py-3 text-right font-semibold" style={{ color: p.accent }}>{e.avgScore}%</td>
                      <td className="px-3 py-3 text-right font-semibold" style={{ color: e.passRate >= 50 ? "#10b981" : "#ef4444" }}>{e.passRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Folder Body ───────────────────────────────────────────────────────────────
function FolderBody({ folder, attempts, onNavigate, palette }: {
  folder: FolderRow; attempts: AttemptRow[];
  onNavigate: (p: string) => void;
  palette: { accent: string; bg: string; border: string };
}) {
  const statCards = [
    { label: "Total Attempts",  value: folder.attempts,      color: palette.accent },
    { label: "Pass Rate",       value: `${folder.passRate}%`,color: folder.passRate >= 50 ? "#10b981" : "#ef4444" },
    { label: "Average Score",   value: `${folder.avgScore}%`,color: "var(--fg)" },
    { label: "Highest Score",   value: `${folder.highest}%`, color: "#10b981" },
    { label: "Lowest Score",    value: `${folder.lowest}%`,  color: "#ef4444" },
    { label: "Pending Review",  value: folder.pendingCount,  color: folder.pendingCount  > 0 ? "#f59e0b" : "var(--muted)" },
    { label: "Integrity Flags", value: folder.flagCount,     color: folder.flagCount     > 0 ? "#f59e0b" : "var(--muted)" },
  ];

  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {statCards.map((s) => (
          <div key={s.label} className="rounded-xl p-3" style={{ background: "var(--card-2)" }}>
            <p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{s.label}</p>
            <p className="mt-1.5 text-xl font-bold tabular-nums" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>
      <CandidateTable attempts={attempts} onNavigate={onNavigate} />
    </>
  );
}

// ── Candidate Table ───────────────────────────────────────────────────────────
function CandidateTable({ attempts, onNavigate }: {
  attempts: AttemptRow[];
  onNavigate: (p: string) => void;
}) {
  const [search,       setSearch]       = useState("");
  const [resultFilter, setResultFilter] = useState<"all" | "pass" | "fail">("all");
  const [flagOnly,     setFlagOnly]     = useState(false);
  const [sortKey,      setSortKey]      = useState<"score" | "name" | "date">("score");
  const [sortDir,      setSortDir]      = useState<"asc" | "desc">("desc");
  const [page,         setPage]         = useState(0);
  const PER = 10;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = attempts;
    if (q)                      rows = rows.filter((r) => r.candidateName.toLowerCase().includes(q) || r.candidateEmail.toLowerCase().includes(q));
    if (resultFilter === "pass") rows = rows.filter((r) =>  r.passed);
    if (resultFilter === "fail") rows = rows.filter((r) => !r.passed);
    if (flagOnly)                rows = rows.filter((r) =>  r.flagCount > 0);
    const sorted = [...rows];
    const mul = sortDir === "desc" ? -1 : 1;
    if (sortKey === "name") sorted.sort((a, b) => mul * a.candidateName.localeCompare(b.candidateName));
    else if (sortKey === "date") sorted.sort((a, b) => mul * (a.submittedAt ?? "").localeCompare(b.submittedAt ?? ""));
    else sorted.sort((a, b) => mul * (a.score - b.score));
    return sorted;
  }, [attempts, search, resultFilter, flagOnly, sortKey, sortDir]);

  const pages = Math.max(1, Math.ceil(filtered.length / PER));
  const shown = filtered.slice(page * PER, page * PER + PER);

  const cycleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(key); setSortDir("desc"); }
    setPage(0);
  };

  if (attempts.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[var(--border)] py-12 text-center">
        <Activity className="h-8 w-8 text-[var(--muted)]" />
        <p className="text-sm font-medium text-[var(--muted)]">No attempts have been submitted for this examination yet.</p>
        <p className="text-xs text-[var(--muted)]">
          Student submissions will automatically appear here once candidates complete this assessment.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Table toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card-2)] px-3 py-1.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
          <input
            value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search candidates…"
            className="w-36 bg-transparent text-sm outline-none placeholder:text-[var(--muted)]"
          />
        </div>
        <div className="flex rounded-lg border border-[var(--border)] bg-[var(--card-2)] p-0.5">
          {(["all", "pass", "fail"] as const).map((v) => (
            <button key={v} onClick={() => { setResultFilter(v); setPage(0); }}
              className={clsx("rounded-md px-2.5 py-1 text-xs font-medium capitalize transition",
                resultFilter === v
                  ? "bg-[var(--card)] text-[var(--fg)] shadow-sm"
                  : "text-[var(--muted)] hover:text-[var(--fg)]")}>
              {v}
            </button>
          ))}
        </div>
        <button
          onClick={() => { setFlagOnly((f) => !f); setPage(0); }}
          className={clsx("flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition",
            flagOnly
              ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
              : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)]")}>
          <AlertTriangle className="h-3.5 w-3.5" /> Flagged only
        </button>
        <span className="ml-auto text-xs text-[var(--muted)]">
          {filtered.length} candidate{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--card-2)]">
              <SortTh label="Candidate"  onClick={() => cycleSort("name")} active={sortKey === "name"} dir={sortDir} />
              <SortTh label="Score"      onClick={() => cycleSort("score")} active={sortKey === "score"} dir={sortDir} right />
              <th className="px-3 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Grade</th>
              <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Result</th>
              <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Integrity</th>
              <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Flags</th>
              <SortTh label="Submitted" onClick={() => cycleSort("date")} active={sortKey === "date"} dir={sortDir} />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {shown.map((r) => (
              <tr key={r.id}
                onClick={() => onNavigate(`/admin/attempts/${r.id}`)}
                className="cursor-pointer transition hover:bg-[var(--card-2)]">
                <td className="px-3 py-3">
                  <p className="font-medium leading-tight">{r.candidateName}</p>
                  <p className="text-xs text-[var(--muted)]">{r.candidateEmail}</p>
                </td>
                <td className="px-3 py-3 text-right">
                  <span className="font-mono font-semibold">{r.score}%</span>
                  {r.rawScore !== r.score && (
                    <span className="ml-1 text-[10px] text-[var(--muted)]">curved</span>
                  )}
                </td>
                <td className="px-3 py-3 text-center">
                  {r.letter
                    ? <span className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-md bg-brand-500/15 px-1.5 text-xs font-bold text-brand-400">{r.letter}</span>
                    : <span className="text-[var(--muted)]">—</span>}
                </td>
                <td className="px-3 py-3">
                  <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-semibold",
                    r.passed ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400")}>
                    {r.passed ? "Pass" : "Fail"}
                  </span>
                </td>
                <td className="px-3 py-3 text-right">
                  <span className={clsx("font-mono font-semibold",
                    r.integrity >= 80 ? "text-emerald-400" : r.integrity >= 60 ? "text-amber-400" : "text-rose-400")}>
                    {r.integrity}
                  </span>
                </td>
                <td className="px-3 py-3 text-right">
                  {r.flagCount > 0
                    ? <span className="inline-flex items-center gap-1 text-amber-400"><AlertTriangle className="h-3.5 w-3.5" />{r.flagCount}</span>
                    : <span className="text-[var(--muted)]">0</span>}
                </td>
                <td className="px-3 py-3 text-xs text-[var(--muted)] whitespace-nowrap">{fmt(r.submittedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="mt-3 flex items-center justify-between text-xs text-[var(--muted)]">
          <span>Page {page + 1} of {pages} · {filtered.length} total</span>
          <div className="flex gap-1.5">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 transition hover:text-[var(--fg)] disabled:opacity-40">
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 transition hover:text-[var(--fg)] disabled:opacity-40">
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SortTh({ label, onClick, active, dir, right }: {
  label: string; onClick: () => void; active: boolean; dir: "asc" | "desc"; right?: boolean;
}) {
  return (
    <th onClick={onClick}
      className={clsx("cursor-pointer select-none px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)] transition hover:text-[var(--fg)]",
        right ? "text-right" : "text-left")}>
      <span className="inline-flex items-center gap-1">
        {label}
        {active && <ArrowUpDown className="h-3 w-3" style={{ color: "#c6ff34" }} />}
      </span>
    </th>
  );
}

// ── KPI card ──────────────────────────────────────────────────────────────────
function Kpi({ icon: Icon, label, value, tone }: {
  icon: typeof Users; label: string; value: string | number; tone?: "emerald" | "amber";
}) {
  return (
    <div className="card p-4">
      <div className={clsx("flex h-9 w-9 items-center justify-center rounded-lg",
        tone === "emerald" ? "bg-emerald-500/15 text-emerald-400"
          : tone === "amber" ? "bg-amber-500/15 text-amber-400"
          : "bg-brand-500/15 text-brand-400")}>
        <Icon className="h-5 w-5" />
      </div>
      <p className="mt-3 text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-xs text-[var(--muted)]">{label}</p>
    </div>
  );
}

// Satisfy the ReactNode import (used only for TS, tree-shaken at build time)
const _: ReactNode = null;
void _;
