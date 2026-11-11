import { useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  Loader2, Dumbbell, Play, FileText, Clock, Search, Target, TrendingUp, RotateCcw,
  Flame, History as HistoryIcon, ListChecks, ChevronLeft, ChevronRight, BookOpen,
} from "lucide-react";
import { Shell } from "@/components/Shell";
import { Skeleton, EmptyState, ErrorBanner } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { clsx } from "clsx";

interface Item {
  exam: { id: string; title: string; code: string; description: string; subject: string | null; durationMinutes: number; questionCount: number };
  registrationId: string;
  lastScore: number | null;
  inProgress: boolean;
  inProgressPct: number | null;
}
interface HistoryEntry {
  id: string; examTitle: string; score: number | null; passed: boolean | null; submittedAt: string; durationMinutes: number;
}

type StatusFilter = "all" | "notStarted" | "inProgress" | "completed";
const TABS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All practice" },
  { key: "notStarted", label: "Not started" },
  { key: "inProgress", label: "In progress" },
  { key: "completed", label: "Completed" },
];
const PAGE_SIZE = 6;
const matchesTab = (it: Item, k: StatusFilter) =>
  k === "all" || (k === "completed" && it.lastScore !== null && !it.inProgress) || (k === "inProgress" && it.inProgress) || (k === "notStarted" && it.lastScore === null && !it.inProgress);

function InfoTile({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <div className="min-w-0 flex-1 rounded-xl bg-[var(--card-2)] px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[11px] text-[var(--muted)]"><Icon className="h-3.5 w-3.5 shrink-0" /> {label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-[var(--fg)]">{value}</p>
    </div>
  );
}

const LIME = "var(--color-brand-500)";
// Lime as text/icon colour: deeper olive in light mode (see --lime-text in index.css).
const LIME_TEXT = "var(--lime-text)";

function ProgressRing({ done, total }: { done: number; total: number }) {
  const r = 52, c = 2 * Math.PI * r;
  const dash = total ? (done / total) * c : 0;
  return (
    <div className="relative h-[128px] w-[128px] shrink-0">
      <svg width="128" height="128" viewBox="0 0 128 128">
        <circle cx="64" cy="64" r={r} fill="none" stroke="var(--card-2)" strokeWidth="8" />
        {dash > 0 && (
          <circle cx="64" cy="64" r={r} fill="none" stroke={LIME} strokeWidth="8" strokeLinecap="round"
            strokeDasharray={`${dash} ${c - dash}`} transform="rotate(-90 64 64)" />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold leading-none text-[var(--fg)]">{done}/{total}</span>
        <span className="mt-1 text-[11px] text-[var(--muted)]">completed</span>
      </div>
    </div>
  );
}

function HeroStat({ icon: Icon, label, value }: { icon: typeof Dumbbell; label: string; value: string | number }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[11px] text-[var(--muted)]"><Icon className="h-3.5 w-3.5" /> {label}</p>
      <p className="mt-1 text-xl font-bold leading-none text-[var(--fg)]">{value}</p>
    </div>
  );
}

function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  const m = s / 60; if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60; if (h < 24) return `${Math.floor(h)}h ago`;
  const d = h / 24; return `${Math.floor(d)}d ago`;
}

export function PracticeTests() {
  const t = useT();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [items, setItems] = useState<Item[] | null>(null);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [streak, setStreak] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [subject, setSubject] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [status, subject, search]);

  useEffect(() => {
    api.get<{ items: Item[]; history: HistoryEntry[]; streak: number }>("/practice")
      .then((d) => { setItems(d.items); setHistory(d.history); setStreak(d.streak); })
      .catch((e) => setError(e.message));
  }, []);

  async function start(registrationId: string) {
    setStarting(registrationId); setError(null);
    try {
      const r = await api.post<{ attempt: { id: string } }>("/attempts", { registrationId });
      navigate(`/attempts/${r.attempt.id}/session`);
    } catch (e) { setError((e as Error).message); setStarting(null); }
  }

  // Real subjects only — whatever's actually tagged on this school's practice
  // exams, not a fixed example list (subjects vary by institution).
  const subjects = useMemo(() => {
    const rows = new Map<string, { total: number; done: number }>();
    for (const it of items ?? []) {
      if (!it.exam.subject) continue;
      const r = rows.get(it.exam.subject) ?? { total: 0, done: 0 };
      r.total += 1;
      if (it.lastScore !== null) r.done += 1;
      rows.set(it.exam.subject, r);
    }
    return [...rows.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, r]) => ({ name, ...r }));
  }, [items]);

  const continueItem = useMemo(() => (items ?? []).find((it) => it.inProgress) ?? null, [items]);
  const nextNotStarted = useMemo(() => (items ?? []).find((it) => !it.inProgress && it.lastScore === null) ?? null, [items]);
  // What the hero's main button picks up: the one in progress, else the next unstarted, else the first (a retake).
  const focus = continueItem ?? nextNotStarted ?? (items ?? [])[0] ?? null;

  const completedCount = useMemo(() => (items ?? []).filter((it) => it.lastScore !== null).length, [items]);
  const avgScore = useMemo(() => {
    const scored = (items ?? []).filter((it) => it.lastScore !== null);
    if (scored.length === 0) return null;
    return Math.round(scored.reduce((s, it) => s + it.lastScore!, 0) / scored.length);
  }, [items]);
  const totalQuestions = useMemo(() => (items ?? []).reduce((s, it) => s + it.exam.questionCount, 0), [items]);

  const filtered = useMemo(() => {
    let list = items ?? [];
    if (subject) list = list.filter((it) => it.exam.subject === subject);
    list = list.filter((it) => matchesTab(it, status));
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((it) => it.exam.title.toLowerCase().includes(q) || it.exam.code.toLowerCase().includes(q) || (it.exam.subject ?? "").toLowerCase().includes(q));
    return list;
  }, [items, subject, status, search]);

  // Tab counts respect the subject filter, so they match what each tab would show.
  const tabCounts = useMemo(() => {
    const base = (items ?? []).filter((it) => !subject || it.exam.subject === subject);
    return Object.fromEntries(TABS.map((tb) => [tb.key, base.filter((it) => matchesTab(it, tb.key)).length])) as Record<StatusFilter, number>;
  }, [items, subject]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const cur = Math.min(page, pages);
  const visible = filtered.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE);

  const firstName = (user?.name ?? "there").split(" ")[0];

  return (
    <Shell>
      <div className="fade-in">
        {error && <ErrorBanner>{error}</ErrorBanner>}

        {!items && !error && (
          <div className="mt-4 space-y-4">
            <Skeleton className="h-[190px] rounded-[20px]" />
            <Skeleton className="h-9 w-full rounded-lg" />
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[92px] rounded-[16px]" />)}
          </div>
        )}

        {items && items.length === 0 && (
          <EmptyState className="mt-6" icon={Dumbbell} title={t("prac.none")} hint={t("prac.noneHint")} />
        )}

        {items && items.length > 0 && (
          <>
            {/* Hero: progress ring, greeting + what to pick up next, headline numbers */}
            <div className="card flex flex-wrap items-center gap-x-8 gap-y-6 !shadow-none" style={{ borderRadius: 20, padding: "28px 32px" }}>
              <ProgressRing done={completedCount} total={items.length} />
              <div className="min-w-[240px] flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: LIME_TEXT }}>Practice</p>
                <h2 className="mt-1 text-2xl font-bold text-[var(--fg)]">Ready to practice, {firstName}?</h2>
                {focus && (
                  <p className="mt-1.5 text-sm text-[var(--muted)]">
                    {continueItem ? "Pick up with" : nextNotStarted ? "Start with" : "Try again with"}{" "}
                    <span className="font-semibold text-[var(--fg)]">{focus.exam.title}</span>
                    {" "}— {t("prac.questions", { n: focus.exam.questionCount })}, about {focus.exam.durationMinutes} minutes.
                  </p>
                )}
                <div className="mt-4 flex flex-wrap gap-2.5">
                  {focus && (
                    <button onClick={() => start(focus.registrationId)} disabled={starting === focus.registrationId} className="btn btn-primary !shadow-none">
                      {starting === focus.registrationId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} {continueItem ? "Continue practice" : "Start practice"}
                    </button>
                  )}
                  <Link to="/results" className="btn btn-outline"><HistoryIcon className="h-4 w-4" /> Past results</Link>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-10 gap-y-5">
                <HeroStat icon={TrendingUp} label="Average score" value={avgScore !== null ? `${avgScore}%` : "—"} />
                <HeroStat icon={Flame} label="Streak" value={streak > 0 ? `${streak} day${streak === 1 ? "" : "s"}` : "—"} />
                <HeroStat icon={FileText} label="Questions" value={totalQuestions} />
                <HeroStat icon={HistoryIcon} label="Attempts" value={history?.length ?? 0} />
              </div>
            </div>

            <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
              {/* Practice exams */}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  {TABS.map((tb) => (
                    <button key={tb.key} onClick={() => setStatus(tb.key)}
                      className={clsx("inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition", status === tb.key ? "bg-[var(--card)] text-[var(--fg)]" : "text-[var(--muted)] hover:text-[var(--fg)]")}>
                      {tb.label}
                      <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-bold", status === tb.key ? "bg-brand-500 text-[var(--brand-ink)]" : "bg-[var(--card-2)]")}>{tabCounts[tb.key]}</span>
                    </button>
                  ))}
                </div>

                <div className="card mt-2 !shadow-none" style={{ borderRadius: 22, padding: 20 }}>
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="mr-auto text-lg font-bold text-[var(--fg)]">{subject ?? "Practice exams"}</h2>
                    <div className="relative min-w-[180px]">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted)]" />
                      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" className="input h-9 pl-9 text-xs" />
                    </div>
                  </div>

                  {filtered.length === 0 ? (
                    <EmptyState className="mt-4" icon={Target} title="No practice exams match" hint="Try a different search or filter." />
                  ) : (
                    <>
                      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                        {visible.map((it) => {
                          const pill = it.inProgress ? { text: "IN PROGRESS", cls: "bg-blue-500/15 text-blue-400" }
                            : it.lastScore !== null ? { text: "COMPLETED", cls: "bg-violet-500/15 text-violet-400" }
                            : { text: "NOT STARTED", cls: "bg-[var(--card-2)] text-[var(--muted)]" };
                          return (
                            <div key={it.exam.id} className="card flex flex-col !shadow-none" style={{ borderRadius: 18, padding: 16 }}>
                              <div className="flex items-center gap-2.5">
                                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--card-2)]" style={{ color: LIME_TEXT }}><BookOpen className="h-4.5 w-4.5" /></span>
                                <p className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--fg)]">{it.exam.code || "Practice"}</p>
                                <span className={clsx("shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold tracking-wide", pill.cls)}>{pill.text}</span>
                              </div>
                              <div className="mt-3 flex gap-2.5">
                                <InfoTile icon={ListChecks} label="Questions" value={String(it.exam.questionCount)} />
                                <InfoTile icon={Clock} label="Duration" value={`${it.exam.durationMinutes} ${t("exams.minutes")}`} />
                              </div>
                              <h3 className="mt-4 text-base font-bold leading-snug text-[var(--fg)]">{it.exam.title}</h3>
                              <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-sm text-[var(--muted)]">{it.exam.description}</p>
                              <p className="mt-2 h-4 text-xs font-semibold text-[var(--fg)]">
                                {it.inProgress ? `${it.inProgressPct ?? 0}% answered so far` : it.lastScore !== null ? `Last score ${it.lastScore}%` : ""}
                              </p>
                              <button onClick={() => start(it.registrationId)} disabled={starting === it.registrationId}
                                className={clsx("btn mt-4 h-10 w-full disabled:opacity-50", it.lastScore !== null && !it.inProgress ? "btn-outline" : "btn-primary !shadow-none")}>
                                {starting === it.registrationId ? <Loader2 className="h-4 w-4 animate-spin" /> : it.lastScore !== null && !it.inProgress ? <RotateCcw className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                                {it.inProgress ? "Continue" : it.lastScore !== null ? t("prac.retake") : t("prac.start")}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                      {pages > 1 && (
                        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                          <p className="text-xs text-[var(--muted)]">Showing {(cur - 1) * PAGE_SIZE + 1}–{Math.min(cur * PAGE_SIZE, filtered.length)} of {filtered.length}</p>
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => setPage(cur - 1)} disabled={cur === 1} aria-label="Previous page" className="btn btn-outline h-9 w-9 !p-0 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
                            {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
                              <button key={n} onClick={() => setPage(n)} aria-current={n === cur ? "page" : undefined}
                                className={clsx("h-9 min-w-9 rounded-md px-2 text-sm font-semibold transition", n === cur ? "bg-brand-500 text-[var(--brand-ink)]" : "text-[var(--muted)] hover:bg-[var(--card-2)] hover:text-[var(--fg)]")}>{n}</button>
                            ))}
                            <button onClick={() => setPage(cur + 1)} disabled={cur === pages} aria-label="Next page" className="btn btn-outline h-9 w-9 !p-0 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Subjects + recent activity */}
              <div className="space-y-8">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Subjects</p>
                  <div className="mt-3 space-y-2">
                    {[{ name: null as string | null, label: "All subjects", total: items.length, done: completedCount }, ...subjects.map((s) => ({ ...s, label: s.name as string }))].map((s) => (
                      <button key={s.label} onClick={() => setSubject(s.name)}
                        className={clsx("card block w-full text-left transition !shadow-none", subject === s.name ? "border-brand-500/60" : "hover:border-[var(--border-strong)]")}
                        style={{ borderRadius: 14, padding: "12px 14px" }}>
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="truncate font-semibold text-[var(--fg)]">{s.label}</span>
                          <span className="shrink-0 text-[11px] text-[var(--muted)]">{s.done}/{s.total} done</span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--card-2)]">
                          <div className="h-full rounded-full" style={{ width: `${s.total ? Math.round((s.done / s.total) * 100) : 0}%`, background: LIME }} />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {history && history.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Recent activity</p>
                    <div className="mt-3 divide-y divide-[var(--border)]">
                      {history.slice(0, 5).map((h) => (
                        <div key={h.id} className="flex items-center gap-3 py-2.5 text-sm">
                          <RotateCcw className="h-4 w-4 shrink-0 text-[var(--muted)]" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium text-[var(--fg)]">{h.examTitle}</p>
                            <p className="text-[11px] text-[var(--muted)]">{ago(h.submittedAt)}</p>
                          </div>
                          <span className="shrink-0 text-xs font-bold text-[var(--fg)]">{h.score ?? "—"}%</span>
                        </div>
                      ))}
                    </div>
                    <Link to="/results" className="mt-2 inline-block text-xs font-semibold text-[var(--lime-text)] hover:underline">View all results →</Link>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </Shell>
  );
}
