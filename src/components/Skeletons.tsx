import { Skeleton, TableSkeleton } from "@/components/ui";

/** Page-shaped loading placeholders. Each variant mirrors the layout of the
 *  kind of page it stands in for (a table page, a card grid, a form, the student
 *  dashboard…), so what you see while data loads already has the page's shape and
 *  the real content simply replaces it. They render inside the normal app frame
 *  (sidebar + header) — never as a full-screen generic loader. */
export type SkeletonVariant =
  | "dashboard" | "exams" | "table" | "stats-table" | "cards" | "list"
  | "form" | "detail" | "chart" | "calendar" | "exam-session" | "lines";

const Stat = () => (
  <div className="card shadow-none flex items-center gap-3 p-4">
    <Skeleton className="h-11 w-11 shrink-0 rounded-xl" />
    <div className="flex-1"><Skeleton className="h-5 w-16" /><Skeleton className="mt-2 h-3 w-24" /></div>
  </div>
);
const Stats = ({ n = 4 }: { n?: number }) => (
  <div className={n === 3 ? "grid grid-cols-1 gap-3 sm:grid-cols-3" : "grid grid-cols-2 gap-3 lg:grid-cols-4"}>
    {Array.from({ length: n }).map((_, i) => <Stat key={i} />)}
  </div>
);
const Toolbar = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Skeleton className="h-10 min-w-[220px] flex-1 rounded-full" />
    <Skeleton className="h-10 w-28 rounded-full" />
    <Skeleton className="h-10 w-28 rounded-full" />
  </div>
);
const Panel = ({ h = "h-56", title = true }: { h?: string; title?: boolean }) => (
  <div className="card shadow-none p-5">
    {title && <><Skeleton className="h-4 w-40" /><Skeleton className="mt-2 h-3 w-56" /></>}
    <Skeleton className={`mt-4 w-full rounded-xl ${h}`} />
  </div>
);
const Row = () => (
  <div className="card shadow-none flex items-center gap-3 p-4">
    <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
    <div className="min-w-0 flex-1"><Skeleton className="h-4 w-1/3" /><Skeleton className="mt-2 h-3 w-2/3" /></div>
    <Skeleton className="hidden h-6 w-20 rounded-full sm:block" />
  </div>
);

function Body({ variant }: { variant: SkeletonVariant }) {
  switch (variant) {
    case "dashboard": // the student dashboard: glance cards, performance + activity, carousel, lists, right rail
      return (
        <div className="grid grid-cols-1 gap-5 min-[1200px]:grid-cols-[1fr_320px]">
          <div className="min-w-0 space-y-5">
            <Stats n={3} />
            <Skeleton className="h-[68px] w-full rounded-[22px]" />
            <div className="grid grid-cols-1 gap-4 min-[1024px]:grid-cols-[1fr_1.6fr]">
              <div className="card shadow-none flex flex-col items-center p-5"><Skeleton className="h-4 w-28 self-start" /><Skeleton className="mt-6 h-36 w-36 rounded-full" /></div>
              <Panel h="h-44" />
            </div>
            <div className="card shadow-none p-5">
              <Skeleton className="h-4 w-32" />
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => <div key={i}><Skeleton className="h-28 w-full rounded-xl" /><Skeleton className="mt-3 h-4 w-3/4" /><Skeleton className="mt-2 h-3 w-1/2" /></div>)}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="card shadow-none space-y-3 p-5"><Skeleton className="h-4 w-24" />{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}</div>
              <div className="card shadow-none space-y-3 p-5"><Skeleton className="h-4 w-28" />{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}</div>
            </div>
          </div>
          <div className="space-y-5">
            <div className="card shadow-none p-5"><Skeleton className="h-4 w-24" /><div className="mt-4 grid grid-cols-7 gap-2">{Array.from({ length: 35 }).map((_, i) => <Skeleton key={i} className="h-6 w-6 rounded-full" />)}</div></div>
            <div className="card shadow-none space-y-3 p-5"><Skeleton className="h-4 w-32" />{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}</div>
          </div>
        </div>
      );
    case "exams": // exam list on the left, exam detail on the right
      return (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div>
            <div className="mb-3 flex items-center justify-between"><Skeleton className="h-5 w-32" /><Skeleton className="h-8 w-24 rounded-lg" /></div>
            <div className="space-y-2.5">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[92px] w-full rounded-xl" />)}</div>
          </div>
          <div className="card shadow-none p-6">
            <div className="flex items-center justify-between"><Skeleton className="h-6 w-28 rounded-full" /><Skeleton className="h-12 w-56 rounded-lg" /></div>
            <Skeleton className="mt-6 h-3 w-32" /><Skeleton className="mt-3 h-8 w-3/4" /><Skeleton className="mt-3 h-4 w-2/3" />
            <div className="mt-6 flex gap-3"><Skeleton className="h-11 w-44 rounded-lg" /><Skeleton className="h-11 w-44 rounded-lg" /></div>
            <div className="mt-6 grid gap-4 lg:grid-cols-[1.4fr_1fr]"><Skeleton className="h-40 rounded-xl" /><Skeleton className="h-40 rounded-xl" /></div>
          </div>
        </div>
      );
    case "lines": // compact placeholder for a small card / section that is still loading
      return <div className="space-y-2.5"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-5/6" /><Skeleton className="h-4 w-2/3" /></div>;
    case "table":
      return <div className="space-y-4"><Toolbar /><div className="card shadow-none overflow-hidden"><TableSkeleton rows={8} cells={5} /></div></div>;
    case "stats-table":
      return <div className="space-y-5"><Stats /><Toolbar /><div className="card shadow-none overflow-hidden"><TableSkeleton rows={6} cells={5} /></div></div>;
    case "cards":
      return (
        <div className="space-y-4">
          <Toolbar />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="card shadow-none p-4">
                <div className="flex items-start justify-between"><Skeleton className="h-10 w-10 rounded-xl" /><Skeleton className="h-5 w-16 rounded-full" /></div>
                <Skeleton className="mt-4 h-4 w-3/4" /><Skeleton className="mt-2 h-3 w-full" /><Skeleton className="mt-1.5 h-3 w-2/3" />
                <div className="mt-4 flex gap-4 border-t border-[var(--border)] pt-3"><Skeleton className="h-3 w-20" /><Skeleton className="h-3 w-16" /></div>
              </div>
            ))}
          </div>
        </div>
      );
    case "list":
      return <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <Row key={i} />)}</div>;
    case "form":
      return (
        <div className="card shadow-none max-w-3xl space-y-5 p-6">
          {Array.from({ length: 5 }).map((_, i) => <div key={i}><Skeleton className="h-3 w-28" /><Skeleton className="mt-2 h-11 w-full rounded-lg" /></div>)}
          <Skeleton className="h-10 w-32 rounded-lg" />
        </div>
      );
    case "detail":
      return (
        <div className="space-y-5">
          <Skeleton className="h-4 w-24" />
          <div className="card shadow-none flex items-center gap-4 p-6"><Skeleton className="h-14 w-14 rounded-xl" /><div className="flex-1"><Skeleton className="h-6 w-56" /><Skeleton className="mt-2 h-3 w-40" /></div></div>
          <Stats n={3} />
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.6fr_1fr]">
            <div className="card shadow-none space-y-3 p-5"><Skeleton className="h-4 w-40" />{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}</div>
            <Panel h="h-48" />
          </div>
        </div>
      );
    case "chart":
      return (
        <div className="space-y-5">
          <Stats />
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2"><Panel /><Panel /></div>
          <div className="card shadow-none overflow-hidden"><TableSkeleton rows={4} cells={4} /></div>
        </div>
      );
    case "calendar":
      return (
        <div className="card shadow-none p-5">
          <div className="flex items-center justify-between"><Skeleton className="h-6 w-40" /><div className="flex gap-2"><Skeleton className="h-9 w-9 rounded-lg" /><Skeleton className="h-9 w-9 rounded-lg" /></div></div>
          <div className="mt-5 grid grid-cols-7 gap-2">
            {Array.from({ length: 7 }).map((_, i) => <Skeleton key={`h${i}`} className="h-4 w-full" />)}
            {Array.from({ length: 35 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}
          </div>
        </div>
      );
    case "exam-session": // top bar, question card, question palette
      return (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_280px]">
          <div className="space-y-4">
            <div className="flex items-center justify-between"><Skeleton className="h-6 w-56" /><Skeleton className="h-9 w-28 rounded-lg" /></div>
            <div className="card shadow-none space-y-4 p-6">
              <Skeleton className="h-3 w-24" /><Skeleton className="h-6 w-5/6" /><Skeleton className="h-6 w-2/3" />
              <div className="space-y-3 pt-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}</div>
            </div>
            <div className="flex justify-between"><Skeleton className="h-10 w-28 rounded-lg" /><Skeleton className="h-10 w-28 rounded-lg" /></div>
          </div>
          <div className="card shadow-none p-5"><Skeleton className="h-4 w-28" /><div className="mt-4 grid grid-cols-5 gap-2">{Array.from({ length: 20 }).map((_, i) => <Skeleton key={i} className="h-9 w-9 rounded-lg" />)}</div></div>
        </div>
      );
  }
}

export function ContentSkeleton({ variant, className }: { variant: SkeletonVariant; className?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className={className ?? "mt-2"}>
      <Body variant={variant} />
    </div>
  );
}

/** Which skeleton a route should show while its page chunk loads — by URL. */
export function skeletonForPath(pathname: string): SkeletonVariant {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === "/dashboard") return "dashboard";
  if (p === "/exams") return "exams";
  if (/^\/attempts\/[^/]+\/session$/.test(p)) return "exam-session";
  if (/^\/(attempts\/[^/]+\/result|exams\/[^/]+\/checkin|admin\/attempts\/[^/]+|admin\/students\/[^/]+|admin\/classes\/[^/]+|admin\/reliability\/incidents\/[^/]+|admin\/exams\/[^/]+\/(analysis|similarity))$/.test(p)) return "detail";
  if (/^\/(calendar|admin\/calendar|timetable)$/.test(p)) return "calendar";
  if (/^\/(library|learning-materials|practice|certificates|admin\/library|admin\/exams-library|admin\/exams|admin\/classes|admin\/integrations|admin\/reports|admin\/system-health)$/.test(p)) return "cards";
  if (/^\/(inbox|announcements|chat|admin\/inbox|admin\/communication|admin\/grading|admin\/scheduler|admin\/roles)$/.test(p)) return "list";
  if (/^\/(profile|admin\/settings|admin\/account|admin\/organization)$/.test(p)) return "form";
  if (/^\/admin\/(dashboard|analytics|reliability|integrity|live)$/.test(p)) return "chart";
  if (/^\/admin\/(candidates|students|attendance|results|regrades|violations|audit-logs|team|certificates|support)$/.test(p) || p === "/results" || p === "/attendance") return "stats-table";
  return "table";
}
