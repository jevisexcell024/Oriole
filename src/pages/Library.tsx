import { useEffect, useMemo, useState } from "react";
import {
  Filter, Search, X, Download, Eye, Bookmark, BookmarkCheck, Share2, Star, History, BookOpenCheck, Loader2,
  BookOpen, NotebookPen, FileQuestion, Video, Music, ClipboardList, FlaskConical, GraduationCap, Newspaper,
  Presentation, Code2, FolderArchive, Link2, Library as LibraryIcon, ScrollText, ListTree, MoreHorizontal,
} from "lucide-react";
import DOMPurify from "dompurify";
import { Shell } from "@/components/Shell";
import { Skeleton, EmptyState, ErrorBanner } from "@/components/ui";
import { BookCover } from "@/components/BookCover";
import { api } from "@/lib/api";
import { useExamLock } from "@/lib/examLock";
import type { Book, ResourceType, ResourceVersion } from "@shared/types";
import { RESOURCE_TYPES } from "@shared/types";
import { clsx } from "clsx";

const LIME = "oklch(0.86 0.18 112)";
const LIME_TINT = "oklch(0.86 0.18 112 / 0.45)";

const TYPE_ICON: Record<ResourceType, typeof BookOpen> = {
  "Textbook": BookOpen, "Lecture Notes": NotebookPen, "Past Questions": FileQuestion, "Video": Video, "Audio": Music,
  "Assignment Guide": ClipboardList, "Lab Manual": FlaskConical, "Research Paper": GraduationCap, "Journal": Newspaper,
  "Presentation": Presentation, "Source Code": Code2, "ZIP Resources": FolderArchive, "External Link": Link2,
  "eBook": LibraryIcon, "Policy Document": ScrollText, "Course Outline": ListTree, "Other": MoreHorizontal,
};

function fmtBytes(n?: number | null) {
  if (!n) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
function isNew(createdAt: string) { return Date.now() - new Date(createdAt).getTime() < 7 * 24 * 3600_000; }
function isUpdated(book: Book) { return book.version > 1 && !!book.updatedAt && Date.now() - new Date(book.updatedAt).getTime() < 7 * 24 * 3600_000; }

/** Which file types Oriole can actually render inside the app, using what's
 *  already available (native browser PDF/image/audio/video rendering, plus
 *  `mammoth` — already a client dependency, see src/lib/importTable.ts —
 *  for DOCX→HTML). Anything else (PPTX/XLSX/ZIP/source code/etc.) stays
 *  download-only rather than faking a preview that can't actually render. */
type ReadableKind = "pdf" | "docx" | "image" | "audio" | "video";
function readableKind(book: Book): ReadableKind | null {
  if (!book.fileName) return null;
  switch (book.fileMime) {
    case "application/pdf": return "pdf";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": return "docx";
    case "image/jpeg": case "image/png": case "image/webp": return "image";
    case "audio/mpeg": case "audio/mp3": return "audio";
    case "video/mp4": return "video";
    default: return null;
  }
}

interface Progress { currentPage: number; }
interface Item { book: Book; progress: Progress | null; bookmarked: boolean; avgRating: number; ratingCount: number; bookmarkCount: number; }

function pct(book: Book, progress: Progress | null) {
  if (!progress || book.totalPages <= 0) return 0;
  return Math.round((progress.currentPage / book.totalPages) * 100);
}
function pagesLeft(book: Book, progress: Progress | null) {
  return Math.max(0, book.totalPages - (progress?.currentPage ?? 0));
}

export function Library() {
  const examLocked = useExamLock();
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<ResourceType | "All">("All");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"newest" | "popular" | "downloads" | "rating">("newest");
  const [active, setActive] = useState<Item | null>(null);

  const load = () => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (type !== "All") params.set("type", type);
    if (sort !== "newest") params.set("sort", sort);
    api.get<{ items: Item[] }>(`/books?${params.toString()}`).then((d) => setItems(d.items)).catch((e) => setError(e.message));
  };
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [q, type, sort]);

  const continueReading = useMemo(
    () => (items ?? []).filter((it) => it.progress && it.progress.currentPage > 0 && it.progress.currentPage < it.book.totalPages),
    [items],
  );

  if (examLocked) {
    return (
      <Shell>
        <div className="fade-in" style={{ background: "#08090a", margin: "-1.5rem", padding: "1.5rem", minHeight: "calc(100vh - 69px)" }}>
          <EmptyState className="mt-6" icon={X} title="Unavailable right now"
            hint="The library is disabled while you have an exam in progress. It'll be back once you submit." />
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="fade-in -m-4 sm:-m-6" style={{ background: "#08090a", minHeight: "calc(100vh - 69px)" }}>
        {error && <ErrorBanner className="m-6">{error}</ErrorBanner>}

        {!items && !error && (
          <div className="p-8">
            <Skeleton className="h-[220px] w-full rounded-2xl" />
            <Skeleton className="mt-8 h-8 w-40" />
            <div className="mt-4 grid grid-cols-6 gap-4">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="aspect-[3/4] w-full rounded-xl" />)}
            </div>
          </div>
        )}

        {items && (
          <>
            {/* Section 1 — Continue reading */}
            {continueReading.length > 0 && (
              <div style={{ background: "linear-gradient(180deg, #111213, #0c0d0e)", padding: "24px 32px" }}>
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold text-white">Continue reading</h2>
                </div>
                <div className="mt-4 flex items-stretch gap-3 overflow-x-auto pb-1">
                  {continueReading.map((it) => (
                    <button key={it.book.id} onClick={() => setActive(it)}
                      className="flex shrink-0 items-center gap-3 rounded-xl p-3 text-left transition hover:border-white/[0.12]"
                      style={{ width: 210, height: 88, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                      <BookCover variant="mini" title={it.book.title} coverImage={it.book.coverImage} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-white">{it.book.title}</p>
                        <p className="truncate text-xs text-white/45">{it.book.author}</p>
                        <div className="mt-1.5 h-[2px] w-full rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
                          <div className="h-full rounded-full" style={{ width: `${pct(it.book, it.progress)}%`, background: LIME_TINT }} />
                        </div>
                        <p className="mt-1 text-[10px] text-white/40">{pct(it.book, it.progress)}% · {pagesLeft(it.book, it.progress)} pages left</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Section 2 — Library */}
            <div style={{ padding: "24px 32px" }}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, fontWeight: 600 }} className="text-white">Library</h2>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 rounded-full px-3 py-1.5" style={{ background: "rgba(255,255,255,0.05)" }}>
                    <Search className="h-3.5 w-3.5 text-white/50" />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, author, course, tags…"
                      className="w-48 bg-transparent text-xs text-white outline-none placeholder:text-white/35" />
                  </div>
                  <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}
                    className="rounded-full border-none px-3 py-1.5 text-xs font-medium text-white/70 outline-none" style={{ background: "rgba(255,255,255,0.05)" }}>
                    <option value="newest">Newest</option>
                    <option value="popular">Most popular</option>
                    <option value="downloads">Most downloaded</option>
                    <option value="rating">Top rated</option>
                  </select>
                </div>
              </div>

              {/* Type tabs */}
              <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
                {(["All", ...RESOURCE_TYPES] as const).map((rt) => {
                  const isActive = type === rt;
                  return (
                    <button key={rt} onClick={() => setType(rt)}
                      className="flex shrink-0 items-center gap-1 rounded-full text-xs font-medium transition"
                      style={{
                        padding: "6px 14px",
                        background: isActive ? LIME_TINT : "rgba(255,255,255,0.04)",
                        color: isActive ? LIME : "rgba(255,255,255,0.55)",
                        border: isActive ? `1px solid ${LIME}` : "1px solid transparent",
                      }}>
                      {rt}
                    </button>
                  );
                })}
              </div>

              {/* Grid */}
              {items.length === 0 ? (
                <EmptyState className="mt-8" icon={Filter} title="No resources found" hint="Try a different search or filter." />
              ) : (
                <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                  {items.map((it) => (
                    <ResourceCard key={it.book.id} item={it} onOpen={() => setActive(it)} onChanged={load} />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {active && (
        <ResourceDetailModal item={active} onClose={() => setActive(null)} onChanged={() => { load(); }} />
      )}
    </Shell>
  );
}

function ResourceCard({ item, onOpen, onChanged }: { item: Item; onOpen: () => void; onChanged: () => void }) {
  const { book } = item;
  const Icon = TYPE_ICON[book.resourceType] ?? MoreHorizontal;
  const [bookmarked, setBookmarked] = useState(item.bookmarked);
  const [busy, setBusy] = useState(false);

  const toggleBookmark = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setBusy(true);
    try {
      if (bookmarked) await api.del(`/books/${book.id}/bookmark`); else await api.post(`/books/${book.id}/bookmark`);
      setBookmarked(!bookmarked);
      onChanged();
    } finally { setBusy(false); }
  };
  const share = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(`${window.location.origin}/library?resource=${book.id}`).catch(() => {});
  };

  return (
    <div className="group cursor-pointer" onClick={onOpen}>
      <div className="relative">
        <BookCover title={book.title} coverImage={book.coverImage} progressPercent={item.progress ? pct(book, item.progress) : null} onRead={onOpen} />
        <div className="absolute left-1.5 top-1.5 flex gap-1">
          {isNew(book.createdAt) && <span className="rounded-full px-1.5 py-0.5 text-[9px] font-bold text-[#08090a]" style={{ background: LIME }}>NEW</span>}
          {isUpdated(book) && <span className="rounded-full bg-cyan-400 px-1.5 py-0.5 text-[9px] font-bold text-[#08090a]">UPDATED</span>}
        </div>
        <button onClick={toggleBookmark} disabled={busy}
          className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white/80 opacity-0 transition group-hover:opacity-100 hover:text-white">
          {bookmarked ? <BookmarkCheck className="h-3.5 w-3.5" style={{ color: LIME }} /> : <Bookmark className="h-3.5 w-3.5" />}
        </button>
      </div>
      <div className="mt-2 flex items-center gap-1">
        <Icon className="h-3 w-3 shrink-0 text-white/40" />
        <p className="truncate text-xs font-semibold text-white">{book.title}</p>
      </div>
      <p className="truncate text-[11px] text-white/45">{book.course || book.instructor || book.author}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-white/35">
        {book.totalPages > 0 && <span>{book.totalPages}p</span>}
        {fmtBytes(book.fileSize) && <span>{fmtBytes(book.fileSize)}</span>}
        <span className="inline-flex items-center gap-0.5"><Eye className="h-2.5 w-2.5" /> {book.viewCount}</span>
        <span className="inline-flex items-center gap-0.5"><Download className="h-2.5 w-2.5" /> {book.downloadCount}</span>
        {item.ratingCount > 0 && <span className="inline-flex items-center gap-0.5"><Star className="h-2.5 w-2.5 fill-current" style={{ color: LIME }} /> {item.avgRating}</span>}
        <button onClick={share} className="ml-auto text-white/30 hover:text-white/60"><Share2 className="h-2.5 w-2.5" /></button>
      </div>
    </div>
  );
}

interface DetailResponse {
  book: Book; progress: Progress | null; bookmarked: boolean; myRating: { score: number } | null;
  avgRating: number; ratingCount: number; bookmarkCount: number; relatedResources: Book[];
}

function ResourceDetailModal({ item, onClose, onChanged }: { item: Item; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [page, setPage] = useState(item.progress?.currentPage ?? 0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [myScore, setMyScore] = useState(0);
  const [versions, setVersions] = useState<ResourceVersion[] | null>(null);
  const [showVersions, setShowVersions] = useState(false);
  const [reading, setReading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadErr, setDownloadErr] = useState<string | null>(null);

  useEffect(() => {
    api.get<DetailResponse>(`/books/${item.book.id}`).then((d) => { setDetail(d); setMyScore(d.myRating?.score ?? 0); }).catch(() => {});
    api.post(`/books/${item.book.id}/view`).catch(() => {});
  }, [item.book.id]);

  const book = detail?.book ?? item.book;

  const saveProgress = async () => {
    setBusy(true); setErr(null);
    try { await api.post(`/books/${book.id}/progress`, { currentPage: page }); onChanged(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const toggleBookmark = async () => {
    if (!detail) return;
    if (detail.bookmarked) await api.del(`/books/${book.id}/bookmark`); else await api.post(`/books/${book.id}/bookmark`);
    setDetail({ ...detail, bookmarked: !detail.bookmarked, bookmarkCount: detail.bookmarkCount + (detail.bookmarked ? -1 : 1) });
    onChanged();
  };

  const rate = async (score: number) => {
    setMyScore(score);
    const res = await api.post<{ avg: number; count: number }>(`/books/${book.id}/rating`, { score });
    setDetail((d) => d ? { ...d, avgRating: res.avg, ratingCount: res.count } : d);
  };

  const toggleVersions = () => {
    setShowVersions((v) => !v);
    if (!versions) api.get<{ versions: ResourceVersion[] }>(`/admin/books/${book.id}/versions`).then((d) => setVersions(d.versions)).catch(() => setVersions([]));
  };

  // Deliberately not a plain <a href download> — when the server rejects the
  // request (download limit reached, permission revoked, session expired),
  // the browser would otherwise just display the raw JSON error as if it
  // were the downloaded file, with no indication anything went wrong.
  const downloadResource = async () => {
    setDownloading(true); setDownloadErr(null);
    try {
      const res = await fetch(`/api/books/${book.id}/download`, { credentials: "include" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Download failed (${res.status}).`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = book.fileName ?? book.title;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      onChanged();
    } catch (e) {
      setDownloadErr((e as Error).message);
    } finally {
      setDownloading(false);
    }
  };

  const kind = readableKind(book);
  const canPreview = book.canPreview !== false;
  const canDownload = book.canDownload !== false;

  if (reading && kind) {
    return <ResourceReaderOverlay book={book} kind={kind} onClose={() => setReading(false)} />;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-2xl p-6" style={{ background: "#111213", border: "1px solid rgba(255,255,255,0.08)" }}>
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="w-20 shrink-0"><BookCover title={book.title} coverImage={book.coverImage} /></div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold text-white">{book.title}</h3>
              <p className="text-xs text-white/50">{book.author} · {book.resourceType}</p>
              {book.instructor && <p className="mt-0.5 text-xs text-white/40">Instructor: {book.instructor}</p>}
              {(book.course || book.departmentName) && <p className="text-xs text-white/40">{[book.courseCode, book.course, book.departmentName].filter(Boolean).join(" · ")}</p>}
              <div className="mt-1.5 flex items-center gap-3 text-[11px] text-white/40">
                <span className="inline-flex items-center gap-1"><Eye className="h-3 w-3" /> {book.viewCount}</span>
                <span className="inline-flex items-center gap-1"><Download className="h-3 w-3" /> {book.downloadCount}</span>
                <span>v{book.version}</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-white/50 hover:text-white"><X className="h-4 w-4" /></button>
        </div>

        {book.description && <p className="mt-3 text-xs leading-relaxed text-white/55">{book.description}</p>}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {kind && canPreview && (
            <button onClick={() => setReading(true)} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-[#08090a]" style={{ background: LIME }}>
              <BookOpenCheck className="h-3.5 w-3.5" /> Read online
            </button>
          )}
          {book.fileName && canDownload && (
            <button onClick={downloadResource} disabled={downloading} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white/70 disabled:opacity-60" style={{ background: "rgba(255,255,255,0.06)" }}>
              {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Download
            </button>
          )}
          {book.externalUrl && (
            <a href={book.externalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white/70" style={{ background: "rgba(255,255,255,0.06)" }}>
              External link
            </a>
          )}
          <button onClick={toggleBookmark} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white/70" style={{ background: "rgba(255,255,255,0.06)" }}>
            {detail?.bookmarked ? <BookmarkCheck className="h-3.5 w-3.5" style={{ color: LIME }} /> : <Bookmark className="h-3.5 w-3.5" />} {detail?.bookmarkCount ?? item.bookmarkCount}
          </button>
          <button onClick={toggleVersions} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white/70" style={{ background: "rgba(255,255,255,0.06)" }}>
            <History className="h-3.5 w-3.5" /> v{book.version}
          </button>
        </div>

        {downloadErr && <p className="mt-2 text-xs text-rose-400">{downloadErr}</p>}

        {showVersions && (
          <div className="mt-2 rounded-lg border border-white/10 p-2">
            {versions === null ? <p className="text-[11px] text-white/40">Loading…</p>
              : versions.length === 0 ? <p className="text-[11px] text-white/40">No prior versions.</p>
              : versions.map((v) => <p key={v.id} className="py-0.5 text-[11px] text-white/40">v{v.version} · {new Date(v.createdAt).toLocaleDateString()}</p>)}
          </div>
        )}

        {book.totalPages > 0 && (
          <div className="mt-4">
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-white/45">
              Current page (of {book.totalPages})
            </label>
            <div className="flex items-center gap-2">
              <input type="number" min={0} max={book.totalPages} value={page}
                onChange={(e) => setPage(Math.max(0, Math.min(book.totalPages, Number(e.target.value))))}
                className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-[oklch(0.86_0.18_112)]" />
              <button onClick={saveProgress} disabled={busy} className="shrink-0 rounded-lg px-3.5 py-2 text-xs font-bold text-[#08090a] disabled:opacity-60" style={{ background: LIME }}>
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
            {err && <p className="mt-2 text-xs text-rose-400">{err}</p>}
          </div>
        )}

        <div className="mt-4">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-white/45">Rate this resource</p>
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} onClick={() => rate(n)}>
                <Star className={clsx("h-4 w-4", n <= myScore ? "fill-current" : "text-white/20")} style={n <= myScore ? { color: LIME } : undefined} />
              </button>
            ))}
            {detail && detail.ratingCount > 0 && <span className="ml-2 text-[11px] text-white/40">{detail.avgRating} avg · {detail.ratingCount} rating{detail.ratingCount === 1 ? "" : "s"}</span>}
          </div>
        </div>

        {detail && detail.relatedResources.length > 0 && (
          <div className="mt-4">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/45">Related resources</p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {detail.relatedResources.map((r) => (
                <div key={r.id} className="w-16 shrink-0"><BookCover title={r.title} coverImage={r.coverImage} /></div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Full-screen in-app reader. PDF/image/audio/video render natively via the
 *  browser; DOCX is converted client-side with `mammoth` (already a
 *  dependency, same pattern as src/lib/importTable.ts) since browsers can't
 *  render Word documents natively. Served via GET /books/:id/read, which is
 *  gated by `canPreview` — separate from the canDownload/downloadLimit/
 *  watermark checks on the download endpoint, since reading in-app isn't a
 *  download. */
function ResourceReaderOverlay({ book, kind, onClose }: { book: Book; kind: ReadableKind; onClose: () => void }) {
  const readUrl = `/api/books/${book.id}/read`;
  const [docxHtml, setDocxHtml] = useState<string | null>(null);
  const [docxError, setDocxError] = useState<string | null>(null);

  useEffect(() => {
    if (kind !== "docx") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(readUrl, { credentials: "include" });
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Couldn't load this document.");
        const arrayBuffer = await res.arrayBuffer();
        const mod = await import("mammoth");
        const mammoth = (mod as { default?: unknown }).default ?? mod;
        const { value: html } = await (mammoth as { convertToHtml: (i: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }> }).convertToHtml({ arrayBuffer });
        if (!cancelled) setDocxHtml(DOMPurify.sanitize(html));
      } catch (e) {
        if (!cancelled) setDocxError((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [kind, readUrl]);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#08090a]">
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
        <p className="truncate text-sm font-semibold text-white">{book.title}</p>
        <button onClick={onClose} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white/70 hover:bg-white/5">
          <X className="h-3.5 w-3.5" /> Close
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {kind === "pdf" && <iframe src={readUrl} title={book.title} className="h-full w-full border-0" />}
        {kind === "image" && (
          <div className="flex h-full w-full items-center justify-center p-4">
            <img src={readUrl} alt={book.title} className="max-h-full max-w-full object-contain" />
          </div>
        )}
        {kind === "audio" && (
          <div className="flex h-full w-full items-center justify-center p-4">
            <audio src={readUrl} controls autoPlay={false} className="w-full max-w-md" />
          </div>
        )}
        {kind === "video" && (
          <div className="flex h-full w-full items-center justify-center bg-black p-4">
            <video src={readUrl} controls className="max-h-full max-w-full" />
          </div>
        )}
        {kind === "docx" && (
          <div className="mx-auto max-w-3xl px-6 py-8">
            {docxError ? (
              <p className="text-sm text-rose-400">{docxError}</p>
            ) : docxHtml === null ? (
              <div className="flex items-center gap-2 text-sm text-white/50"><Loader2 className="h-4 w-4 animate-spin" /> Loading document…</div>
            ) : (
              <>
                <style>{`
                  .docx-reader { font-size: 14px; line-height: 1.7; color: rgba(255,255,255,0.85); }
                  .docx-reader h1, .docx-reader h2, .docx-reader h3 { font-weight: 700; color: #fff; margin: 1.2em 0 0.5em; }
                  .docx-reader h1 { font-size: 1.5em; } .docx-reader h2 { font-size: 1.3em; } .docx-reader h3 { font-size: 1.1em; }
                  .docx-reader p { margin: 0.75em 0; }
                  .docx-reader ul, .docx-reader ol { margin: 0.75em 0; padding-left: 1.5em; }
                  .docx-reader ul { list-style: disc; } .docx-reader ol { list-style: decimal; }
                  .docx-reader table { border-collapse: collapse; margin: 1em 0; }
                  .docx-reader td, .docx-reader th { border: 1px solid rgba(255,255,255,0.15); padding: 6px 10px; }
                  .docx-reader img { max-width: 100%; }
                `}</style>
                <div className="docx-reader" dangerouslySetInnerHTML={{ __html: docxHtml }} />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
