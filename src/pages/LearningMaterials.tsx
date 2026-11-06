import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { GraduationCap, Globe, ChevronDown, Timer, ChevronRight } from "lucide-react";
import { Shell } from "@/components/Shell";
import { Skeleton, EmptyState, ErrorBanner, Modal } from "@/components/ui";
import { api } from "@/lib/api";
import type { ExamListItem } from "@shared/types";

function startIso(it: ExamListItem): string | null {
  return it.registration.scheduledStart || it.exam.availableFrom || null;
}
function fmtDate(iso: string | null) {
  if (!iso) return "Not scheduled";
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Stable hue from the title, so a card without a cover image still gets its own colour. */
function hueOf(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

function Cover({ it }: { it: ExamListItem }) {
  const { exam } = it;
  if (exam.coverImage) {
    return <img src={exam.coverImage} alt="" className="h-full w-full object-cover" />;
  }
  const h = hueOf(exam.title);
  return (
    <div className="flex h-full w-full items-end p-4"
      style={{ background: `linear-gradient(135deg, oklch(0.42 0.12 ${h}), oklch(0.28 0.08 ${(h + 40) % 360}))` }}>
      <span className="line-clamp-2 text-2xl font-extrabold leading-tight text-white">{exam.subject || exam.code}</span>
    </div>
  );
}

type Sort = "next" | "title" | "materials";

// Same underlying data as Library (Exam.resources), but scoped to exams that
// aren't submitted yet — "what should I be studying right now" rather than
// Library's full historical archive, so the two pages don't just duplicate.
export function LearningMaterials() {
  const [items, setItems] = useState<ExamListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("next");
  const [open, setOpen] = useState<ExamListItem | null>(null);

  useEffect(() => { api.get<{ items: ExamListItem[] }>("/exams").then((d) => setItems(d.items)).catch((e) => setError(e.message)); }, []);

  const list = useMemo(() => {
    if (!items) return [];
    const pending = items.filter((it) => it.attempt?.status !== "submitted");
    return pending.sort((a, b) => {
      if (sort === "title") return a.exam.title.localeCompare(b.exam.title);
      if (sort === "materials") return (b.exam.resources?.length ?? 0) - (a.exam.resources?.length ?? 0);
      return (startIso(a) ?? "9999").localeCompare(startIso(b) ?? "9999");
    });
  }, [items, sort]);

  return (
    <Shell>
      <div className="fade-in">
        {error && <ErrorBanner className="mb-4">{error}</ErrorBanner>}

        {!items && !error && (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i}><Skeleton className="aspect-video w-full rounded-lg" /><Skeleton className="mt-3 h-4 w-3/4" /><Skeleton className="mt-2 h-3 w-1/2" /></div>
            ))}
          </div>
        )}

        {items && (
          list.length === 0 ? (
            <EmptyState icon={GraduationCap} title="Nothing to prepare for right now" hint="Materials for your next exam will show up here once you're registered." />
          ) : (
            <>
              <div className="mb-4 flex items-center justify-between">
                <h1 className="text-base font-bold">{list.length} {list.length === 1 ? "exam" : "exams"} to prepare for</h1>
                <label className="relative inline-flex items-center gap-1 text-sm font-bold">
                  <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}
                    className="cursor-pointer appearance-none bg-transparent pr-5 outline-none" aria-label="Sort exams">
                    <option value="next">Next up</option>
                    <option value="title">Title A–Z</option>
                    <option value="materials">Most materials</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-0 h-4 w-4" />
                </label>
              </div>

              <div className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {list.map((it) => {
                  const count = it.exam.resources?.length ?? 0;
                  return (
                    <button key={it.registration.id} type="button" onClick={() => setOpen(it)} className="group text-left">
                      <div className="aspect-video w-full overflow-hidden rounded-lg border border-[var(--border)]"><Cover it={it} /></div>
                      <p className="mt-3 line-clamp-2 text-base font-bold leading-snug group-hover:underline">{it.exam.title}</p>
                      <p className="mt-1 truncate text-sm text-[var(--muted)]">{it.exam.subject ? `${it.exam.subject} · ` : ""}{it.exam.code}</p>
                      <div className="mt-3 border-t-4 border-[var(--card-2)] pt-2">
                        <div className="flex items-start justify-between gap-2 text-sm">
                          <span className="font-medium">{count === 0 ? "No materials yet" : `${count} study ${count === 1 ? "material" : "materials"}`}</span>
                          <span className="inline-flex shrink-0 items-center gap-1 text-[var(--muted)]"><Timer className="h-3.5 w-3.5" /> {fmtDate(startIso(it))}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )
        )}
      </div>

      {open && (
        <Modal title={open.exam.title} onClose={() => setOpen(null)}>
          <p className="mt-1 text-sm text-[var(--muted)]">{open.exam.subject ? `${open.exam.subject} · ` : ""}{open.exam.code} · {fmtDate(startIso(open))}</p>
          {(open.exam.resources ?? []).length === 0 ? (
            <p className="mt-4 text-sm text-[var(--muted)]">No study materials attached to this exam yet.</p>
          ) : (
            <div className="mt-4 space-y-2">
              {open.exam.resources!.map((r, i) => (
                <a key={i} href={r.url} target="_blank" rel="noreferrer"
                  className="flex items-center gap-2 rounded-xl border border-[var(--border)] p-3 text-sm font-semibold text-[var(--fg)] transition hover:bg-[var(--card-2)]">
                  <Globe className="h-4 w-4 shrink-0 text-[var(--lime-text)]" /> <span className="truncate">{r.label || r.url}</span>
                </a>
              ))}
            </div>
          )}
          <Link to={`/exams/${open.registration.id}/checkin`}
            className="mt-5 flex w-full items-center justify-center gap-1 rounded-lg px-3 py-2.5 text-sm font-bold text-[var(--brand-ink)] transition hover:opacity-90"
            style={{ background: "var(--color-brand-500)" }}>
            Prepare <ChevronRight className="h-4 w-4" />
          </Link>
        </Modal>
      )}
    </Shell>
  );
}
