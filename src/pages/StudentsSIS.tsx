import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Loader2, ArrowRight, ArrowLeft, Mail, Award, ShieldCheck,
  CheckCircle2, XCircle, Hourglass, BookOpen, Calendar, FileText, Users2,
  Search, ChevronDown, Pin, MoreHorizontal, ArrowUpDown,
  Download, Activity,
} from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { PageHeader } from "@/components/PageHeader";
import { api } from "@/lib/api";
import { StudentTrend } from "@/components/StudentTrend";
import type { StudentTrend as StudentTrendData } from "@shared/types";
import { TrendingUp } from "lucide-react";
import { useT } from "@/lib/i18n";
import { clsx } from "clsx";

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
        <div className="flex items-center justify-between">
          <Link to="/admin/students" className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--fg)]">
            <ArrowLeft className="h-4 w-4" /> {t("acan.title")}
          </Link>
          <Link to={`/admin/students/${id}/report`} className="btn btn-outline h-9 text-sm">
            <FileText className="h-4 w-4" /> {t("asis.progressReport")}
          </Link>
        </div>

        {/* Profile header */}
        <div className="card mt-4 p-6">
          <div className="flex items-center gap-4">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#111110] text-lg font-bold text-white">
              {initials(student.name)}
            </span>
            <div>
              <h1 className="text-xl font-bold tracking-tight">{student.name}</h1>
              <p className="flex items-center gap-1.5 text-sm text-[var(--muted)]">
                <Mail className="h-3.5 w-3.5" /> {student.email}
              </p>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-3 gap-4 sm:grid-cols-7">
            <Stat label={t("asis.stEnrolled")}     value={stats.enrollments} />
            <Stat label={t("asis.stCompleted")}    value={stats.completed} />
            <Stat label={t("asis.stAvgScore")}     value={stats.avgScore === null ? "—" : `${stats.avgScore}%`} tone={scoreTone(stats.avgScore)} />
            <Stat label={t("asis.stGpa")}          value={stats.gpa === null ? "—" : stats.gpa.toFixed(2)} />
            <Stat label={t("asis.stPassRate")}     value={stats.passRate === null ? "—" : `${stats.passRate}%`} />
            <Stat label={t("asis.stIntegrity")}    value={stats.avgIntegrity === null ? "—" : stats.avgIntegrity} tone={scoreTone(stats.avgIntegrity)} />
            <Stat label={t("asis.stCertificates")} value={stats.certificates} />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-4 text-sm">
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
        <div className="card mt-3 p-5">
          <StudentTrend trend={trend} studentId={id} aiEnabled={data.aiEnabled} />
        </div>

        {/* Academic record */}
        <h2 className="mt-6 flex items-center gap-2 text-sm font-semibold">
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
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {attempts.map((a) => (
                  <tr key={a.attemptId} className="border-b border-[var(--border)] last:border-0 hover:bg-white/[0.02]">
                    <td className="px-4 py-3">
                      <span className="font-medium">{a.examTitle}</span>
                      <span className="block text-xs text-[var(--muted)]">{a.examCode}</span>
                    </td>
                    <td className={clsx("px-3 py-3 text-center font-semibold tabular-nums", scoreTone(a.score))}>{a.score}%</td>
                    <td className="px-3 py-3 text-center">
                      {a.gradingStatus === "pending_review"
                        ? <span className="inline-flex items-center gap-1 text-amber-400"><Hourglass className="h-3.5 w-3.5" /> {t("asis.pending")}</span>
                        : a.passed
                          ? <span className="inline-flex items-center gap-1 text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> {t("common.pass")}</span>
                          : <span className="inline-flex items-center gap-1 text-rose-400"><XCircle className="h-3.5 w-3.5" /> {t("common.fail")}</span>}
                    </td>
                    <td className={clsx("px-3 py-3 text-center font-semibold tabular-nums", scoreTone(a.integrity))}>{a.integrity}</td>
                    <td className="px-3 py-3 text-xs text-[var(--muted)]">{fmtDate(a.submittedAt)}</td>
                    <td className="px-3 py-3 text-right">
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

        {/* Enrollments */}
        <h2 className="mt-6 flex items-center gap-2 text-sm font-semibold">
          <Calendar className="h-4 w-4 text-brand-400" /> {t("asis.enrollments")}
        </h2>
        <div className="mt-3 space-y-2">
          {enrollments.length === 0 && (
            <p className="card p-4 text-sm text-[var(--muted)]">{t("asis.noEnrollments")}</p>
          )}
          {enrollments.map((e) => (
            <div key={e.regId} className="card flex items-center justify-between gap-3 p-3.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {e.examTitle} <span className="text-xs text-[var(--muted)]">· {e.examCode}</span>
                </p>
                <p className="text-xs text-[var(--muted)]">
                  {e.scheduled ? t("asis.scheduledOn", { date: fmtDate(e.scheduled) }) : t("asis.noScheduledDate")}
                  {e.identity ? t("asis.idSuffix", { id: e.identity }) : ""}
                  {e.checkedIn ? t("asis.checkedInSuffix") : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-[var(--bg)] px-2 py-0.5 text-[11px] font-medium capitalize text-[var(--muted)]">
                  {e.status.replace(/_/g, " ")}
                </span>
                <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-semibold", APPROVAL_TONE[e.approval] ?? "bg-[var(--card-2)] text-[var(--muted)]")}>
                  {t(APPROVAL_KEY[e.approval] ?? e.approval)}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Certificates */}
        {certificates.length > 0 && (
          <>
            <h2 className="mt-6 flex items-center gap-2 text-sm font-semibold">
              <Award className="h-4 w-4 text-amber-500" /> {t("arpt.certificates")}
            </h2>
            <div className="mt-3 space-y-2">
              {certificates.map((c) => (
                <Link key={c.certNumber} to={`/verify/${c.certNumber}`}
                  className="card flex items-center justify-between gap-3 p-3.5 transition hover:shadow-md">
                  <div className="flex items-center gap-2.5">
                    <ShieldCheck className="h-4 w-4 text-emerald-500" />
                    <div>
                      <p className="text-sm font-medium">{c.examTitle}</p>
                      <p className="font-mono text-xs text-[var(--muted)]">{c.certNumber}</p>
                    </div>
                  </div>
                  <div className="text-right text-xs text-[var(--muted)]">
                    <p className="font-semibold text-[var(--fg)]">{c.score}%</p>
                    <p>{fmtDate(c.issuedAt)}</p>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </AdminShell>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className={clsx("mt-0.5 text-lg font-bold tabular-nums", tone)}>{value}</p>
    </div>
  );
}
