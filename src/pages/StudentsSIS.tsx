import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Loader2, ArrowRight, ArrowLeft, Mail, Award, ShieldCheck,
  CheckCircle2, XCircle, Hourglass, BookOpen, Calendar, Users2,
  Search, ChevronDown, Pin, MoreHorizontal, ArrowUpDown,
  Download, Activity, Brain, TrendingDown, Minus, GraduationCap, Target, Check,
} from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { PageHeader } from "@/components/PageHeader";
import { api } from "@/lib/api";
import type { StudentTrend as StudentTrendData, SubjectTrend as SubjectTrendItem } from "@shared/types";
import { TrendingUp } from "lucide-react";
import { useT, type TFn } from "@/lib/i18n";
import { clsx } from "clsx";

// Accent colours for subject differentiation — the surrounding cards stay on
// the app's own theme tokens (var(--card)/var(--border)/var(--fg)) so this
// panel matches the rest of the page; only these per-subject accents are hardcoded.
const SUBJ_LIME = "#c6ff34", SUBJ_CYAN = "#22d3ee", SUBJ_PURPLE = "#c084fc", SUBJ_ORANGE = "#fb923c", SUBJ_GREEN = "#4ade80", SUBJ_ROSE = "#f43f5e";
const SUBJECT_COLORS = [SUBJ_LIME, SUBJ_CYAN, SUBJ_PURPLE, SUBJ_ORANGE, SUBJ_GREEN, SUBJ_ROSE];

// ── Types ──────────────────────────────────────────────────────────────────────
interface StudentRow {
  id: string; name: string; email: string;
  studentClass: string | null; gender: string | null; age: number | null; phone: string | null;
  enrollments: number; confirmed: number; completed: number;
  avgScore: number | null; avgIntegrity: number | null; certificates: number;
  missingDays: number; lastActivity: string | null;
}
interface ClassInfo { id: string; name: string; code: string; memberIds: string[]; }
interface Totals { students: number; completed: number; certificates: number; avgScore: number | null; }

interface ClassFolder {
  id: string; name: string; code: string;
  students: StudentRow[];
  avgScore: number | null; passRate: number | null; lastActivity: string | null;
  palette: { accent: string; bg: string; border: string };
}

// ── Palette ────────────────────────────────────────────────────────────────────
const PALETTES = [
  { accent: "#fe3bed", bg: "rgba(254,59,237,0.1)",  border: "#fe3bed" },
  { accent: "#c6ff34", bg: "rgba(198,255,52,0.1)",  border: "#c6ff34" },
  { accent: "#ffffff", bg: "rgba(255,255,255,0.07)", border: "#ffffff" },
];
const UNASSIGNED_PALETTE = { accent: "#6b7280", bg: "rgba(107,114,128,0.05)", border: "rgba(107,114,128,0.2)" };

const hashPalette = (id: string) =>
  PALETTES[id.split("").reduce((h, c) => h + c.charCodeAt(0), 0) % PALETTES.length];

// ── Helpers ────────────────────────────────────────────────────────────────────
const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";

const fmtAgo = (iso: string | null) => {
  if (!iso) return "—";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24); if (d === 1) return "Yesterday";
  return `${d}d ago`;
};

function initials(name: string) {
  return name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}
function scoreTone(n: number | null) {
  if (n === null) return "text-[var(--muted)]";
  return n >= 80 ? "text-emerald-400" : n >= 60 ? "text-amber-400" : "text-rose-400";
}
/** Same score→tone banding as scoreTone, as a hex value for inline SVG/style use. */
function scoreHex(n: number | null) {
  if (n === null) return "var(--muted)";
  return n >= 80 ? "#34d399" : n >= 60 ? "#fbbf24" : "#fb7185";
}

const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function exportFolderCsv(cls: ClassFolder) {
  const header = ["Name", "Email", "Class", "Enrollments", "Completed", "Avg Score", "Integrity", "Certificates", "Last Activity"];
  const lines = cls.students.map((s) => [
    s.name, s.email, cls.name,
    String(s.enrollments), String(s.completed),
    s.avgScore !== null ? `${s.avgScore}%` : "",
    s.avgIntegrity !== null ? String(s.avgIntegrity) : "",
    String(s.certificates), fmtDate(s.lastActivity),
  ]);
  const csv = [header, ...lines].map((r) => r.map((c) => esc(c)).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${cls.code || cls.name.replace(/\s+/g, "-")}-students.csv`;
  a.click(); URL.revokeObjectURL(a.href);
}

// ── Main ───────────────────────────────────────────────────────────────────────
export function StudentsSIS() {
  const t = useT();
  const navigate = useNavigate();
  const [data, setData] = useState<{ students: StudentRow[]; classes: ClassInfo[]; totals: Totals } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ students: StudentRow[]; classes: ClassInfo[]; totals: Totals }>("/admin/students")
      .then(setData).catch((e) => setError((e as Error).message));
  }, []);

  // Build class folders
  const folders = useMemo<ClassFolder[]>(() => {
    if (!data) return [];
    const studentMap = new Map(data.students.map((s) => [s.id, s]));
    const assigned = new Set<string>();

    const classFolders: ClassFolder[] = data.classes.map((cls) => {
      const students = cls.memberIds
        .map((id) => studentMap.get(id))
        .filter((s): s is StudentRow => !!s);
      students.forEach((s) => assigned.add(s.id));

      const scores = students.flatMap((s) => (s.avgScore !== null ? [s.avgScore] : []));
      const passed = students.filter((s) => s.avgScore !== null && s.avgScore >= 50).length;
      const byRecent = [...students].sort((a, b) => (b.lastActivity ?? "").localeCompare(a.lastActivity ?? ""));

      return {
        id: cls.id, name: cls.name, code: cls.code,
        students,
        avgScore: scores.length ? Math.round(scores.reduce((p, c) => p + c, 0) / scores.length) : null,
        passRate: students.length ? Math.round((passed / students.length) * 100) : null,
        lastActivity: byRecent[0]?.lastActivity ?? null,
        palette: hashPalette(cls.id),
      };
    });

    // Unassigned
    const unassigned = data.students.filter((s) => !assigned.has(s.id));
    if (unassigned.length > 0) {
      const scores = unassigned.flatMap((s) => (s.avgScore !== null ? [s.avgScore] : []));
      const passed = unassigned.filter((s) => s.avgScore !== null && s.avgScore >= 50).length;
      const byRecent = [...unassigned].sort((a, b) => (b.lastActivity ?? "").localeCompare(a.lastActivity ?? ""));
      classFolders.push({
        id: "__unassigned__", name: "Unassigned", code: "",
        students: unassigned,
        avgScore: scores.length ? Math.round(scores.reduce((p, c) => p + c, 0) / scores.length) : null,
        passRate: unassigned.length ? Math.round((passed / unassigned.length) * 100) : null,
        lastActivity: byRecent[0]?.lastActivity ?? null,
        palette: UNASSIGNED_PALETTE,
      });
    }

    return classFolders;
  }, [data]);

  return (
    <AdminShell wide>
      <div className="fade-in">
        <PageHeader title={t("asis.title")} subtitle={t("asis.subtitle")} />

        {error && (
          <p className="mt-6 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</p>
        )}
        {!data && !error && (
          <div className="mt-8 flex items-center gap-2 text-[var(--muted)]">
            <Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}
          </div>
        )}

        {data && (
          <>
            {/* KPI cards */}
            <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Kpi label={t("asis.kpiStudents")}     value={data.totals.students} />
              <Kpi label={t("asis.kpiCompleted")}    value={data.totals.completed} />
              <Kpi label={t("asis.kpiAvgScore")}     value={data.totals.avgScore === null ? "—" : `${data.totals.avgScore}%`} />
              <Kpi label={t("asis.kpiCertificates")} value={data.totals.certificates} />
            </div>

            {/* Folder explorer */}
            <ClassExplorer
              folders={folders}
              onNavigate={(path) => navigate(path)}
            />
          </>
        )}
      </div>
    </AdminShell>
  );
}

// ── Class Explorer ─────────────────────────────────────────────────────────────
type SortKey = "alpha" | "members" | "score" | "recent";
const SORT_OPTS: { id: SortKey; label: string }[] = [
  { id: "alpha",   label: "A–Z"          },
  { id: "members", label: "Most Members" },
  { id: "score",   label: "Best Score"   },
  { id: "recent",  label: "Recent"       },
];

function ClassExplorer({ folders, onNavigate }: {
  folders: ClassFolder[];
  onNavigate: (path: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [sort,   setSort]   = useState<SortKey>("alpha");
  const [openId, setOpenId] = useState<string | null>(null);
  const [pinned, setPinned] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("oriole-pinned-classes") ?? "[]")); }
    catch { return new Set(); }
  });

  const togglePin = (id: string) => {
    setPinned((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      localStorage.setItem("oriole-pinned-classes", JSON.stringify([...next]));
      return next;
    });
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = q
      ? folders.filter((f) =>
          f.name.toLowerCase().includes(q) ||
          f.code.toLowerCase().includes(q) ||
          f.students.some((s) => s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q)))
      : folders;

    const unassignedRow = rows.find((f) => f.id === "__unassigned__");
    const rest = rows.filter((f) => f.id !== "__unassigned__");
    const sorted = [...rest];

    if (sort === "members") sorted.sort((a, b) => b.students.length - a.students.length);
    else if (sort === "score") sorted.sort((a, b) => (b.avgScore ?? -1) - (a.avgScore ?? -1));
    else if (sort === "recent") sorted.sort((a, b) => (b.lastActivity ?? "").localeCompare(a.lastActivity ?? ""));
    else sorted.sort((a, b) => a.name.localeCompare(b.name));

    const pinnedRows   = sorted.filter((f) =>  pinned.has(f.id));
    const unpinnedRows = sorted.filter((f) => !pinned.has(f.id));
    const ordered = [...pinnedRows, ...unpinnedRows];
    if (unassignedRow) ordered.push(unassignedRow);
    return ordered;
  }, [folders, search, sort, pinned]);

  return (
    <div className="mt-8">
      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Users2 className="h-4 w-4" style={{ color: "#c6ff34" }} />
          Classes
          <span className="rounded-full bg-[var(--card-2)] px-2 py-0.5 text-xs font-medium text-[var(--muted)]">
            {folders.filter((f) => f.id !== "__unassigned__").length}
          </span>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2">
            <Search className="h-3.5 w-3.5 text-[var(--muted)]" />
            <input
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search classes or students…"
              className="w-44 bg-transparent text-sm outline-none placeholder:text-[var(--muted)]"
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

      {/* Folder list */}
      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-[var(--border)] py-20 text-center">
          <Users2 className="h-12 w-12 text-[var(--muted)]" />
          <p className="text-sm font-medium text-[var(--muted)]">
            {search ? "No classes or students match your search." : "No students yet."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((folder) => (
            <ClassFolderRow
              key={folder.id}
              folder={folder}
              isOpen={openId === folder.id}
              onToggle={() => setOpenId((prev) => (prev === folder.id ? null : folder.id))}
              isPinned={pinned.has(folder.id)}
              onPin={() => togglePin(folder.id)}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Class Folder Row ───────────────────────────────────────────────────────────
function ClassFolderRow({ folder, isOpen, onToggle, isPinned, onPin, onNavigate }: {
  folder: ClassFolder; isOpen: boolean; onToggle: () => void;
  isPinned: boolean; onPin: () => void;
  onNavigate: (path: string) => void;
}) {
  const p = folder.palette;
  const [menuOpen, setMenuOpen] = useState(false);
  const isUnassigned = folder.id === "__unassigned__";

  return (
    <div
      className="overflow-hidden rounded-2xl border transition-all duration-200"
      style={{ borderColor: isOpen ? p.border : "var(--border)", background: isOpen ? p.bg : "var(--card)" }}
    >
      {/* Header */}
      <button className="flex w-full items-center gap-4 px-5 py-4 text-left" onClick={onToggle}>
        {/* Icon */}
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
          style={{ background: p.bg, border: `1px solid ${p.border}` }}>
          <Users2 className="h-5 w-5" style={{ color: p.accent }} />
        </div>

        {/* Title */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-semibold leading-tight">{folder.name}</span>
            {isPinned && !isUnassigned && <Pin className="h-3 w-3 shrink-0 text-[var(--muted)]" />}
            {isUnassigned && (
              <span className="shrink-0 rounded-full bg-[var(--card-2)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--muted)]">
                no class assigned
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-[var(--muted)]">
            {folder.code && <span className="font-mono">{folder.code}</span>}
            <span style={{ color: p.accent }}>
              {folder.students.length} student{folder.students.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {/* Stats strip */}
        <div className="hidden items-center gap-6 lg:flex">
          <StatChip label="Avg Score"  value={folder.avgScore !== null ? `${folder.avgScore}%` : "—"} accent={folder.avgScore !== null ? p.accent : undefined} />
          <StatChip label="Pass Rate"  value={folder.passRate !== null ? `${folder.passRate}%` : "—"} accent={folder.passRate !== null ? (folder.passRate >= 50 ? "#10b981" : "#ef4444") : undefined} />
          <StatChip label="Last Active" value={fmtAgo(folder.lastActivity)} muted />
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-2 pl-2" onClick={(e) => e.stopPropagation()}>
          {!isUnassigned && (
            <div className="relative">
              <button
                onClick={() => setMenuOpen((o) => !o)}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] transition hover:text-[var(--fg)]">
                <MoreHorizontal className="h-4 w-4" />
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 z-20 mt-1 w-52 rounded-xl border border-[var(--border)] bg-[var(--card)] p-1 shadow-2xl">
                    <button onClick={() => { onNavigate(`/admin/classes/${folder.id}`); setMenuOpen(false); }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm text-[var(--muted)] hover:bg-[var(--card-2)] hover:text-[var(--fg)]">
                      <Users2 className="h-4 w-4" /> Manage Class
                    </button>
                    <button onClick={() => { exportFolderCsv(folder); setMenuOpen(false); }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm text-[var(--muted)] hover:bg-[var(--card-2)] hover:text-[var(--fg)]">
                      <Download className="h-4 w-4" /> Export CSV
                    </button>
                    <button onClick={() => { onPin(); setMenuOpen(false); }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm text-[var(--muted)] hover:bg-[var(--card-2)] hover:text-[var(--fg)]">
                      <Pin className="h-4 w-4" /> {isPinned ? "Unpin" : "Pin to top"}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          {isUnassigned && (
            <button onClick={() => exportFolderCsv(folder)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] transition hover:text-[var(--fg)]"
              title="Export CSV">
              <Download className="h-4 w-4" />
            </button>
          )}
          <ChevronDown
            className={clsx("h-5 w-5 text-[var(--muted)] transition-transform duration-200", isOpen && "rotate-180")} />
        </div>
      </button>

      {/* Expanded body */}
      {isOpen && (
        <div className="fade-in border-t px-5 pb-6 pt-4" style={{ borderColor: p.border }}>
          {/* Summary stat cards */}
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "Students",   value: folder.students.length,                                                   color: p.accent },
              { label: "Avg Score",  value: folder.avgScore !== null ? `${folder.avgScore}%` : "—",                  color: "var(--fg)" },
              { label: "Pass Rate",  value: folder.passRate !== null ? `${folder.passRate}%` : "—",                  color: folder.passRate !== null ? (folder.passRate >= 50 ? "#10b981" : "#ef4444") : "var(--muted)" },
              { label: "Last Active",value: fmtAgo(folder.lastActivity),                                              color: "var(--muted)" },
            ].map((s) => (
              <div key={s.label} className="rounded-xl p-3" style={{ background: "var(--card-2)" }}>
                <p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{s.label}</p>
                <p className="mt-1.5 text-xl font-bold tabular-nums" style={{ color: s.color }}>{s.value}</p>
              </div>
            ))}
          </div>
          <StudentTable students={folder.students} onNavigate={onNavigate} />
        </div>
      )}
    </div>
  );
}

// ── Student Table ──────────────────────────────────────────────────────────────
type StudentSortKey = "name" | "score" | "integrity" | "completed" | "last";

function StudentTable({ students, onNavigate }: {
  students: StudentRow[];
  onNavigate: (path: string) => void;
}) {
  const [search,  setSearch]  = useState("");
  const [sortKey, setSortKey] = useState<StudentSortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page,    setPage]    = useState(0);
  const PER = 10;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = q
      ? students.filter((s) => s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q))
      : students;
    const mul = sortDir === "desc" ? -1 : 1;
    const sorted = [...rows];
    if (sortKey === "score")     sorted.sort((a, b) => mul * ((a.avgScore ?? -1) - (b.avgScore ?? -1)));
    else if (sortKey === "integrity") sorted.sort((a, b) => mul * ((a.avgIntegrity ?? -1) - (b.avgIntegrity ?? -1)));
    else if (sortKey === "completed") sorted.sort((a, b) => mul * (a.completed - b.completed));
    else if (sortKey === "last") sorted.sort((a, b) => mul * (a.lastActivity ?? "").localeCompare(b.lastActivity ?? ""));
    else sorted.sort((a, b) => mul * a.name.localeCompare(b.name));
    return sorted;
  }, [students, search, sortKey, sortDir]);

  const pages = Math.max(1, Math.ceil(filtered.length / PER));
  const shown = filtered.slice(page * PER, page * PER + PER);

  const cycleSort = (key: StudentSortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "name" ? "asc" : "desc"); }
    setPage(0);
  };

  if (students.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[var(--border)] py-10 text-center">
        <Activity className="h-8 w-8 text-[var(--muted)]" />
        <p className="text-sm font-medium text-[var(--muted)]">No students in this class yet.</p>
        <p className="text-xs text-[var(--muted)]">
          Add students from the <span className="text-[var(--fg)]">Manage Class</span> page.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card-2)] px-3 py-1.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
          <input
            value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search students…"
            className="w-36 bg-transparent text-sm outline-none placeholder:text-[var(--muted)]"
          />
        </div>
        <span className="ml-auto text-xs text-[var(--muted)]">
          {filtered.length} student{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--card-2)]">
              <SortTh label="Student"   onClick={() => cycleSort("name")}      active={sortKey === "name"}      dir={sortDir} />
              <SortTh label="Completed" onClick={() => cycleSort("completed")} active={sortKey === "completed"} dir={sortDir} right />
              <SortTh label="Avg Score" onClick={() => cycleSort("score")}     active={sortKey === "score"}     dir={sortDir} right />
              <SortTh label="Integrity" onClick={() => cycleSort("integrity")} active={sortKey === "integrity"} dir={sortDir} right />
              <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Certs</th>
              <SortTh label="Last Active" onClick={() => cycleSort("last")} active={sortKey === "last"} dir={sortDir} />
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {shown.map((s) => (
              <tr key={s.id}
                onClick={() => onNavigate(`/admin/students/${s.id}`)}
                className="cursor-pointer transition hover:bg-[var(--card-2)]">
                <td className="px-3 py-3">
                  <span className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#111110] text-[11px] font-bold text-white">
                      {initials(s.name)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{s.name}</span>
                      <span className="block truncate text-xs text-[var(--muted)]">{s.email}</span>
                    </span>
                  </span>
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{s.completed}</td>
                <td className={clsx("px-3 py-3 text-right font-semibold tabular-nums", scoreTone(s.avgScore))}>
                  {s.avgScore !== null ? `${s.avgScore}%` : "—"}
                </td>
                <td className={clsx("px-3 py-3 text-right font-semibold tabular-nums", scoreTone(s.avgIntegrity))}>
                  {s.avgIntegrity !== null ? s.avgIntegrity : "—"}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-[var(--muted)]">
                  {s.certificates || "—"}
                </td>
                <td className="px-3 py-3 text-xs text-[var(--muted)] whitespace-nowrap">
                  {fmtAgo(s.lastActivity)}
                </td>
                <td className="px-3 py-3 text-right">
                  <ArrowRight className="ml-auto h-4 w-4 text-[var(--muted)]" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="mt-3 flex items-center justify-between text-xs text-[var(--muted)]">
          <span>Page {page + 1} of {pages}</span>
          <div className="flex gap-1.5">
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 transition hover:text-[var(--fg)] disabled:opacity-40">
              Previous
            </button>
            <button onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 transition hover:text-[var(--fg)] disabled:opacity-40">
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared primitives ──────────────────────────────────────────────────────────
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

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

// ── Student Record (unchanged) ─────────────────────────────────────────────────
const APPROVAL_KEY: Record<string, string> = { confirmed: "asis.apprConfirmed", pending: "asis.apprPending", rejected: "asis.apprRejected" };

interface Enrollment {
  regId: string; examTitle: string; examCode: string; status: string; approval: string;
  scheduled: string | null; checkedIn: boolean; identity: string | null; registeredAt: string | null;
}
interface AttemptRow {
  attemptId: string; examTitle: string; examCode: string; score: number; passed: boolean;
  gradingStatus: string; submittedAt: string | null; integrity: number; certNumber: string | null;
}
interface CertRow { certNumber: string; examTitle: string; score: number; issuedAt: string; }
interface RecordData {
  student: { id: string; name: string; email: string; accommodationsExtraMinutes: number };
  aiEnabled: boolean;
  stats: { enrollments: number; completed: number; avgScore: number | null; passRate: number | null; avgIntegrity: number | null; certificates: number; gpa: number | null };
  enrollments: Enrollment[];
  attempts: AttemptRow[];
  certificates: CertRow[];
  trend: StudentTrendData;
}

const APPROVAL_TONE: Record<string, string> = {
  confirmed: "bg-emerald-500/20 text-emerald-400",
  pending: "bg-amber-500/20 text-amber-400",
  rejected: "bg-rose-500/20 text-rose-400",
};

export function StudentRecord() {
  const t = useT();
  const { id } = useParams();
  const [data, setData] = useState<RecordData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acc, setAcc] = useState("0");
  const [accBusy, setAccBusy] = useState(false);
  const [accMsg, setAccMsg] = useState<string | null>(null);

  useEffect(() => {
    api.get<RecordData>(`/admin/students/${id}`)
      .then((d) => { setData(d); setAcc(String(d.student.accommodationsExtraMinutes ?? 0)); })
      .catch((e) => setError((e as Error).message));
  }, [id]);

  const saveAcc = async () => {
    setAccBusy(true); setAccMsg(null);
    try {
      const r = await api.patch<{ accommodationsExtraMinutes: number }>(`/admin/candidates/${id}/accommodations`, { extraMinutes: Number(acc) || 0 });
      setAcc(String(r.accommodationsExtraMinutes));
      setAccMsg(t("asis.saved"));
      setTimeout(() => setAccMsg(null), 1500);
    } catch (e) { setAccMsg((e as Error).message); }
    finally { setAccBusy(false); }
  };

  if (error) return <AdminShell wide><p className="text-sm text-rose-400">{error}</p></AdminShell>;
  if (!data) return (
    <AdminShell wide>
      <div className="flex items-center gap-2 text-[var(--muted)]">
        <Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}
      </div>
    </AdminShell>
  );

  const { student, stats, enrollments, attempts, certificates, trend } = data;

  return (
    <AdminShell wide>
      <div className="fade-in max-w-4xl">
        <div className="flex items-center justify-between gap-3 print:hidden">
          <Link to="/admin/students" className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--fg)]">
            <ArrowLeft className="h-4 w-4" /> {t("acan.title")}
          </Link>
          <button onClick={() => window.print()} className="btn btn-outline h-8 text-xs">
            <Download className="h-3.5 w-3.5" /> {t("asis.downloadReport")}
          </button>
        </div>

        {/* Print-only report letterhead */}
        <div className="hidden print:block print:mb-4">
          <h1 className="text-lg font-bold">{t("asis.reportTitle")}</h1>
          <p className="text-xs text-[var(--muted)]">{t("asis.generatedOn", { date: fmtDate(new Date().toISOString()) })}</p>
        </div>

        {/* Profile header */}
        <div className="card mt-4 p-6 print:mt-0">
          <div className="flex flex-wrap items-center justify-between gap-5">
            <div className="flex items-center gap-4">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#111110] text-lg font-bold text-white">
                {initials(student.name)}
              </span>
              <div>
                <h1 className="text-xl font-bold tracking-tight">{student.name}</h1>
                <p className="flex items-center gap-1.5 text-sm text-[var(--muted)]">
                  <Mail className="h-3.5 w-3.5" /> {student.email}
                </p>
              </div>
            </div>
            {stats.enrollments > 0 && (
              <RadialRing
                value={Math.round((stats.completed / stats.enrollments) * 100)}
                color={SUBJ_LIME}
                label={t("asis.completion")}
                sublabel={t("asis.completionOf", { completed: stats.completed, total: stats.enrollments })}
              />
            )}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-7">
            <IconStatChip icon={Users2}       label={t("asis.stEnrolled")}     value={stats.enrollments} />
            <IconStatChip icon={CheckCircle2} label={t("asis.stCompleted")}    value={stats.completed} tone="text-brand-400" />
            <IconStatChip icon={TrendingUp}   label={t("asis.stAvgScore")}     value={stats.avgScore === null ? "—" : `${stats.avgScore}%`} tone={scoreTone(stats.avgScore)} />
            <IconStatChip icon={GraduationCap} label={t("asis.stGpa")}         value={stats.gpa === null ? "—" : stats.gpa.toFixed(2)} />
            <IconStatChip icon={Target}       label={t("asis.stPassRate")}     value={stats.passRate === null ? "—" : `${stats.passRate}%`} tone={scoreTone(stats.passRate)} />
            <IconStatChip icon={ShieldCheck}  label={t("asis.stIntegrity")}    value={stats.avgIntegrity === null ? "—" : stats.avgIntegrity} tone={scoreTone(stats.avgIntegrity)} />
            <IconStatChip icon={Award}        label={t("asis.stCertificates")} value={stats.certificates} tone="text-amber-400" />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-4 text-sm print:hidden">
            <Hourglass className="h-4 w-4 text-brand-400" />
            <span className="font-medium">{t("asis.accommodation")}</span>
            <input type="number" min={0} max={600} className="input h-8 w-20" value={acc} onChange={(e) => setAcc(e.target.value)} />
            <span className="text-[var(--muted)]">{t("asis.minutes")}</span>
            <button onClick={saveAcc} disabled={accBusy} className="btn btn-outline h-8 text-xs disabled:opacity-50">
              {accBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} {t("asis.save")}
            </button>
            {accMsg && <span className="text-xs text-emerald-400">{accMsg}</span>}
            <span className="w-full text-xs text-[var(--muted)]">{t("asis.accHint")}</span>
          </div>
        </div>

        {/* Trend */}
        <h2 className="mt-6 flex items-center gap-2 text-sm font-semibold">
          <TrendingUp className="h-4 w-4 text-brand-400" /> {t("arpt.trends")}
        </h2>
        <div className="mt-3">
          <SubjectAnalysisPanel trend={trend} studentId={id!} aiEnabled={data.aiEnabled} />
        </div>

        {/* Academic record (left, wider) + Enrollments/Certificates (right sidebar) */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1.6fr_1fr]">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <BookOpen className="h-4 w-4 text-brand-400" /> {t("asis.academicRecord")}
            </h2>
            <div className="card mt-3 overflow-hidden">
              {attempts.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-[var(--muted)]">{t("asis.noCompletedExams")}</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
                      <th className="px-4 py-2.5 font-semibold">{t("asis.colExam")}</th>
                      <th className="px-3 py-2.5 text-center font-semibold">{t("asis.colScore")}</th>
                      <th className="px-3 py-2.5 text-center font-semibold">{t("asis.colResult")}</th>
                      <th className="px-3 py-2.5 text-center font-semibold">{t("asis.colIntegrity")}</th>
                      <th className="px-3 py-2.5 font-semibold">{t("asis.colSubmitted")}</th>
                      <th className="px-3 py-2.5 print:hidden" />
                    </tr>
                  </thead>
                  <tbody>
                    {attempts.map((a) => (
                      <tr key={a.attemptId} className="border-b border-[var(--border)] last:border-0 hover:bg-white/[0.02]">
                        <td className="px-4 py-3">
                          <span className="font-medium">{a.examTitle}</span>
                          <span className="block text-xs text-[var(--muted)]">{a.examCode}</span>
                        </td>
                        <td className="px-3 py-3 text-center"><ScoreBar value={a.score} /></td>
                        <td className="px-3 py-3 text-center">
                          {a.gradingStatus === "pending_review"
                            ? <span className="inline-flex items-center gap-1 text-amber-400"><Hourglass className="h-3.5 w-3.5" /> {t("asis.pending")}</span>
                            : a.passed
                              ? <span className="inline-flex items-center gap-1 text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> {t("common.pass")}</span>
                              : <span className="inline-flex items-center gap-1 text-rose-400"><XCircle className="h-3.5 w-3.5" /> {t("common.fail")}</span>}
                        </td>
                        <td className="px-3 py-3 text-center"><ScoreBar value={a.integrity} /></td>
                        <td className="px-3 py-3 text-xs text-[var(--muted)]">{fmtDate(a.submittedAt)}</td>
                        <td className="px-3 py-3 text-right print:hidden">
                          <Link to={`/admin/attempts/${a.attemptId}`} className="inline-flex items-center text-[var(--muted)] hover:text-[var(--fg)]">
                            <ArrowRight className="h-4 w-4" />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-6">
            {/* Enrollments */}
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Calendar className="h-4 w-4 text-brand-400" /> {t("asis.enrollments")}
              </h2>
              <div className="mt-3 space-y-2">
                {enrollments.length === 0 && (
                  <p className="card p-4 text-sm text-[var(--muted)]">{t("asis.noEnrollments")}</p>
                )}
                {enrollments.map((e) => (
                  <div key={e.regId} className="card p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate text-sm font-medium">
                        {e.examTitle} <span className="text-xs font-normal text-[var(--muted)]">· {e.examCode}</span>
                      </p>
                      <span className={clsx("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", APPROVAL_TONE[e.approval] ?? "bg-[var(--card-2)] text-[var(--muted)]")}>
                        {t(APPROVAL_KEY[e.approval] ?? e.approval)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-[var(--muted)]">
                      {e.scheduled ? t("asis.scheduledOn", { date: fmtDate(e.scheduled) }) : t("asis.noScheduledDate")}
                      {e.identity ? t("asis.idSuffix", { id: e.identity }) : ""}
                    </p>
                    <div className="mt-2.5 border-t border-[var(--border)] pt-2.5">
                      <EnrollmentStepper enrollment={e} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Certificates */}
            {certificates.length > 0 && (
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <Award className="h-4 w-4 text-amber-500" /> {t("arpt.certificates")}
                </h2>
                <div className="mt-3 space-y-2">
                  {certificates.map((c) => (
                    <Link key={c.certNumber} to={`/verify/${c.certNumber}`}
                      className="card card-hover flex items-center gap-3 p-3.5">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ background: "linear-gradient(135deg, #fcd34d, #f59e0b)" }}>
                        <Award className="h-5 w-5" style={{ color: "#0a0a0a" }} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{c.examTitle}</p>
                        <p className="font-mono text-[11px] text-[var(--muted)]">{c.certNumber}</p>
                      </div>
                      <div className="shrink-0 text-right text-xs">
                        <p className="font-bold tabular-nums" style={{ color: scoreHex(c.score) }}>{c.score}%</p>
                        <p className="text-[var(--muted)]">{fmtDate(c.issuedAt)}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </AdminShell>
  );
}

/** Score/integrity cell — the number plus a thin colour-banded bar underneath, so the
 *  academic-record table reads visually at a glance instead of as bare digits. */
function ScoreBar({ value }: { value: number }) {
  const color = scoreHex(value);
  return (
    <div className="mx-auto w-14">
      <span className="text-sm font-semibold tabular-nums" style={{ color }}>{value}{value <= 100 ? "%" : ""}</span>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--border)]">
        <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

/** Compact 4-stage progress dots (Registered → Confirmed → Checked in → Submitted) so an
 *  enrollment's real lifecycle reads as a glance-able pipeline instead of separate badges. */
function EnrollmentStepper({ enrollment: e }: { enrollment: Enrollment }) {
  const steps = [
    { key: "registered", done: true, label: "asis.stepRegistered" },
    { key: "confirmed", done: e.approval === "confirmed", label: "asis.stepConfirmed" },
    { key: "checkedIn", done: e.checkedIn, label: "asis.stepCheckedIn" },
    { key: "submitted", done: e.status === "submitted", label: "asis.stepSubmitted" },
  ] as const;
  const t = useT();
  return (
    <div className="flex items-center">
      {steps.map((s, i) => (
        <Fragment key={s.key}>
          {i > 0 && <span className="h-px flex-1" style={{ background: s.done ? SUBJ_LIME : "var(--border)" }} />}
          <span className="group relative flex shrink-0 items-center justify-center">
            <span className="flex h-4 w-4 items-center justify-center rounded-full transition" style={{ background: s.done ? SUBJ_LIME : "var(--border)" }}>
              {s.done && <Check className="h-2.5 w-2.5" style={{ color: "#0a0a0a" }} strokeWidth={3} />}
            </span>
            <span className="pointer-events-none absolute bottom-full mb-1.5 whitespace-nowrap rounded-md bg-[#111110] px-1.5 py-0.5 text-[10px] font-medium text-white opacity-0 transition group-hover:opacity-100">
              {t(s.label)}
            </span>
          </span>
        </Fragment>
      ))}
    </div>
  );
}

/** Radial progress ring (SVG) — used at the top of the record for a single glance-able
 *  completion metric, complementing the numeric stat chips below it. */
function RadialRing({ value, color, label, sublabel, size = 72, stroke = 6 }: { value: number; color: string; label: string; sublabel?: string; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  const offset = c * (1 - pct / 100);
  return (
    <div className="flex items-center gap-3 print:hidden">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
            strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round" style={{ transition: "stroke-dashoffset .4s ease" }} />
        </g>
        <text x={size / 2} y={size / 2 + 5} textAnchor="middle" fontSize={17} fontWeight={700} className="fill-[var(--fg)]">{pct}%</text>
      </svg>
      <div>
        <p className="text-sm font-semibold">{label}</p>
        {sublabel && <p className="text-[11px] text-[var(--muted)]">{sublabel}</p>}
      </div>
    </div>
  );
}

/** Icon-chip stat — a bordered mini-card (icon + value + label), used for the profile
 *  header's stat row so it reads as a proper infographic strip rather than bare numbers
 *  in a flat grid. */
function IconStatChip({ icon: Icon, label, value, tone }: { icon: typeof BookOpen; label: string; value: string | number; tone?: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--card-2)] px-3 py-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--card)]">
        <Icon className={clsx("h-4 w-4", tone ?? "text-[var(--muted)]")} />
      </span>
      <div className="min-w-0">
        <p className={clsx("text-base font-bold leading-tight tabular-nums", tone)}>{value}</p>
        <p className="truncate text-[10px] uppercase tracking-wide text-[var(--muted)]">{label}</p>
      </div>
    </div>
  );
}

// ── Subject performance analysis ────────────────────────────────────────────
// Built on the app's own `.card` surface + theme tokens (not a hardcoded dark
// palette), so it matches the rest of this page and respects light/dark mode.
// Every number comes from the student's real submitted attempts — a student
// with one real subject shows one fan slice, not a padded set of fake ones.
function SubjectAnalysisPanel({ trend, studentId, aiEnabled }: { trend: StudentTrendData; studentId: string; aiEnabled: boolean }) {
  const t = useT();
  if (trend.subjects.length === 0) {
    return <div className="card p-5"><p className="text-sm text-[var(--muted)]">{t("asis.noCompletedExams")}</p></div>;
  }
  const colorOf = new Map(trend.subjects.map((s, i) => [s.subject, SUBJECT_COLORS[i % SUBJECT_COLORS.length]]));
  const cardCols = Math.min(trend.subjects.length, 4);
  return (
    <div className="flex flex-col gap-3">
      <SubjectDonutCard trend={trend} colorOf={colorOf} />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <AiSummaryCard trend={trend} studentId={studentId} aiEnabled={aiEnabled} />
        <SubjectBarsCard subjects={trend.subjects} colorOf={colorOf} />
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cardCols}, minmax(0, 1fr))` }}>
        {trend.subjects.slice(0, 4).map((s) => <SubjectCard key={s.subject} s={s} color={colorOf.get(s.subject)!} />)}
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.6fr_1fr]">
        <HeatmapCard points={trend.points} subjects={trend.subjects} />
        <RecentExamsCard points={trend.points} />
      </div>
    </div>
  );
}

/** One real, data-driven sentence per subject for the donut's numbered legend —
 *  mirrors what a human grader would actually say about that subject's trajectory. */
function subjectInsight(s: SubjectTrendItem, t: TFn) {
  const delta = Math.abs(s.last - s.first);
  if (s.trend === "single") return t("asis.insightSingle");
  if (s.trend === "improving") return t("asis.insightImproving", { delta });
  if (s.trend === "declining") return t("asis.insightDeclining", { delta });
  return t("asis.insightSteady", { attempts: s.attempts });
}

/** Full-circle donut (petal radius still carries the real score, 0–100 mapped to
 *  inner→outer radius) + a numbered legend + a real score-band distribution — the
 *  "survey infographic" treatment applied to actual exam data instead of decoration. */
function SubjectDonutCard({ trend, colorOf }: { trend: StudentTrendData; colorOf: Map<string, string> }) {
  const t = useT();
  const subjects = trend.subjects.slice(0, 6);
  const n = subjects.length;
  const CX = 170, CY = 170, INNER_R = 58, OUTER_MAX = 150;
  const sliceDeg = 360 / n;
  const gap = Math.min(5, sliceDeg * 0.1);
  const pt = (r: number, deg: number): [number, number] => {
    const rad = (deg * Math.PI) / 180;
    return [CX + r * Math.sin(rad), CY - r * Math.cos(rad)];
  };
  const outerROf = (score: number) => INNER_R + Math.max(0, Math.min(1, score / 100)) * (OUTER_MAX - INNER_R);
  const overallAvg = Math.round(subjects.reduce((s, x) => s + x.avg, 0) / n);
  const overallTone = trend.overall.trend === "up" ? SUBJ_LIME : trend.overall.trend === "down" ? SUBJ_ROSE : "var(--muted)";
  const overallLabel = trend.overall.trend === "up" ? t("asis.trendUp") : trend.overall.trend === "down" ? t("asis.trendDown") : t("asis.trendFlat");

  // Real score-band breakdown across every submitted attempt (not just subject averages) —
  // the direct analogue of the reference infographic's response-distribution bars.
  const scores = trend.points.map((p) => p.score);
  const total = scores.length || 1;
  const bands = [
    { key: "strong", label: t("asis.distStrong"), count: scores.filter((s) => s >= 80).length, color: SUBJ_LIME },
    { key: "satisfactory", label: t("asis.distSatisfactory"), count: scores.filter((s) => s >= 60 && s < 80).length, color: SUBJ_ORANGE },
    { key: "weak", label: t("asis.distWeak"), count: scores.filter((s) => s < 60).length, color: SUBJ_ROSE },
  ];

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold">{t("asis.donutTitle")}</h3>
          <p className="text-[11px] text-[var(--muted)]">{t("asis.donutSubtitle")}</p>
        </div>
        <span className="rounded-full px-2.5 py-1 text-[10px] font-semibold" style={{ background: `${overallTone}1a`, color: overallTone }}>{overallLabel}</span>
      </div>

      <div className="mt-2 flex flex-col items-center gap-5 lg:flex-row lg:items-start">
        <svg viewBox="0 0 340 340" className="w-full max-w-[300px] shrink-0">
          {subjects.map((s, i) => {
            const startDeg = i * sliceDeg;
            const endDeg = startDeg + sliceDeg;
            const midDeg = (startDeg + endDeg) / 2;
            const aStart = startDeg + gap / 2, aEnd = endDeg - gap / 2;
            const outerR = outerROf(s.avg);
            const color = colorOf.get(s.subject)!;
            const large = aEnd - aStart > 180 ? 1 : 0;
            const p1 = pt(INNER_R, aStart), p2 = pt(outerR, aStart), p3 = pt(outerR, aEnd), p4 = pt(INNER_R, aEnd);
            const path = `M ${p1[0]} ${p1[1]} L ${p2[0]} ${p2[1]} A ${outerR} ${outerR} 0 ${large} 1 ${p3[0]} ${p3[1]} L ${p4[0]} ${p4[1]} A ${INNER_R} ${INNER_R} 0 ${large} 0 ${p1[0]} ${p1[1]}`;
            const sin = Math.sin((midDeg * Math.PI) / 180), cos = Math.cos((midDeg * Math.PI) / 180);
            const anchor = sin > 0.2 ? "start" : sin < -0.2 ? "end" : "middle";
            const labelPt = pt(Math.min(outerR + 26, OUTER_MAX + 24), midDeg);
            return (
              <g key={s.subject}>
                <path d={path} fill={color} fillOpacity={0.88} stroke="var(--card)" strokeWidth={2} />
                <text x={pt(INNER_R + (outerR - INNER_R) * 0.55, midDeg)[0]} y={pt(INNER_R + (outerR - INNER_R) * 0.55, midDeg)[1]}
                  fontSize={11} fontWeight={800} fill="#0a0a0a" textAnchor="middle" dominantBaseline="middle">{s.avg}%</text>
                <text x={labelPt[0]} y={labelPt[1] + (cos > 0.3 ? 8 : cos < -0.3 ? -4 : 2)} fontSize={10} fontWeight={600}
                  className="fill-[var(--fg)]" textAnchor={anchor}>{s.subject.length > 16 ? `${s.subject.slice(0, 15)}…` : s.subject}</text>
              </g>
            );
          })}
          <circle cx={CX} cy={CY} r={INNER_R - 8} fill="var(--card)" stroke={SUBJ_LIME} strokeWidth={2.5} />
          <text x={CX} y={CY - 20} textAnchor="middle" fontSize={9} fontWeight={700} letterSpacing={1} className="fill-[var(--muted)]">{t("asis.donutCenterLabel")}</text>
          <rect x={CX - 34} y={CY - 12} width={68} height={24} rx={12} fill={SUBJ_LIME} />
          <text x={CX} y={CY + 5} textAnchor="middle" fontSize={13} fontWeight={800} fill="#0a0a0a">{t("asis.mean")} {overallAvg}%</text>
          <text x={CX} y={CY + 28} textAnchor="middle" fontSize={9} className="fill-[var(--muted)]">{t("asis.subjectsCount", { n })}</text>
        </svg>

        <div className="flex w-full min-w-0 flex-col gap-2">
          {subjects.map((s, i) => {
            const color = colorOf.get(s.subject)!;
            return (
              <div key={s.subject} className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--card-2)] px-3 py-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-extrabold" style={{ background: color, color: "#0a0a0a" }}>{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{s.subject}</p>
                  <p className="truncate text-[11px] text-[var(--muted)]">{subjectInsight(s, t)}</p>
                </div>
                <span className="shrink-0 text-sm font-bold tabular-nums" style={{ color }}>{s.avg}%</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Real score-band distribution across every submitted attempt */}
      <div className="mt-5 border-t border-[var(--border)] pt-4">
        <p className="mb-3 text-center text-[11px] font-bold uppercase tracking-wide" style={{ color: SUBJ_LIME }}>{t("asis.distTitle")}</p>
        <div className="grid grid-cols-3 gap-4">
          {bands.map((b) => {
            const pct = Math.round((b.count / total) * 100);
            return (
              <div key={b.key} className="text-center">
                <p className="text-xs text-[var(--muted)]">{b.label}</p>
                <p className="text-lg font-bold tabular-nums" style={{ color: b.color }}>{pct}%</p>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--border)]">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: b.color }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AiSummaryCard({ trend, studentId, aiEnabled }: { trend: StudentTrendData; studentId: string; aiEnabled: boolean }) {
  const [narrative, setNarrative] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const generate = async () => {
    setLoading(true); setErr(null);
    try {
      const r = await api.post<{ narrative: string }>(`/admin/students/${studentId}/trend-narrative`);
      setNarrative(r.narrative);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card flex flex-col p-5">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md" style={{ background: `linear-gradient(135deg, ${SUBJ_LIME}, ${SUBJ_CYAN})` }}>
          <Brain className="h-3.5 w-3.5" style={{ color: "#0a0a0a" }} />
        </span>
        <h3 className="text-sm font-semibold">AI Summary</h3>
      </div>
      <div className="mt-3 flex-1 text-xs leading-relaxed" style={{ color: err ? SUBJ_ORANGE : "var(--muted)" }}>
        {loading ? "Generating…" : err ?? narrative ?? trend.summary}
      </div>
      {aiEnabled && (
        <button onClick={generate} disabled={loading} className="btn btn-outline mt-3 h-8 shrink-0 self-start text-xs disabled:opacity-40 print:hidden">
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : narrative ? "Regenerate" : "Generate AI summary"}
        </button>
      )}
    </div>
  );
}

function SubjectBarsCard({ subjects, colorOf }: { subjects: SubjectTrendItem[]; colorOf: Map<string, string> }) {
  return (
    <div className="card p-5">
      <h3 className="mb-3.5 text-sm font-semibold">Subject Performance</h3>
      <div className="flex flex-col gap-3">
        {subjects.map((s) => {
          const color = colorOf.get(s.subject)!;
          return (
            <div key={s.subject}>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] text-[var(--muted)]">{s.subject}</span>
                <span className="text-[11px] font-bold tabular-nums" style={{ color }}>{s.avg}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[var(--border)]">
                <div className="h-full rounded-full" style={{ width: `${s.avg}%`, backgroundColor: color }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SubjectCard({ s, color }: { s: SubjectTrendItem; color: string }) {
  const delta = s.last - s.first;
  const Arrow = s.trend === "improving" ? TrendingUp : s.trend === "declining" ? TrendingDown : Minus;
  const tone = s.trend === "improving" ? SUBJ_LIME : s.trend === "declining" ? SUBJ_ROSE : "var(--muted)";
  return (
    <div className="card p-3.5">
      <div className="flex items-center justify-between">
        <span className="flex h-6 w-6 items-center justify-center rounded-md" style={{ background: `${color}18` }}>
          <BookOpen className="h-3.5 w-3.5" style={{ color }} />
        </span>
        {s.trend !== "single" && (
          <span className="flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold" style={{ color: tone, background: `${tone}18` }}>
            <Arrow className="h-2.5 w-2.5" /> {delta >= 0 ? "+" : ""}{delta}%
          </span>
        )}
      </div>
      <p className="mt-2 text-[11px] text-[var(--muted)]">{s.subject}</p>
      <p className="text-2xl font-bold tabular-nums tracking-tight" style={{ color }}>{s.avg}%</p>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--border)]">
        <div className="h-full rounded-full" style={{ width: `${s.avg}%`, backgroundColor: color }} />
      </div>
      <p className="mt-1.5 text-[10px] text-[var(--muted)]">Best {s.best}% · {s.attempts} exam{s.attempts === 1 ? "" : "s"}</p>
    </div>
  );
}

function HeatmapCard({ points, subjects }: { points: StudentTrendData["points"]; subjects: SubjectTrendItem[] }) {
  const months: { key: string; label: string }[] = [];
  const cursor = new Date(); cursor.setDate(1);
  for (let i = 5; i >= 0; i--) {
    const dt = new Date(cursor.getFullYear(), cursor.getMonth() - i, 1);
    months.push({ key: `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`, label: dt.toLocaleDateString(undefined, { month: "short" }) });
  }
  const cellAvg = (subject: string, monthKey: string) => {
    const rows = points.filter((p) => p.subject === subject && p.at && p.at.slice(0, 7) === monthKey);
    if (!rows.length) return null;
    return Math.round(rows.reduce((s, p) => s + p.score, 0) / rows.length);
  };
  return (
    <div className="card p-5">
      <h3 className="text-sm font-semibold">Performance Heatmap</h3>
      <p className="mb-3.5 text-[11px] text-[var(--muted)]">Monthly average score, per subject</p>
      <div className="overflow-x-auto">
        <table style={{ minWidth: 420, borderCollapse: "separate", borderSpacing: "4px 4px" }}>
          <thead>
            <tr>
              <th style={{ width: 80 }} />
              {months.map((m) => <th key={m.key} className="text-[9px] font-medium text-[var(--muted)]">{m.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {subjects.map((s) => (
              <tr key={s.subject}>
                <td className="whitespace-nowrap pr-2.5 text-[11px] text-[var(--muted)]">{s.subject}</td>
                {months.map((m) => {
                  const v = cellAvg(s.subject, m.key);
                  const bg = v === null ? "transparent" : v >= 80 ? `${SUBJ_LIME}26` : v >= 60 ? `${SUBJ_ORANGE}26` : `${SUBJ_ROSE}26`;
                  const fg = v === null ? "var(--muted)" : v >= 80 ? SUBJ_LIME : v >= 60 ? SUBJ_ORANGE : SUBJ_ROSE;
                  return (
                    <td key={m.key} className="text-center">
                      <div className="mx-auto flex items-center justify-center rounded" style={{ width: 34, height: 24, background: bg }}>
                        <span className="text-[10px] font-bold tabular-nums" style={{ color: fg }}>{v ?? "—"}</span>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function heatScoreColor(s: number) { return s >= 80 ? SUBJ_LIME : s >= 60 ? SUBJ_ORANGE : SUBJ_ROSE; }
function heatScoreBg(s: number) { return s >= 80 ? `${SUBJ_LIME}26` : s >= 60 ? `${SUBJ_ORANGE}26` : `${SUBJ_ROSE}26`; }

function RecentExamsCard({ points }: { points: StudentTrendData["points"] }) {
  const recent = [...points].filter((p) => p.at).sort((a, b) => (b.at ?? "").localeCompare(a.at ?? "")).slice(0, 6);
  return (
    <div className="card p-5">
      <h3 className="mb-3 text-sm font-semibold">Recent Exams</h3>
      {recent.length === 0 ? (
        <p className="text-xs text-[var(--muted)]">No completed exams yet.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {recent.map((e, i) => (
            <div key={i} className="flex items-center gap-2.5 rounded-xl px-3 py-2" style={{ background: "var(--card-2, var(--border))" }}>
              <div className="flex h-7 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: heatScoreBg(e.score) }}>
                <span className="text-[11px] font-bold tabular-nums" style={{ color: heatScoreColor(e.score) }}>{e.score}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-medium">{e.examTitle}</p>
                <p className="text-[10px] text-[var(--muted)]">{e.at ? new Date(e.at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—"}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
