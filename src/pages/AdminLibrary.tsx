import { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus, X, Trash2, ImagePlus, Library as LibraryIcon, FileText, CheckCircle2, Loader2, ChevronLeft, ChevronRight,
  BookOpen, NotebookPen, FileQuestion, Video, Music, ClipboardList, FlaskConical, GraduationCap, Newspaper,
  Presentation, Code2, FolderArchive, Link2, ScrollText, ListTree, MoreHorizontal, LayoutGrid, BarChart3,
  History, RotateCcw, Download, Eye, Users2, Building2, Save, Send, CalendarClock, TrendingUp, TrendingDown,
  Search, Filter, List as ListIcon,
} from "lucide-react";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { AdminShell } from "@/components/AdminShell";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton, EmptyState } from "@/components/ui";
import { BookCover } from "@/components/BookCover";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import type { Book, BookGenre, ResourceType, ResourceVersion } from "@shared/types";
import { BOOK_GENRES, RESOURCE_TYPES, RESOURCE_DIFFICULTIES } from "@shared/types";
import { clsx } from "clsx";

const LIME = "oklch(0.86 0.18 112)";

const TYPE_ICON: Record<ResourceType, typeof BookOpen> = {
  "Textbook": BookOpen, "Lecture Notes": NotebookPen, "Past Questions": FileQuestion, "Video": Video, "Audio": Music,
  "Assignment Guide": ClipboardList, "Lab Manual": FlaskConical, "Research Paper": GraduationCap, "Journal": Newspaper,
  "Presentation": Presentation, "Source Code": Code2, "ZIP Resources": FolderArchive, "External Link": Link2,
  "eBook": LibraryIcon, "Policy Document": ScrollText, "Course Outline": ListTree, "Other": MoreHorizontal,
};
const TYPE_DESC: Record<ResourceType, string> = {
  "Textbook": "A core course textbook.", "Lecture Notes": "Slides or written notes from a class.",
  "Past Questions": "Previous exam or test questions.", "Video": "A recorded lecture, demo, or tutorial.",
  "Audio": "A podcast, recording, or audio lesson.", "Assignment Guide": "Instructions for a homework or project.",
  "Lab Manual": "Step-by-step lab or practical guide.", "Research Paper": "A published research paper.",
  "Journal": "A journal article or issue.", "Presentation": "Slide deck for a talk or seminar.",
  "Source Code": "Sample or starter code.", "ZIP Resources": "A bundle of files.",
  "External Link": "A link instead of an upload — best for lecture-length video/audio.",
  "eBook": "A book for independent reading.", "Policy Document": "An institutional policy or handbook.",
  "Course Outline": "The syllabus or outline for a course.", "Other": "Anything that doesn't fit the above.",
};

export function AdminLibrary() {
  const t = useT();
  const [tab, setTab] = useState<"resources" | "dashboard">("resources");
  const [books, setBooks] = useState<Book[] | null>(null);
  const [wizardFor, setWizardFor] = useState<Book | "new" | null>(null);
  const [historyFor, setHistoryFor] = useState<Book | null>(null);
  const [typeFilter, setTypeFilter] = useState<ResourceType | "All">("All");
  const [statusFilter, setStatusFilter] = useState<"All" | "draft" | "published">("All");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");

  const load = () => api.get<{ books: Book[] }>("/admin/books").then((d) => setBooks(d.books)).catch(() => setBooks([]));
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    let list = books ?? [];
    if (typeFilter !== "All") list = list.filter((b) => b.resourceType === typeFilter);
    if (statusFilter !== "All") list = list.filter((b) => b.status === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((b) => b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q));
    return list;
  }, [books, typeFilter, statusFilter, search]);

  const remove = async (id: string) => {
    if (!confirm("Delete this resource? This removes it for every student, including reading progress, bookmarks, and ratings.")) return;
    await api.del(`/admin/books/${id}`);
    load();
  };

  return (
    <AdminShell wide>
      <div className="fade-in">
        <PageHeader title="Library" subtitle="The institution's learning resource repository."
          actions={<button onClick={() => setWizardFor("new")} className="btn btn-on-teal"><Plus className="h-4 w-4" /> Upload resource</button>} />

        <div className="mt-4 flex items-center gap-6 border-b border-[var(--border)]">
          {[{ key: "resources" as const, label: "Resources", icon: LayoutGrid }, { key: "dashboard" as const, label: "Dashboard", icon: BarChart3 }].map((tb) => (
            <button key={tb.key} onClick={() => setTab(tb.key)}
              className="-mb-px flex items-center gap-1.5 border-b-2 pb-2.5 text-sm font-medium transition"
              style={tab === tb.key ? { borderColor: LIME, color: LIME } : { borderColor: "transparent", color: "var(--muted)" }}>
              <tb.icon className="h-4 w-4" /> {tb.label}
            </button>
          ))}
        </div>

        {tab === "dashboard" ? (
          <LibraryDashboard />
        ) : !books ? (
          <div className="mt-6 grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="aspect-[3/4] w-full rounded-xl" />)}
          </div>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <div className="relative min-w-[200px] flex-1 max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted)]" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search resources…"
                  className="input h-9 w-full pl-9" />
              </div>
              <button title="Filters" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] transition hover:text-[var(--fg)]">
                <Filter className="h-4 w-4" />
              </button>
              <select className="input h-9" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as ResourceType | "All")}>
                <option value="All">All types</option>
                {RESOURCE_TYPES.map((rt) => <option key={rt} value={rt}>{rt}</option>)}
              </select>
              <select className="input h-9" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
                <option value="All">All statuses</option>
                <option value="published">Published</option>
                <option value="draft">Draft</option>
              </select>
              <div className="ml-auto flex items-center gap-0.5 rounded-full p-1" style={{ background: "rgba(200,245,61,0.1)" }}>
                <button onClick={() => setView("grid")} title="Grid view" className="flex h-7 w-7 items-center justify-center rounded-full transition"
                  style={view === "grid" ? { background: LIME, color: "#08090a" } : { color: "var(--muted)" }}>
                  <LayoutGrid className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => setView("list")} title="List view" className="flex h-7 w-7 items-center justify-center rounded-full transition"
                  style={view === "list" ? { background: LIME, color: "#08090a" } : { color: "var(--muted)" }}>
                  <ListIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <p className="mt-2 text-xs text-[var(--muted)]">{filtered.length} resource{filtered.length === 1 ? "" : "s"}</p>

            {filtered.length === 0 ? (
              <EmptyState className="mt-6" icon={LibraryIcon} title="No resources yet"
                hint="Upload a resource so it appears in the library." action={<button onClick={() => setWizardFor("new")} className="btn btn-primary"><Plus className="h-4 w-4" /> Upload resource</button>} />
            ) : view === "grid" ? (
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                {filtered.map((b) => (
                  <ResourceCard key={b.id} book={b} onEdit={() => setWizardFor(b)} onHistory={() => setHistoryFor(b)} onDelete={() => remove(b.id)} />
                ))}
              </div>
            ) : (
              <div className="mt-4 divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)]">
                {filtered.map((b) => (
                  <ResourceListRow key={b.id} book={b} onEdit={() => setWizardFor(b)} onHistory={() => setHistoryFor(b)} onDelete={() => remove(b.id)} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {wizardFor && <UploadWizard book={wizardFor === "new" ? null : wizardFor} onClose={() => setWizardFor(null)} onDone={() => { setWizardFor(null); load(); }} />}
      {historyFor && <VersionHistoryModal book={historyFor} onClose={() => setHistoryFor(null)} onRestored={() => { setHistoryFor(null); load(); }} />}
    </AdminShell>
  );
}

function ResourceCard({ book, onEdit, onHistory, onDelete }: { book: Book; onEdit: () => void; onHistory: () => void; onDelete: () => void }) {
  const Icon = TYPE_ICON[book.resourceType] ?? MoreHorizontal;
  return (
    <div className="group relative">
      <div role="button" tabIndex={0} onClick={onEdit} onKeyDown={(e) => e.key === "Enter" && onEdit()} className="block w-full cursor-pointer text-left">
        <BookCover title={book.title} coverImage={book.coverImage} />
      </div>
      <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
        <button onClick={onHistory} title="Version history" className="flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white/80 hover:text-white"><History className="h-3.5 w-3.5" /></button>
        <button onClick={onDelete} title="Delete" className="flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white/80 hover:text-rose-400"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
        <p className="truncate text-xs font-semibold text-[var(--fg)]">{book.title}</p>
      </div>
      <p className="truncate text-[11px] text-[var(--muted)]">{book.resourceType} · v{book.version}</p>
      <div className="mt-1 flex items-center gap-2 text-[10px] text-[var(--muted)]">
        <span className={clsx("rounded-full px-1.5 py-0.5 font-semibold", book.status === "published" ? "bg-emerald-500/15 text-emerald-400" : "bg-white/10 text-white/60")}>
          {book.status === "published" ? "Published" : "Draft"}
        </span>
        <span className="inline-flex items-center gap-0.5"><Eye className="h-3 w-3" /> {book.viewCount}</span>
        <span className="inline-flex items-center gap-0.5"><Download className="h-3 w-3" /> {book.downloadCount}</span>
      </div>
    </div>
  );
}

function ResourceListRow({ book, onEdit, onHistory, onDelete }: { book: Book; onEdit: () => void; onHistory: () => void; onDelete: () => void }) {
  const Icon = TYPE_ICON[book.resourceType] ?? MoreHorizontal;
  return (
    <div className="group flex items-center gap-3 px-3 py-2.5 transition hover:bg-white/[0.03]">
      <div role="button" tabIndex={0} onClick={onEdit} onKeyDown={(e) => e.key === "Enter" && onEdit()} className="w-10 shrink-0 cursor-pointer">
        <BookCover title={book.title} coverImage={book.coverImage} />
      </div>
      <div role="button" tabIndex={0} onClick={onEdit} onKeyDown={(e) => e.key === "Enter" && onEdit()} className="min-w-0 flex-1 cursor-pointer">
        <div className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
          <p className="truncate text-xs font-semibold text-[var(--fg)]">{book.title}</p>
        </div>
        <p className="truncate text-[11px] text-[var(--muted)]">{book.resourceType} · v{book.version}</p>
      </div>
      <span className={clsx("shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold", book.status === "published" ? "bg-emerald-500/15 text-emerald-400" : "bg-white/10 text-white/60")}>
        {book.status === "published" ? "Published" : "Draft"}
      </span>
      <span className="hidden shrink-0 items-center gap-0.5 text-[10px] text-[var(--muted)] sm:inline-flex"><Eye className="h-3 w-3" /> {book.viewCount}</span>
      <span className="hidden shrink-0 items-center gap-0.5 text-[10px] text-[var(--muted)] sm:inline-flex"><Download className="h-3 w-3" /> {book.downloadCount}</span>
      <div className="flex shrink-0 gap-1 opacity-0 transition group-hover:opacity-100">
        <button onClick={onHistory} title="Version history" className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--muted)] hover:text-[var(--fg)]"><History className="h-3.5 w-3.5" /></button>
        <button onClick={onDelete} title="Delete" className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--muted)] hover:text-rose-400"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  );
}

// ── Library dashboard ────────────────────────────────────────────────────
interface DashboardResource {
  id: string; title: string; resourceType: ResourceType; status: "draft" | "published";
  viewCount: number; downloadCount: number; bookmarkCount: number; createdAt: string;
}
interface DashboardData {
  totalResources: number; byType: Record<string, number>; byStatus: { draft: number; published: number };
  totalViews: number; totalDownloads: number; totalBookmarks: number; storageUsed: number; pendingReviews: number;
  newThisWeek: number; weekOverWeekPct: number | null;
  resources: DashboardResource[];
  topContributors: { userId: string; name: string; count: number }[];
}
function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Library Dashboard — bento grid, dark/lime visual language distinct from
// the rest of the admin console (per design spec). Real data throughout,
// EXCEPT the 7-day views trend line, which is explicitly placeholder data —
// there's no per-day view history tracked (only cumulative counters), and
// building that out was out of scope for this redesign.
const DASH_BG = "#0c0c0c";
const DASH_CARD = "#141414";
const DASH_LIME = "#c8f000";
const DASH_BORDER = "rgba(255,255,255,0.08)";
const BARLOW = "'Barlow Condensed', sans-serif";
const MONO = "'DM Mono', monospace";

type Metric = "viewCount" | "downloadCount" | "bookmarkCount";
const METRIC_META: Record<Metric, { label: string }> = {
  viewCount: { label: "Views" }, downloadCount: { label: "Downloads" }, bookmarkCount: { label: "Bookmarks" },
};

function last7DayLabels(): string[] {
  const out: string[] = [];
  const fmt = new Intl.DateTimeFormat(undefined, { weekday: "short" });
  for (let i = 6; i >= 0; i--) out.push(fmt.format(new Date(Date.now() - i * 24 * 3600_000)));
  return out;
}

function LibraryDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [metric, setMetric] = useState<Metric | null>(null);
  useEffect(() => { api.get<DashboardData>("/admin/library/dashboard").then(setData).catch(() => {}); }, []);
  if (!data) return <div className="mt-8 flex items-center gap-2 text-white/50"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;

  // Placeholder — see comment above. Shaped like a real week, values are illustrative only.
  const viewsTrend = last7DayLabels().map((day, i) => ({ day, views: [42, 58, 51, 67, 74, 39, 46][i] }));
  const byTypeData = Object.entries(data.byType).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  const byStatusData = [{ name: "Published", value: data.byStatus.published }, { name: "Draft", value: data.byStatus.draft }];

  const secondaryStats: { key: Metric | "storage"; label: string; value: string | number }[] = [
    { key: "viewCount", label: "Views", value: data.totalViews },
    { key: "downloadCount", label: "Downloads", value: data.totalDownloads },
    { key: "bookmarkCount", label: "Bookmarks", value: data.totalBookmarks },
    { key: "storage", label: "Storage used", value: fmtBytes(data.storageUsed) },
  ];

  const sortedResources = [...data.resources].sort((a, b) => (metric ? b[metric] - a[metric] : b.viewCount - a.viewCount));

  return (
    <div className="mt-5 -mx-2 p-2 sm:-mx-4 sm:p-4" style={{ background: DASH_BG, fontFamily: MONO }}>
      <div className="grid grid-cols-1 gap-[2px] min-[480px]:grid-cols-2 min-[768px]:grid-cols-4" style={{ background: DASH_BG }}>
        {/* Hero — Total Resources */}
        <div className="col-span-1 min-[480px]:col-span-2 min-[768px]:col-span-2 p-5" style={{ background: DASH_CARD, borderTop: `2px solid ${DASH_LIME}` }}>
          <p className="text-xs uppercase tracking-wide text-white/40">Total Resources</p>
          <p className="mt-1" style={{ fontFamily: BARLOW, fontWeight: 700, fontSize: 56, lineHeight: 1, color: "#f5f5f5" }}>{data.totalResources}</p>
          <div className="mt-2 flex items-center gap-1.5 text-xs">
            {data.weekOverWeekPct !== null ? (
              <span className="inline-flex items-center gap-1" style={{ color: data.weekOverWeekPct >= 0 ? DASH_LIME : "#ef4444" }}>
                {data.weekOverWeekPct >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                {Math.abs(data.weekOverWeekPct)}%
              </span>
            ) : <span className="text-white/40">—</span>}
            <span className="text-white/40">· {data.newThisWeek} new this week</span>
          </div>
        </div>

        {/* 7-day views chart (placeholder data) */}
        <div className="col-span-1 min-[480px]:col-span-2 min-[768px]:col-span-2 p-5" style={{ background: DASH_CARD, borderTop: `2px solid ${DASH_LIME}` }}>
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wide text-white/40">Views · last 7 days</p>
            <span className="rounded-sm px-1.5 py-0.5 text-[10px] text-white/40" style={{ border: `1px solid ${DASH_BORDER}` }}>illustrative</span>
          </div>
          <div className="mt-2 h-[90px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={viewsTrend} margin={{ top: 4, right: 4, bottom: 0, left: -30 }}>
                <defs>
                  <linearGradient id="dashViewsGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={DASH_LIME} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={DASH_LIME} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="day" tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10, fontFamily: MONO }} axisLine={false} tickLine={false} />
                <YAxis hide domain={[0, "dataMax + 10"]} />
                <Tooltip contentStyle={{ background: "#1c1c1c", border: `1px solid ${DASH_LIME}`, borderRadius: 6, fontFamily: MONO, fontSize: 11 }} labelStyle={{ color: "#fff" }} />
                <Area type="monotone" dataKey="views" stroke={DASH_LIME} strokeWidth={2} fill="url(#dashViewsGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Secondary stats */}
        {secondaryStats.map((s) => {
          const active = s.key !== "storage" && metric === s.key;
          return (
            <button key={s.label} onClick={() => s.key !== "storage" && setMetric((m) => (m === s.key ? null : s.key as Metric))}
              className="p-4 text-left transition hover:brightness-110"
              style={{ background: DASH_CARD, borderTop: `2px solid ${DASH_LIME}`, outline: active ? `1px solid ${DASH_LIME}` : undefined, outlineOffset: -1 }}>
              <p style={{ fontFamily: BARLOW, fontWeight: 600, fontSize: 30, lineHeight: 1, color: "#f5f5f5" }}>{s.value}</p>
              <p className="mt-1 text-[11px] uppercase tracking-wide text-white/40">{s.label}</p>
            </button>
          );
        })}

        {/* Most Viewed table */}
        <div className="col-span-1 min-[480px]:col-span-2 min-[768px]:col-span-2 p-5" style={{ background: DASH_CARD, borderTop: `2px solid ${DASH_LIME}` }}>
          <div className="flex items-center justify-between">
            <h3 className="text-xs uppercase tracking-wide text-white/40">
              {metric ? `Sorted by ${METRIC_META[metric].label.toLowerCase()}` : "Most viewed"}
            </h3>
            <span className="text-[11px] text-white/40">{data.pendingReviews} pending review</span>
          </div>
          {sortedResources.length === 0 ? (
            <p className="mt-3 text-xs text-white/40">No resources yet.</p>
          ) : (
            <div className="mt-3 max-h-[220px] overflow-y-auto" style={{ scrollbarWidth: "none" }}>
              <table className="w-full text-xs">
                <tbody>
                  {sortedResources.slice(0, 8).map((r) => (
                    <tr key={r.id} style={{ borderTop: `1px solid ${DASH_BORDER}` }}>
                      <td className="py-2 pr-2">
                        <p className="truncate text-white/85">{r.title}</p>
                        <p className="text-[10px] text-white/35">{r.resourceType}</p>
                      </td>
                      <td className={clsx("py-2 px-2 text-right tabular-nums", metric === "viewCount" ? "text-white" : "text-white/50")}>{r.viewCount}</td>
                      <td className={clsx("py-2 px-2 text-right tabular-nums", metric === "downloadCount" ? "text-white" : "text-white/50")}>{r.downloadCount}</td>
                      <td className={clsx("py-2 pl-2 text-right tabular-nums", metric === "bookmarkCount" ? "text-white" : "text-white/50")} style={metric === "bookmarkCount" ? { color: DASH_LIME } : undefined}>{r.bookmarkCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* By type */}
        <div className="col-span-1 p-5" style={{ background: DASH_CARD, borderTop: `2px solid ${DASH_LIME}` }}>
          <h3 className="text-xs uppercase tracking-wide text-white/40">By type</h3>
          <div className="mt-2" style={{ height: Math.max(80, byTypeData.length * 22) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byTypeData} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={90} tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 10, fontFamily: MONO }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: "#1c1c1c", border: `1px solid ${DASH_LIME}`, borderRadius: 6, fontFamily: MONO, fontSize: 11 }} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                <Bar dataKey="value" radius={[0, 3, 3, 0]}>
                  {byTypeData.map((_, i) => <Cell key={`bytype-${i}`} fill={DASH_LIME} fillOpacity={1 - i * 0.08} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* By status */}
        <div className="col-span-1 p-5" style={{ background: DASH_CARD, borderTop: `2px solid ${DASH_LIME}` }}>
          <h3 className="text-xs uppercase tracking-wide text-white/40">By status</h3>
          <div className="mt-2" style={{ height: 80 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byStatusData} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={70} tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 10, fontFamily: MONO }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: "#1c1c1c", border: `1px solid ${DASH_LIME}`, borderRadius: 6, fontFamily: MONO, fontSize: 11 }} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                <Bar dataKey="value" radius={[0, 3, 3, 0]}>
                  {byStatusData.map((_, i) => <Cell key={`bystatus-${i}`} fill={DASH_LIME} fillOpacity={i === 0 ? 1 : 0.5} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Top contributors */}
        <div className="col-span-1 min-[480px]:col-span-2 min-[768px]:col-span-4 p-5" style={{ background: DASH_CARD, borderTop: `2px solid ${DASH_LIME}` }}>
          <h3 className="text-xs uppercase tracking-wide text-white/40">Top contributors</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {data.topContributors.length === 0 ? <p className="text-xs text-white/40">Nothing yet.</p> : data.topContributors.map((c) => (
              <span key={c.userId} className="rounded-sm px-2.5 py-1 text-xs text-white/70" style={{ border: `1px solid ${DASH_BORDER}` }}>
                {c.name} <span style={{ color: DASH_LIME }}>· {c.count}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Version history ──────────────────────────────────────────────────────
function VersionHistoryModal({ book, onClose, onRestored }: { book: Book; onClose: () => void; onRestored: () => void }) {
  const [versions, setVersions] = useState<ResourceVersion[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { api.get<{ versions: ResourceVersion[] }>(`/admin/books/${book.id}/versions`).then((d) => setVersions(d.versions)).catch(() => setVersions([])); }, [book.id]);

  const restore = async (versionId: string) => {
    if (!confirm("Restore this version? The current file becomes a new version so this is reversible.")) return;
    setBusy(versionId);
    try { await api.post(`/admin/books/${book.id}/versions/${versionId}/restore`); onRestored(); }
    finally { setBusy(null); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl bg-[var(--card)] p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold">Version history — {book.title}</h3>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--fg)]"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between rounded-lg border border-[var(--border)] px-3 py-2">
            <div>
              <p className="text-xs font-semibold">v{book.version} <span className="text-[var(--muted)]">(current)</span></p>
              <p className="text-[11px] text-[var(--muted)]">{book.fileName ?? "No file"} · {book.updatedAt ? new Date(book.updatedAt).toLocaleString() : new Date(book.createdAt).toLocaleString()}</p>
            </div>
          </div>
          {versions === null ? (
            <div className="flex items-center gap-2 py-3 text-xs text-[var(--muted)]"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</div>
          ) : versions.length === 0 ? (
            <p className="py-3 text-xs text-[var(--muted)]">No prior versions — this resource hasn't been replaced yet.</p>
          ) : versions.map((v) => (
            <div key={v.id} className="flex items-center justify-between rounded-lg border border-[var(--border)] px-3 py-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold">v{v.version}</p>
                <p className="truncate text-[11px] text-[var(--muted)]">{v.fileName ?? "No file"} · {new Date(v.createdAt).toLocaleString()}</p>
                {v.changeLog && <p className="mt-0.5 text-[11px] text-[var(--muted)]">"{v.changeLog}"</p>}
              </div>
              <button onClick={() => restore(v.id)} disabled={busy === v.id} className="flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-[var(--fg)] hover:bg-white/5 disabled:opacity-50">
                {busy === v.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />} Restore
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Upload / edit wizard ─────────────────────────────────────────────────
interface Institution {
  faculties: { id: string; name: string }[]; departments: { id: string; name: string; facultyId?: string | null }[];
  programs: { id: string; name: string; departmentId?: string | null; level?: string }[];
  academicYears: { id: string; name: string }[];
}
interface ClassRow { id: string; name: string; code: string }
interface CandidateRow { id: string; name: string; email: string }

interface WizardState {
  resourceType: ResourceType | "";
  title: string; author: string; description: string; summary: string; tags: string;
  genre: BookGenre;
  academicYearId: string; semester: string; facultyId: string; departmentId: string; programId: string;
  course: string; courseCode: string; level: string; instructor: string;
  publisher: string; edition: string; isbn: string; language: string;
  difficulty: string; estimatedReadingTime: string; totalPages: string;
  visibilityScope: "institution" | "scoped"; classIds: string[]; studentIds: string[];
  coverImage: string | null; fileData: string | null; fileName: string | null; externalUrl: string;
  canDownload: boolean; canPreview: boolean; downloadLimit: string; watermarkPdf: boolean;
  status: "draft" | "published"; availableFrom: string; availableUntil: string; notifyEmail: boolean;
}
const EMPTY_STATE: WizardState = {
  resourceType: "", title: "", author: "", description: "", summary: "", tags: "", genre: BOOK_GENRES[0],
  academicYearId: "", semester: "", facultyId: "", departmentId: "", programId: "",
  course: "", courseCode: "", level: "", instructor: "",
  publisher: "", edition: "", isbn: "", language: "", difficulty: "", estimatedReadingTime: "", totalPages: "",
  visibilityScope: "institution", classIds: [], studentIds: [],
  coverImage: null, fileData: null, fileName: null, externalUrl: "",
  canDownload: true, canPreview: true, downloadLimit: "", watermarkPdf: false,
  status: "draft", availableFrom: "", availableUntil: "", notifyEmail: false,
};
function bookToState(b: Book): WizardState {
  return {
    resourceType: b.resourceType, title: b.title, author: b.author, description: b.description ?? "", summary: b.summary ?? "",
    tags: (b.tags ?? []).join(", "), genre: b.genre,
    academicYearId: b.academicYearId ?? "", semester: b.semester ?? "", facultyId: b.facultyId ?? "", departmentId: b.departmentId ?? "", programId: b.programId ?? "",
    course: b.course ?? "", courseCode: b.courseCode ?? "", level: b.level ?? "", instructor: b.instructor ?? "",
    publisher: b.publisher ?? "", edition: b.edition ?? "", isbn: b.isbn ?? "", language: b.language ?? "",
    difficulty: b.difficulty ?? "", estimatedReadingTime: b.estimatedReadingTime ? String(b.estimatedReadingTime) : "", totalPages: b.totalPages ? String(b.totalPages) : "",
    visibilityScope: b.visibility.scope, classIds: b.visibility.classIds, studentIds: b.visibility.studentIds,
    coverImage: b.coverImage ?? null, fileData: null, fileName: b.fileName ?? null, externalUrl: b.externalUrl ?? "",
    canDownload: b.canDownload, canPreview: b.canPreview, downloadLimit: b.downloadLimit ? String(b.downloadLimit) : "", watermarkPdf: !!b.watermarkPdf,
    status: b.status, availableFrom: b.availableFrom ? b.availableFrom.slice(0, 16) : "", availableUntil: b.availableUntil ? b.availableUntil.slice(0, 16) : "", notifyEmail: false,
  };
}

const STEPS = ["Type", "Information", "Visibility", "Upload", "Permissions", "Review", "Publish"] as const;

function UploadWizard({ book, onClose, onDone }: { book: Book | null; onClose: () => void; onDone: () => void }) {
  const [step, setStep] = useState(book ? 1 : 0);
  const [s, setS] = useState<WizardState>(book ? bookToState(book) : EMPTY_STATE);
  const [inst, setInst] = useState<Institution | null>(null);
  const [classes, setClasses] = useState<ClassRow[] | null>(null);
  const [candidates, setCandidates] = useState<CandidateRow[] | null>(null);
  const [reading, setReading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [duplicateOf, setDuplicateOf] = useState<{ id: string; title: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get<Institution>("/admin/institution").then(setInst).catch(() => setInst({ faculties: [], departments: [], programs: [], academicYears: [] }));
    api.get<{ classes: ClassRow[] }>("/admin/classes").then((d) => setClasses(d.classes)).catch(() => setClasses([]));
    api.get<{ candidates: CandidateRow[] }>("/admin/candidates").then((d) => setCandidates(d.candidates)).catch(() => setCandidates([]));
  }, []);

  const patch = (p: Partial<WizardState>) => setS((prev) => ({ ...prev, ...p }));

  const pickCover = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1_000_000) { setErrors(["Cover image must be under 1MB."]); return; }
    const r = new FileReader();
    r.onload = () => patch({ coverImage: String(r.result) });
    r.readAsDataURL(file);
    e.target.value = "";
  };

  const ALLOWED_EXT = [".pdf", ".docx", ".pptx", ".xlsx", ".zip", ".mp3", ".mp4", ".jpg", ".jpeg", ".png", ".webp"];
  const pickDoc = (file: File | undefined) => {
    if (!file) return;
    const ok = ALLOWED_EXT.some((ext) => file.name.toLowerCase().endsWith(ext));
    if (!ok) { setErrors(["Unsupported file type. Allowed: PDF, DOCX, PPTX, XLSX, ZIP, MP3, MP4, JPEG/PNG/WEBP."]); return; }
    if (file.size > 20_000_000) { setErrors(["The file must be under ~20MB. For lecture-length video/audio, use an external link instead."]); return; }
    setReading(true); setErrors([]);
    const r = new FileReader();
    r.onload = () => { patch({ fileData: String(r.result), fileName: file.name }); setReading(false); };
    r.onerror = () => { setErrors(["Couldn't read that file."]); setReading(false); };
    r.readAsDataURL(file);
  };

  const canAdvance = () => {
    if (step === 0) return !!s.resourceType;
    if (step === 1) return !!s.title.trim() && !!s.author.trim();
    return true;
  };

  const departmentsForFaculty = (inst?.departments ?? []).filter((d) => !s.facultyId || d.facultyId === s.facultyId);
  const programsForDepartment = (inst?.programs ?? []).filter((p) => !s.departmentId || p.departmentId === s.departmentId);

  const submit = async (statusOverride?: "draft" | "published") => {
    setBusy(true); setErrors([]); setDuplicateOf(null);
    const status = statusOverride ?? s.status;
    const body = {
      resourceType: s.resourceType, title: s.title, author: s.author, description: s.description, summary: s.summary,
      tags: s.tags.split(",").map((x) => x.trim()).filter(Boolean),
      genre: s.genre,
      academicYearId: s.academicYearId || undefined, semester: s.semester, facultyId: s.facultyId || undefined,
      departmentId: s.departmentId || undefined, programId: s.programId || undefined,
      course: s.course, courseCode: s.courseCode, level: s.level, instructor: s.instructor,
      publisher: s.publisher, edition: s.edition, isbn: s.isbn, language: s.language,
      difficulty: s.difficulty || undefined, estimatedReadingTime: s.estimatedReadingTime || undefined, totalPages: s.totalPages || undefined,
      visibilityScope: s.visibilityScope, classIds: s.classIds, studentIds: s.studentIds,
      coverImage: s.coverImage, fileData: s.fileData, fileName: s.fileName, externalUrl: s.externalUrl,
      canDownload: s.canDownload, canPreview: s.canPreview, downloadLimit: s.downloadLimit || undefined, watermarkPdf: s.watermarkPdf,
      status, availableFrom: s.availableFrom || undefined, availableUntil: s.availableUntil || undefined, notifyEmail: s.notifyEmail,
    };
    try {
      const res = await fetch(book ? `/api/admin/books/${book.id}` : "/api/admin/books", {
        method: book ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.book) { onDone(); return; }
      setErrors(data?.errors ?? [data?.error ?? "Could not save the resource."]);
      if (data?.duplicateOf) setDuplicateOf(data.duplicateOf);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl bg-[var(--card)]">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
          <h3 className="text-sm font-bold">{book ? "Edit resource" : "Upload a resource"}</h3>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--fg)]"><X className="h-4 w-4" /></button>
        </div>

        {/* Stepper */}
        <div className="flex gap-1 overflow-x-auto border-b border-[var(--border)] px-6 py-3">
          {STEPS.map((label, i) => (
            <button key={label} onClick={() => i <= step && setStep(i)} disabled={i > step}
              className={clsx("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold transition",
                i === step ? "bg-[var(--color-navy)] text-white" : i < step ? "text-[var(--fg)] hover:bg-white/5" : "text-[var(--muted)]")}>
              {i + 1}. {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {step === 0 && (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {RESOURCE_TYPES.map((rt) => {
                const Icon = TYPE_ICON[rt];
                const active = s.resourceType === rt;
                return (
                  <button key={rt} onClick={() => patch({ resourceType: rt })}
                    className={clsx("flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition",
                      active ? "border-[var(--accent,theme(colors.lime.400))]" : "border-[var(--border)] hover:border-white/20")}
                    style={active ? { borderColor: LIME, background: "rgba(200,245,61,0.06)" } : undefined}>
                    <Icon className="h-4.5 w-4.5" style={{ color: active ? LIME : undefined }} />
                    <span className="text-xs font-semibold text-[var(--fg)]">{rt}</span>
                    <span className="text-[10px] leading-snug text-[var(--muted)]">{TYPE_DESC[rt]}</span>
                  </button>
                );
              })}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <input className="input h-9" placeholder="Title" value={s.title} onChange={(e) => patch({ title: e.target.value })} />
                <input className="input h-9" placeholder="Author" value={s.author} onChange={(e) => patch({ author: e.target.value })} />
              </div>
              <textarea className="input w-full resize-y" rows={2} placeholder="Description" value={s.description} onChange={(e) => patch({ description: e.target.value })} />
              <textarea className="input w-full resize-y" rows={2} placeholder="Summary (optional, shorter than description)" value={s.summary} onChange={(e) => patch({ summary: e.target.value })} />
              <input className="input h-9 w-full" placeholder="Tags / keywords, comma-separated" value={s.tags} onChange={(e) => patch({ tags: e.target.value })} />
              {s.resourceType === "eBook" && (
                <select className="input h-9 w-full" value={s.genre} onChange={(e) => patch({ genre: e.target.value as BookGenre })}>
                  {BOOK_GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              )}
              <div className="grid grid-cols-2 gap-3">
                <select className="input h-9" value={s.academicYearId} onChange={(e) => patch({ academicYearId: e.target.value })}>
                  <option value="">Academic year (optional)</option>
                  {inst?.academicYears.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
                </select>
                <input className="input h-9" placeholder="Semester" value={s.semester} onChange={(e) => patch({ semester: e.target.value })} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <select className="input h-9" value={s.facultyId} onChange={(e) => patch({ facultyId: e.target.value, departmentId: "", programId: "" })}>
                  <option value="">Faculty (optional)</option>
                  {inst?.faculties.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
                <select className="input h-9" value={s.departmentId} onChange={(e) => patch({ departmentId: e.target.value, programId: "" })}>
                  <option value="">Department (optional)</option>
                  {departmentsForFaculty.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <select className="input h-9" value={s.programId} onChange={(e) => patch({ programId: e.target.value })}>
                  <option value="">Programme (optional)</option>
                  {programsForDepartment.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <input className="input h-9" placeholder="Course" value={s.course} onChange={(e) => patch({ course: e.target.value })} />
                <input className="input h-9" placeholder="Course code" value={s.courseCode} onChange={(e) => patch({ courseCode: e.target.value })} />
                <input className="input h-9" placeholder="Level (e.g. 300)" value={s.level} onChange={(e) => patch({ level: e.target.value })} />
              </div>
              <input className="input h-9 w-full" placeholder="Instructor" value={s.instructor} onChange={(e) => patch({ instructor: e.target.value })} />
              <div className="grid grid-cols-2 gap-3">
                <input className="input h-9" placeholder="Publisher (optional)" value={s.publisher} onChange={(e) => patch({ publisher: e.target.value })} />
                <input className="input h-9" placeholder="Edition (optional)" value={s.edition} onChange={(e) => patch({ edition: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input className="input h-9" placeholder="ISBN (optional)" value={s.isbn} onChange={(e) => patch({ isbn: e.target.value })} />
                <input className="input h-9" placeholder="Language" value={s.language} onChange={(e) => patch({ language: e.target.value })} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <select className="input h-9" value={s.difficulty} onChange={(e) => patch({ difficulty: e.target.value })}>
                  <option value="">Difficulty (optional)</option>
                  {RESOURCE_DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                <input className="input h-9" type="number" min={0} placeholder="Reading time (min)" value={s.estimatedReadingTime} onChange={(e) => patch({ estimatedReadingTime: e.target.value })} />
                <input className="input h-9" type="number" min={0} placeholder="Total pages (optional)" value={s.totalPages} onChange={(e) => patch({ totalPages: e.target.value })} />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-xl border border-[var(--border)] p-4">
                <div>
                  <p className="text-sm font-semibold">Entire institution</p>
                  <p className="text-xs text-[var(--muted)]">Every student can see this resource.</p>
                </div>
                <button onClick={() => patch({ visibilityScope: s.visibilityScope === "institution" ? "scoped" : "institution" })}
                  className={clsx("h-6 w-11 shrink-0 rounded-full transition", s.visibilityScope === "institution" ? "" : "bg-white/10")}
                  style={s.visibilityScope === "institution" ? { background: LIME } : undefined}>
                  <span className={clsx("block h-5 w-5 rounded-full bg-white transition-transform", s.visibilityScope === "institution" ? "translate-x-5" : "translate-x-0.5")} />
                </button>
              </div>
              {s.visibilityScope === "scoped" && (
                <>
                  <div>
                    <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[var(--muted)]"><Users2 className="h-3.5 w-3.5" /> Classes</p>
                    <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-[var(--border)] p-2">
                      {(classes ?? []).length === 0 && <p className="p-1 text-xs text-[var(--muted)]">No classes yet.</p>}
                      {(classes ?? []).map((c) => (
                        <label key={c.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-white/5">
                          <input type="checkbox" checked={s.classIds.includes(c.id)}
                            onChange={(e) => patch({ classIds: e.target.checked ? [...s.classIds, c.id] : s.classIds.filter((id) => id !== c.id) })} />
                          {c.name} {c.code && <span className="text-[var(--muted)]">· {c.code}</span>}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[var(--muted)]"><Building2 className="h-3.5 w-3.5" /> Individual students</p>
                    <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-[var(--border)] p-2">
                      {(candidates ?? []).length === 0 && <p className="p-1 text-xs text-[var(--muted)]">No students yet.</p>}
                      {(candidates ?? []).map((c) => (
                        <label key={c.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-white/5">
                          <input type="checkbox" checked={s.studentIds.includes(c.id)}
                            onChange={(e) => patch({ studentIds: e.target.checked ? [...s.studentIds, c.id] : s.studentIds.filter((id) => id !== c.id) })} />
                          {c.name} <span className="text-[var(--muted)]">· {c.email}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <button onClick={() => fileRef.current?.click()}
                  className="flex h-20 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-[var(--border)] bg-[var(--card-2)]">
                  {s.coverImage ? <img src={s.coverImage} alt="" className="h-full w-full object-cover" /> : <ImagePlus className="h-5 w-5 text-[var(--muted)]" />}
                </button>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pickCover} />
                <p className="text-xs text-[var(--muted)]">Cover image, optional. Under 1MB.</p>
              </div>

              <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pickDoc(e.dataTransfer.files?.[0]); }}>
                <button onClick={() => docRef.current?.click()} disabled={reading}
                  className="flex w-full items-center gap-2.5 rounded-lg border border-dashed border-[var(--border)] bg-[var(--card-2)] px-3 py-4 text-left transition hover:border-white/20 disabled:opacity-60">
                  {reading ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[var(--muted)]" />
                    : s.fileData || s.fileName ? <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: LIME }} />
                    : <FileText className="h-4 w-4 shrink-0 text-[var(--muted)]" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-[var(--fg)]">
                      {reading ? "Reading file…" : s.fileName ?? "Drag & drop, or click to choose a file"}
                    </span>
                    <span className="block text-[10px] text-[var(--muted)]">PDF, DOCX, PPTX, XLSX, ZIP, MP3, MP4, images — up to ~20MB</span>
                  </span>
                </button>
                <input ref={docRef} type="file" className="hidden" onChange={(e) => pickDoc(e.target.files?.[0])} />
              </div>

              <input className="input h-9 w-full" placeholder="External link (recommended for lecture-length video/audio)" value={s.externalUrl} onChange={(e) => patch({ externalUrl: e.target.value })} />
            </div>
          )}

          {step === 4 && (
            <div className="space-y-3">
              <ToggleRow label="Students can download" checked={s.canDownload} onChange={(v) => patch({ canDownload: v })} />
              <ToggleRow label="Students can preview" checked={s.canPreview} onChange={(v) => patch({ canPreview: v })} />
              <ToggleRow label="Watermark PDF downloads with student name" checked={s.watermarkPdf} onChange={(v) => patch({ watermarkPdf: v })} />
              <input className="input h-9 w-full" type="number" min={0} placeholder="Download limit per student (optional)" value={s.downloadLimit} onChange={(e) => patch({ downloadLimit: e.target.value })} />
            </div>
          )}

          {step === 5 && (
            <div className="space-y-3 text-sm">
              <div className="flex items-start gap-3">
                <div className="w-16 shrink-0"><BookCover title={s.title || "Untitled"} coverImage={s.coverImage} /></div>
                <div>
                  <p className="font-bold">{s.title || "Untitled"}</p>
                  <p className="text-xs text-[var(--muted)]">{s.author || "Unknown author"} · {s.resourceType}</p>
                </div>
              </div>
              <ReviewRow label="Course" value={[s.courseCode, s.course].filter(Boolean).join(" — ")} />
              <ReviewRow label="Department" value={inst?.departments.find((d) => d.id === s.departmentId)?.name} />
              <ReviewRow label="Faculty" value={inst?.faculties.find((f) => f.id === s.facultyId)?.name} />
              <ReviewRow label="Level / Semester" value={[s.level, s.semester].filter(Boolean).join(" / ")} />
              <ReviewRow label="Tags" value={s.tags} />
              <ReviewRow label="Visibility" value={s.visibilityScope === "institution" ? "Entire institution" : `${s.classIds.length} class(es), ${s.studentIds.length} student(s)`} />
              <ReviewRow label="File" value={s.fileName ?? (s.externalUrl ? "External link" : "None")} />
              <ReviewRow label="Permissions" value={[s.canDownload && "Download", s.canPreview && "Preview", s.watermarkPdf && "Watermarked"].filter(Boolean).join(", ") || "None"} />
            </div>
          )}

          {step === 6 && (
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-xs"><input type="radio" name="status" checked={s.status === "draft"} onChange={() => patch({ status: "draft" })} /> Save as draft</label>
              <label className="flex items-center gap-2 text-xs"><input type="radio" name="status" checked={s.status === "published"} onChange={() => patch({ status: "published" })} /> Publish now</label>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-[var(--muted)]">
                  <span className="mb-1 flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" /> Available from (optional)</span>
                  <input type="datetime-local" className="input h-9 w-full" value={s.availableFrom} onChange={(e) => patch({ availableFrom: e.target.value })} />
                </label>
                <label className="text-xs text-[var(--muted)]">
                  <span className="mb-1 block">Expires (optional)</span>
                  <input type="datetime-local" className="input h-9 w-full" value={s.availableUntil} onChange={(e) => patch({ availableUntil: e.target.value })} />
                </label>
              </div>
              <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
                <input type="checkbox" checked={s.notifyEmail} onChange={(e) => patch({ notifyEmail: e.target.checked })} /> Notify students by email when published
              </label>
            </div>
          )}

          {duplicateOf && (
            <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              This file matches an existing resource: "{duplicateOf.title}". You can still continue if this is intentional.
            </div>
          )}
          {errors.length > 0 && (
            <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
              {errors.map((e, i) => <p key={i}>{e}</p>)}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--border)] px-6 py-4">
          <button onClick={() => (step === 0 ? onClose() : setStep(step - 1))} className="flex items-center gap-1 rounded-lg px-3.5 py-2 text-xs font-semibold text-[var(--muted)] hover:text-[var(--fg)]">
            <ChevronLeft className="h-3.5 w-3.5" /> {step === 0 ? "Cancel" : "Back"}
          </button>
          {step < STEPS.length - 1 ? (
            <button onClick={() => canAdvance() && setStep(step + 1)} disabled={!canAdvance()} className="flex items-center gap-1 rounded-lg px-4 py-2 text-xs font-bold text-[#08090a] disabled:opacity-50" style={{ background: LIME }}>
              Next <ChevronRight className="h-3.5 w-3.5" />
            </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => submit("draft")} disabled={busy} className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--fg)] disabled:opacity-60">
                <Save className="h-3.5 w-3.5" /> Save draft
              </button>
              <button onClick={() => submit()} disabled={busy} className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold text-[#08090a] disabled:opacity-60" style={{ background: LIME }}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} {s.status === "published" ? "Publish" : "Save"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-[var(--border)] p-3.5">
      <p className="text-xs font-medium text-[var(--fg)]">{label}</p>
      <button onClick={() => onChange(!checked)} className={clsx("h-6 w-11 shrink-0 rounded-full transition", checked ? "" : "bg-white/10")} style={checked ? { background: LIME } : undefined}>
        <span className={clsx("block h-5 w-5 rounded-full bg-white transition-transform", checked ? "translate-x-5" : "translate-x-0.5")} />
      </button>
    </div>
  );
}
function ReviewRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--border)] py-1.5 text-xs">
      <span className="text-[var(--muted)]">{label}</span>
      <span className="text-[var(--fg)]">{value?.trim() || "—"}</span>
    </div>
  );
}
