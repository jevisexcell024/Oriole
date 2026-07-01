import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Clock, Loader2, CheckCircle2, XCircle, ShieldCheck, MonitorCheck, Play,
  CalendarClock, Filter, Hourglass, ListChecks, Eye, BookOpen, Dumbbell, History, Award,
  User, Camera, Mic, Wifi, Globe, BadgeCheck,
} from "lucide-react";
import { Shell } from "@/components/Shell";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import type { ExamListItem } from "@shared/types";
import { clsx } from "clsx";

const pad2 = (n: number) => String(n).padStart(2, "0");

function opensAtMs(ex: { availableFrom?: string | null }, scheduledStart?: string | null) {
  let m: number | null = null;
  for (const iso of [ex.availableFrom, scheduledStart]) {
    if (!iso) continue;
    const t = new Date(iso).getTime();
    if (m === null || t > m) m = t;
  }
  return m;
}
function durationFmt(min: number) {
  const h = Math.floor(min / 60), m = min % 60;
  if (h && m) return `${h} Hour${h > 1 ? "s" : ""} ${m} Min${m > 1 ? "s" : ""}`;
  if (h) return `${h} Hour${h > 1 ? "s" : ""}`;
  return `${m} Min${m > 1 ? "s" : ""}`;
}
function relFuture(ms: number, now: number) {
  const d = ms - now;
  if (d <= 0) return "Available now";
  const mins = Math.ceil(d / 60000), h = d / 3600000, days = h / 24;
  if (h < 1) return `Starts in ${mins} min`;
  if (h < 24) return `Starts in ${Math.round(h)} hours`;
  if (days < 2) return `Tomorrow, ${new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

type StatusKey = "ready" | "upcoming" | "scheduled" | "in_progress" | "completed" | "closed";
function statusOf(it: ExamListItem, now: number): { key: StatusKey; label: string; cls: string } {
  const { registration: r, exam: ex, attempt } = it;
  if (attempt?.status === "submitted") return { key: "completed", label: "COMPLETED", cls: "bg-violet-500/15 text-violet-400" };
  if (attempt?.status === "in_progress") return { key: "in_progress", label: "IN PROGRESS", cls: "bg-blue-500/15 text-blue-400" };
  const closes = ex.availableUntil ? new Date(ex.availableUntil).getTime() : null;
  if (closes && now > closes) return { key: "closed", label: "CLOSED", cls: "bg-[var(--card-2)] text-[var(--muted)]" };
  if (r.approval !== "confirmed") return { key: "scheduled", label: "SCHEDULED", cls: "bg-[var(--card-2)] text-[var(--muted)]" };
  const opens = opensAtMs(ex, r.scheduledStart);
  if (opens && now < opens) return { key: "upcoming", label: "UPCOMING", cls: "bg-violet-500/15 text-violet-400" };
  return { key: "ready", label: "READY", cls: "bg-emerald-500/15 text-emerald-500" };
}

export function Exams() {
  const t = useT();
  const { user } = useAuth();
  const [items, setItems] = useState<ExamListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "ready" | "upcoming" | "completed">("all");
  const [tab, setTab] = useState("overview");
  const [now, setNow] = useState(() => Date.now());
  const [perm, setPerm] = useState<{ camera?: string; microphone?: string }>({});

  useEffect(() => {
    api.get<{ items: ExamListItem[] }>("/exams").then((d) => { setItems(d.items); setSelId((s) => s ?? d.items[0]?.registration.id ?? null); }).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  useEffect(() => {
    const q = (navigator as Navigator & { permissions?: { query: (d: { name: string }) => Promise<{ state: string }> } }).permissions;
    if (!q) return;
    (["camera", "microphone"] as const).forEach((name) => {
      q.query({ name }).then((p) => setPerm((s) => ({ ...s, [name]: p.state }))).catch(() => {});
    });
  }, []);

  const filtered = useMemo(() => {
    if (!items) return [];
    return items.filter((it) => {
      if (filter === "all") return true;
      const s = statusOf(it, now).key;
      if (filter === "completed") return s === "completed";
      if (filter === "ready") return s === "ready" || s === "in_progress";
      if (filter === "upcoming") return s === "upcoming" || s === "scheduled";
      return true;
    });
  }, [items, filter, now]);

  const selected = useMemo(() => items?.find((it) => it.registration.id === selId) ?? filtered[0] ?? items?.[0] ?? null, [items, selId, filtered]);

  return (
    <Shell>
      <div className="fade-in">
        {error && <p className="text-sm text-rose-400">{error}</p>}
        {!items && !error && <div className="flex items-center gap-2 py-16 text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> Loading exams…</div>}

        {items && items.length === 0 && (
          <div className="card mt-2 rounded-2xl p-12 text-center text-sm text-[var(--muted)]">You have no exams assigned yet.</div>
        )}

        {items && items.length > 0 && (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
            {/* ───── List column ───── */}
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-bold">Upcoming Exams</h2>
                <div className="relative inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1.5 text-xs font-semibold text-[var(--muted)]">
                  <Filter className="h-3.5 w-3.5" />
                  <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="cursor-pointer bg-transparent pr-1 outline-none">
                    <option value="all">{t("exams.all")}</option>
                    <option value="ready">{t("exams.ready")}</option>
                    <option value="upcoming">{t("exams.upcoming")}</option>
                    <option value="completed">{t("exams.completed")}</option>
                  </select>
                </div>
              </div>
              <div className="space-y-2.5">
                {filtered.length === 0 && <p className="card rounded-xl p-5 text-center text-xs text-[var(--muted)]">{t("exams.noMatch")}</p>}
                {filtered.map((it) => {
                  const s = statusOf(it, now);
                  const opens = opensAtMs(it.exam, it.registration.scheduledStart);
                  const active = it.registration.id === selected?.registration.id;
                  const sub = s.key === "completed" ? `Scored ${it.attempt?.score ?? 0}%`
                    : s.key === "in_progress" ? "In progress — resume"
                    : s.key === "closed" ? "Window closed"
                    : s.key === "scheduled" ? "Awaiting confirmation"
                    : opens && now < opens ? relFuture(opens, now) : "Available now";
                  return (
                    <button key={it.registration.id} onClick={() => setSelId(it.registration.id)}
                      className={clsx("w-full rounded-xl border p-3.5 text-left transition", active ? "border-[#c6ff34] bg-[var(--card)] shadow-sm ring-1 ring-[#c6ff34]/30" : "border-[var(--border)] bg-[var(--card)] hover:border-[var(--border-strong)]")}>
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">{it.exam.code || "EXAM"}</p>
                        <span className={clsx("rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide", s.cls)}>{s.label}</span>
                      </div>
                      <p className="mt-1 truncate font-semibold leading-snug">{it.exam.title}</p>
                      <div className="mt-2 flex items-center gap-3 text-[11px] text-[var(--muted)]">
                        <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> {durationFmt(it.exam.durationMinutes)}</span>
                        <span className="inline-flex items-center gap-1"><CalendarClock className="h-3 w-3" /> {sub}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ───── Detail column ───── */}
            {selected && <ExamDetail it={selected} now={now} user={user} perm={perm} tab={tab} setTab={setTab} />}
          </div>
        )}
      </div>
    </Shell>
  );
}

function ExamDetail({ it, now, user, perm, tab, setTab }: {
  it: ExamListItem; now: number; user: ReturnType<typeof useAuth>["user"];
  perm: { camera?: string; microphone?: string }; tab: string; setTab: (t: string) => void;
}) {
  const t = useT();
  const { registration: r, exam: ex, attempt } = it;
  const s = statusOf(it, now);
  const proctored = ex.proctored;
  const ld = ex.lockdown;
  const opens = opensAtMs(ex, r.scheduledStart);
  const closes = ex.availableUntil ? new Date(ex.availableUntil).getTime() : null;
  const isOpen = (!opens || now >= opens) && !(closes && now > closes) && r.approval === "confirmed";
  const target = opens && now < opens ? opens : (isOpen && closes ? closes : null);
  const countdownLabel = opens && now < opens ? "Starts in" : (isOpen && closes ? "Closes in" : "");
  const diff = target ? Math.max(0, target - now) : 0;
  const cd = { d: Math.floor(diff / 86400000), h: Math.floor(diff / 3600000) % 24, m: Math.floor(diff / 60000) % 60, s: Math.floor(diff / 1000) % 60 };

  const browserOk = typeof navigator !== "undefined" && !!navigator.mediaDevices && !!document.documentElement.requestFullscreen;
  const ready: { label: string; ok: boolean; icon: typeof User }[] = [
    { label: "Profile completed", ok: !!user, icon: User },
    { label: "Internet connection", ok: typeof navigator === "undefined" ? true : navigator.onLine, icon: Wifi },
    { label: "Browser compatible", ok: browserOk, icon: Globe },
    ...(proctored ? [
      { label: "Camera permission", ok: perm.camera === "granted", icon: Camera },
      { label: "Microphone permission", ok: perm.microphone === "granted", icon: Mic },
    ] : []),
    { label: r.approval === "confirmed" ? "Identity verified" : "Registration", ok: r.approval === "confirmed", icon: BadgeCheck },
  ];
  const readyPassed = ready.filter((x) => x.ok).length;

  const checkinTo = `/exams/${r.id}/checkin`;
  const done = attempt?.status === "submitted";
  const inProgress = attempt?.status === "in_progress";

  const TABS = ["overview", "instructions", "requirements", "proctoring", "resources"] as const;
  const TAB_LABEL: Record<string, string> = { overview: "Overview", instructions: "Instructions", requirements: "Requirements", proctoring: "Proctoring Rules", resources: "Resources" };

  return (
    <div className="card rounded-2xl p-6">
      {/* Header row: availability + countdown */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", s.cls)}>
          <span className="h-1.5 w-1.5 rounded-full bg-current" /> {isOpen ? "Available Now" : s.label === "READY" ? "Ready" : s.label.charAt(0) + s.label.slice(1).toLowerCase()}
        </span>
        {target && (
          <div className="flex items-center gap-1.5">
            {([["DAYS", cd.d], ["HRS", cd.h], ["MIN", cd.m], ["SEC", cd.s]] as const).map(([lbl, val], i) => (
              <div key={lbl} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-[var(--muted)]">:</span>}
                <div className="rounded-lg bg-[var(--card-2)] px-2 py-1 text-center">
                  <p className="text-base font-bold tabular-nums leading-none">{pad2(val)}</p>
                  <p className="mt-0.5 text-[8px] font-medium tracking-wide text-[var(--muted)]">{lbl}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Title */}
      <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{ex.code} · {countdownLabel === "Starts in" ? "Scheduled Examination" : "Final Examination"}</p>
      <h1 className="mt-1 text-3xl font-extrabold tracking-tight">{ex.title}</h1>
      <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">{ex.description || "Ensure your environment meets all requirements before starting."}</p>

      {/* Primary actions */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        {done ? (
          <Link to={`/attempts/${attempt!.id}/result`} className="btn btn-primary h-11 px-5"><Award className="h-4 w-4" /> {t("exams.viewResults")}</Link>
        ) : inProgress ? (
          <Link to={`/attempts/${attempt!.id}/session`} className="btn btn-primary h-11 px-5"><Play className="h-4 w-4" /> Resume Examination</Link>
        ) : r.approval !== "confirmed" ? (
          <span className="btn h-11 cursor-not-allowed px-5 opacity-60" style={{ background: "var(--card-2)", color: "var(--muted)" }}><Hourglass className="h-4 w-4" /> Awaiting confirmation</span>
        ) : !isOpen ? (
          <>
            <span className="btn h-11 cursor-not-allowed px-5 opacity-60" style={{ background: "var(--card-2)", color: "var(--muted)" }}><Hourglass className="h-4 w-4" /> {opens ? relFuture(opens, now) : "Not available"}</span>
            <Link to={checkinTo} className="btn btn-outline h-11 px-5"><MonitorCheck className="h-4 w-4" /> Run System Check</Link>
          </>
        ) : (
          <>
            <Link to={checkinTo} className="btn btn-primary h-11 px-5"><Play className="h-4 w-4" /> Start Examination</Link>
            <Link to={checkinTo} className="btn btn-outline h-11 px-5"><MonitorCheck className="h-4 w-4" /> Run System Check</Link>
          </>
        )}
      </div>

      {/* Readiness + info */}
      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="rounded-xl border border-[var(--border)] p-4">
          <div className="flex items-center justify-between">
            <p className="inline-flex items-center gap-1.5 text-sm font-bold"><ShieldCheck className="h-4 w-4 text-[#c6ff34]" /> Readiness Center</p>
            <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-semibold", readyPassed === ready.length ? "bg-emerald-500/15 text-emerald-500" : "bg-amber-500/15 text-amber-500")}>{readyPassed} / {ready.length} Passed</span>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
            {ready.map((x) => (
              <div key={x.label} className="flex items-center gap-2 text-sm">
                {x.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> : <XCircle className="h-4 w-4 shrink-0 text-[var(--muted)]" />}
                <span className={x.ok ? "" : "text-[var(--muted)]"}>{x.label}</span>
              </div>
            ))}
          </div>
          {readyPassed < ready.length && proctored && (
            <p className="mt-3 text-[11px] text-[var(--muted)]">Run the system check to grant camera/microphone access and complete the remaining items.</p>
          )}
        </div>

        <div className="rounded-xl border border-[var(--border)] p-4">
          <Info icon={Hourglass} label="Duration" value={durationFmt(ex.durationMinutes)} />
          <Info icon={ListChecks} label="Pass mark" value={`${ex.passingScore}% to pass`} />
          <Info icon={Eye} label="Proctoring" value={proctored ? (ld?.faceMonitoring ? "AI + Face monitoring" : "AI proctored") : "Not proctored"} last />
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-6 flex gap-5 border-b border-[var(--border)] text-sm">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={clsx("relative -mb-px border-b-2 pb-2.5 font-semibold transition", tab === t ? "border-[#c6ff34] text-[var(--fg)]" : "border-transparent text-[var(--muted)] hover:text-[var(--fg)]")}>
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>
      <div className="mt-4 text-sm text-[var(--muted)]">
        {tab === "overview" && (
          <div className="space-y-3">
            <p>{ex.description || "This examination evaluates your understanding of the course material. Make sure your environment meets all requirements before you begin."}</p>
            <p>You may navigate freely between questions, but the timer cannot be paused once the exam has started. Your work is saved automatically as you go.</p>
          </div>
        )}
        {tab === "instructions" && (
          <ul className="list-disc space-y-1.5 pl-5">
            <li>You have <span className="font-semibold text-[var(--fg)]">{durationFmt(ex.durationMinutes)}</span> to complete this exam once you start.</li>
            <li>A score of <span className="font-semibold text-[var(--fg)]">{ex.passingScore}%</span> or higher is required to pass.</li>
            <li>The timer starts the moment you begin and cannot be paused.</li>
            <li>Answers are saved automatically; you can revisit questions until you submit.</li>
            {proctored && <li>Stay in fullscreen with your face clearly visible throughout the exam.</li>}
          </ul>
        )}
        {tab === "requirements" && (
          <ul className="space-y-1.5">
            <li className="flex items-center gap-2"><Globe className="h-4 w-4 text-[var(--muted)]" /> A supported, up-to-date browser (Chrome, Edge or Firefox).</li>
            <li className="flex items-center gap-2"><Wifi className="h-4 w-4 text-[var(--muted)]" /> A stable internet connection for the full duration.</li>
            {proctored && <li className="flex items-center gap-2"><Camera className="h-4 w-4 text-[var(--muted)]" /> A working webcam and microphone.</li>}
            {proctored && (ld?.requireIdentity) && <li className="flex items-center gap-2"><BadgeCheck className="h-4 w-4 text-[var(--muted)]" /> Your student ID / registration number for identity verification.</li>}
            {ld?.requireSafeExamBrowser && <li className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[var(--muted)]" /> Safe Exam Browser installed (Windows, macOS or iPad).</li>}
          </ul>
        )}
        {tab === "proctoring" && (
          proctored ? (
            <ul className="space-y-1.5">
              {ld?.fullscreen && <li>• Fullscreen is enforced; exiting it is flagged.</li>}
              {ld?.blockCopyPaste && <li>• Copy, paste and text selection are disabled.</li>}
              {ld?.blockShortcuts && <li>• Risky keyboard shortcuts are blocked.</li>}
              {ld?.tabSwitchDetection && <li>• Switching tabs, apps or desktops is detected and logged.</li>}
              {ld?.webcam && <li>• Your webcam feed is recorded and monitored.</li>}
              {ld?.faceMonitoring && <li>• Continuous face-presence checks run during the exam.</li>}
              <li>• Screenshot / screen-capture attempts are blocked and logged.</li>
              {(ld?.violationLimit ?? 0) > 0
                ? <li>• The exam auto-submits after {ld?.violationLimit} integrity violations.</li>
                : <li className="font-medium text-rose-400">• Zero tolerance — any violation submits your exam immediately.</li>}
            </ul>
          ) : <p>This exam is <span className="font-semibold text-[var(--fg)]">not proctored</span> — no camera, microphone or lockdown is required.</p>
        )}
        {tab === "resources" && (
          <div className="space-y-3">
            {ex.resources && ex.resources.length > 0 && (
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {ex.resources.map((r, i) => (
                  <a key={i} href={r.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-xl border border-[var(--border)] p-3 text-sm font-semibold text-[var(--fg)] hover:bg-[var(--card-2)]"><Globe className="h-4 w-4 shrink-0 text-[#c6ff34]" /> <span className="truncate">{r.label || r.url}</span></a>
                ))}
              </div>
            )}
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <Link to="/practice" className="flex items-center gap-2 rounded-xl border border-[var(--border)] p-3 text-sm font-semibold text-[var(--fg)] hover:bg-[var(--card-2)]"><Dumbbell className="h-4 w-4 text-[#c6ff34]" /> Practice Tests</Link>
              <Link to="/results" className="flex items-center gap-2 rounded-xl border border-[var(--border)] p-3 text-sm font-semibold text-[var(--fg)] hover:bg-[var(--card-2)]"><History className="h-4 w-4 text-[#c6ff34]" /> Past Results</Link>
              <Link to="/announcements" className="flex items-center gap-2 rounded-xl border border-[var(--border)] p-3 text-sm font-semibold text-[var(--fg)] hover:bg-[var(--card-2)]"><BookOpen className="h-4 w-4 text-[#c6ff34]" /> Announcements</Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Info({ icon: Icon, label, value, last }: { icon: typeof User; label: string; value: string; last?: boolean }) {
  return (
    <div className={clsx("flex items-center gap-3 py-2", !last && "border-b border-[var(--border)]")}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: "rgba(198,255,52,0.14)", color: "#c6ff34" }}><Icon className="h-4 w-4" /></span>
      <div>
        <p className="text-[11px] uppercase tracking-wide text-[var(--muted)]">{label}</p>
        <p className="text-sm font-semibold text-[var(--fg)]">{value}</p>
      </div>
    </div>
  );
}
