import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Clock, ShieldCheck, AlertTriangle, Loader2, Send, ChevronLeft, ChevronRight, CircleDot, Circle,
  Lock, Maximize, EyeOff, Flag, Check, CloudOff, CloudUpload, X, CheckSquare, Square,
  ChevronUp, ChevronDown, Upload, Pause as PauseIcon, MessageSquare, WifiOff,
} from "lucide-react";
import { api, sendBeaconJson } from "@/lib/api";
import { useProctoring } from "@/lib/proctoring";
import { useExamLockdown, type LockdownEvent } from "@/lib/lockdown";
import { useAnswerSync } from "@/lib/useAnswerSync";
import { CodeAnswer } from "@/components/CodeAnswer";
import { detectIncognito } from "@/lib/incognito";
import { MathText } from "@/lib/richtext";
import { useT } from "@/lib/i18n";
import type { Attempt, Exam, PublicQuestion } from "@shared/types";
import { clsx } from "clsx";

/** Parse a JSON-array answer value, padded to `len` slots. */
function arrAnswer(value: string, len: number): string[] {
  let a: string[] = [];
  try { const p = JSON.parse(value || "[]"); if (Array.isArray(p)) a = p.map((x) => (x == null ? "" : String(x))); } catch { /* ignore */ }
  return Array.from({ length: len }, (_, i) => a[i] ?? "");
}

interface LoadResp {
  attempt: Attempt;
  exam: Exam;
  questions: PublicQuestion[];
  answers: { questionId: string; value: string }[];
  deadlineAt: string; // server-authoritative hard close (ISO)
  serverNow: string;  // server clock at load (ISO) — anchors the countdown
  codeRunner?: boolean; // whether the code Run/Test feature is enabled server-side
}

export function Session() {
  const t = useT();
  const { attemptId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<LoadResp | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [idx, setIdx] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittedRef = useRef(false);

  const proctored = data?.exam.proctored ?? false;
  const ld = data?.exam.lockdown;
  const violationLimit = ld?.violationLimit ?? 0;

  const [violationCount, setViolationCount] = useState(0);
  const [integrity, setIntegrity] = useState(100);
  const [banner, setBanner] = useState<{ msg: string; level: "warn" | "crit" } | null>(null);
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const [proctorMsgs, setProctorMsgs] = useState<{ id: string; text: string; at: string }[]>([]);
  const [dismissedMsgs, setDismissedMsgs] = useState<Set<string>>(new Set());
  const [online, setOnline] = useState(() => typeof navigator !== "undefined" ? navigator.onLine : true);

  const sync = useAnswerSync(attemptId);

  const onEvent = useCallback((e: LockdownEvent) => {
    if (!attemptId) return;
    // Once a submission/termination has begun, the exam is over — ignore any
    // further flags. This prevents a false "Fullscreen Exit" (and similar
    // teardown artefacts) being recorded when WE call exitFullscreen() as part
    // of finishing the exam. Real in-exam flags are unaffected.
    if (submittedRef.current) return;
    // Beacon/keepalive delivery so a flag that triggers an immediate auto-submit
    // (and unmounts this page) is still recorded server-side rather than aborted.
    sendBeaconJson(`/attempts/${attemptId}/proctor-event`, e);
    if (e.severity === "info") return;
    setIntegrity((s) => Math.max(0, s - (e.severity === "high" ? 12 : 5)));
    setViolationCount((c) => c + 1);
  }, [attemptId]);

  const { videoRef, cameraReady, faceStatus } = useProctoring({ active: !!data && proctored && (ld?.webcam ?? true), onEvent, audioMonitoring: ld?.audioMonitoring });
  const lockdown = useExamLockdown({ active: !!data && proctored, onEvent, rules: ld });

  // Load attempt.
  useEffect(() => {
    api.get<LoadResp>(`/attempts/${attemptId}`)
      .then((d) => {
        if (d.attempt.status === "submitted") {
          navigate(`/attempts/${d.attempt.id}/result`, { replace: true });
          return;
        }
        setData(d);
        // Server answers, then any locally-buffered writes from a previous
        // session (crash/reload recovery) take precedence as the newer values.
        const persisted = sync.loadPersisted();
        setAnswers({ ...Object.fromEntries(d.answers.map((a) => [a.questionId, a.value])), ...persisted });
      })
      .catch((e) => setError(e.message));
    // sync's methods are useCallback-stable; depending on the object itself
    // would re-run this loader every render (a refetch loop), so it's omitted.
  }, [attemptId, navigate]);

  const submit = useCallback(async (auto = false) => {
    if (submittedRef.current || !attemptId) return;
    submittedRef.current = true;
    setSubmitting(true);
    try {
      // Make sure every buffered answer is persisted before we grade.
      await sync.flushNow();
      await api.post(`/attempts/${attemptId}/submit`);
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
      navigate(`/attempts/${attemptId}/result`, { replace: true, state: { auto } });
    } catch (e) {
      submittedRef.current = false;
      setError(e instanceof Error ? e.message : "Could not submit.");
      setSubmitting(false);
    }
  }, [attemptId, navigate]);

  // If the server reports the exam closed mid-save, finalize immediately.
  useEffect(() => { sync.onClosed(() => submit(true)); }, [submit]);

  // Track browser connectivity so we can block submit and show an offline banner.
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // Countdown anchored to the SERVER's clock and deadline, ticked with a
  // monotonic clock (performance.now) so changing the system clock can't extend
  // the time. The server also hard-closes overdue attempts independently.
  useEffect(() => {
    if (!data) return;
    const deadline = new Date(data.deadlineAt).getTime();
    const serverNow = new Date(data.serverNow).getTime();
    const perfBase = performance.now();
    const tick = () => {
      if (pausedRef.current) return; // frozen while a proctor has paused the attempt
      const elapsed = performance.now() - perfBase;
      const ms = deadline - (serverNow + elapsed);
      setRemaining(Math.max(0, Math.floor(ms / 1000)));
      if (ms <= 0) submit(true);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [data, submit]);

  // Poll the live proctor control channel: pause/resume, messages, and termination.
  useEffect(() => {
    if (!data || !attemptId) return;
    let alive = true;
    const poll = async () => {
      try {
        const c = await api.get<{ paused: boolean; terminated: boolean; terminationReason: string | null; messages: { id: string; text: string; at: string }[]; deadlineAt: string; serverNow: string }>(`/attempts/${attemptId}/control`);
        if (!alive) return;
        if (c.terminated && !submittedRef.current) {
          submittedRef.current = true;
          if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
          navigate(`/attempts/${attemptId}/result`, { replace: true, state: { terminated: true, reason: c.terminationReason } });
          return;
        }
        pausedRef.current = c.paused;
        setPaused(c.paused);
        setProctorMsgs(c.messages);
        // A pause/resume changes the deadline — refresh the countdown anchors when it does.
        setData((d) => (d && d.deadlineAt !== c.deadlineAt ? { ...d, deadlineAt: c.deadlineAt, serverNow: c.serverNow } : d));
      } catch { /* transient — try again next tick */ }
    };
    const id = setInterval(poll, 3500);
    return () => { alive = false; clearInterval(id); };
  }, [data, attemptId, navigate]);

  // Violation escalation → auto-submit. A limit of 0 means zero tolerance:
  // the first violation submits immediately with no prior warning.
  useEffect(() => {
    if (violationCount === 0) return;
    if (violationLimit === 0) {
      setBanner({ msg: "Malpractice detected — your exam has been submitted.", level: "crit" });
      submit(true);
    } else if (violationCount >= violationLimit) {
      setBanner({ msg: "Violation limit reached — your exam is being submitted automatically.", level: "crit" });
      submit(true);
    } else if (violationCount === violationLimit - 1) {
      setBanner({ msg: `Final warning — one more violation will auto-submit your exam (${violationCount}/${violationLimit}).`, level: "crit" });
    } else {
      setBanner({ msg: `Integrity violation recorded (${violationCount}/${violationLimit}). Stay in fullscreen and don't switch away.`, level: "warn" });
    }
  }, [violationCount, violationLimit, submit]);

  // Periodic webcam snapshot upload for the live proctoring wall.
  useEffect(() => {
    if (!proctored || !cameraReady || !(ld?.webcam ?? true) || !attemptId) return;
    const capture = () => {
      const v = videoRef.current;
      if (!v || v.readyState < 2) return;
      const c = document.createElement("canvas");
      c.width = 240; c.height = 180;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(v, 0, 0, c.width, c.height);
      api.post(`/attempts/${attemptId}/snapshot`, { image: c.toDataURL("image/jpeg", 0.5) }).catch(() => {});
    };
    const t = window.setTimeout(capture, 1500);
    const id = window.setInterval(capture, 15000);
    return () => { clearTimeout(t); clearInterval(id); };
  }, [proctored, cameraReady, attemptId, ld, videoRef]);

  // Record (but don't auto-submit on) private-browsing — heuristic, so it's
  // logged for the proctor rather than trusted to end the exam. The hard block
  // lives at check-in. Runs once when a proctored attempt loads.
  useEffect(() => {
    if (!data || !proctored || !attemptId) return;
    let done = false;
    detectIncognito().then((isPrivate) => {
      if (isPrivate && !done) {
        sendBeaconJson(`/attempts/${attemptId}/proctor-event`, {
          type: "incognito", severity: "high",
          message: "Private / incognito browsing detected during the exam.",
        });
      }
    });
    return () => { done = true; };
  }, [data, proctored, attemptId]);

  const saveAnswer = (questionId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
    sync.setAnswer(questionId, value); // resilient: buffered, retried, persisted
  };

  const toggleFlag = (qid: string) =>
    setFlagged((prev) => { const n = new Set(prev); n.has(qid) ? n.delete(qid) : n.add(qid); return n; });

  const isAnswered = useCallback((qq: PublicQuestion) => {
    const v = answers[qq.id] ?? "";
    if (qq.type === "multi_select" || qq.type === "matching" || qq.type === "ordering" || qq.type === "cloze") {
      try { const a = JSON.parse(v || "[]"); return Array.isArray(a) && a.some((x) => String(x ?? "").trim() !== ""); } catch { return false; }
    }
    return v.trim().length > 0;
  }, [answers]);
  const answeredCount = useMemo(
    () => (data ? data.questions.filter(isAnswered).length : 0),
    [data, isAnswered],
  );
  const unanswered = useMemo(
    () => (data ? data.questions.map((q, i) => ({ q, i })).filter(({ q }) => !isAnswered(q)) : []),
    [data, isAnswered],
  );

  // Manual submit goes through a review modal; auto-submit (time/violations) doesn't.
  const requestSubmit = () => setConfirmOpen(true);

  if (error && !data) return <Centered>{error}</Centered>;
  if (!data) return <Centered><Loader2 className="h-5 w-5 animate-spin" /> Loading exam…</Centered>;

  const q = data.questions[idx];
  const section = (data.exam.sections ?? []).find((s) => s.id === q.sectionId) ?? null;
  const totalSecs = remaining ?? 0;
  const hrs  = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  const lowTime = remaining !== null && remaining <= 300; // 5-minute warning

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      {/* Proctor pause — freezes the exam until resumed */}
      {paused && (
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-[var(--color-navy)] text-white">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15"><PauseIcon className="h-7 w-7" /></div>
          <p className="text-xl font-bold">{t("run.pausedTitle")}</p>
          <p className="max-w-md text-center text-sm text-white/70">
            A proctor has paused your session. Your timer is frozen — please wait, do not close this window. The exam will resume automatically.
          </p>
          <span className="inline-flex items-center gap-2 text-xs text-white/60"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Waiting for the proctor…</span>
        </div>
      )}

      {/* Lockdown: screen-blank on focus loss / screenshot (anti-peek deterrent) */}
      {proctored && lockdown.obscured && lockdown.fullscreen && (
        <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-[var(--color-navy)] text-white">
          <EyeOff className="h-10 w-10" />
          <p className="text-lg font-semibold">Exam content hidden</p>
          <p className="max-w-sm text-center text-sm text-white/70">
            Return focus to the exam window to continue. This interruption has been logged.
          </p>
        </div>
      )}

      {/* Lockdown: fullscreen is required for proctored exams */}
      {proctored && (ld?.fullscreen ?? true) && !lockdown.fullscreen && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-[var(--color-navy)] text-white">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--card)]/15"><Lock className="h-7 w-7" /></div>
          <p className="text-xl font-bold">This exam is locked to fullscreen</p>
          <p className="max-w-md text-center text-sm text-white/70">
            You left fullscreen mode. Re-enter fullscreen to continue your exam — your time keeps running and this was recorded.
          </p>
          <button onClick={lockdown.requestFullscreen} className="btn btn-primary mt-1 h-11">
            <Maximize className="h-4 w-4" /> Return to fullscreen
          </button>
        </div>
      )}

      {/* Lockdown: a second display is not allowed in a proctored exam */}
      {proctored && (ld?.tabSwitchDetection ?? true) && (ld?.blockSecondScreen ?? true) && lockdown.extraDisplay && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-[var(--color-navy)] text-white">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--card)]/15"><Lock className="h-7 w-7" /></div>
          <p className="text-xl font-bold">Disconnect additional displays</p>
          <p className="max-w-md text-center text-sm text-white/70">
            A second screen was detected. Proctored exams must run on a single display — disconnect any extra monitors to continue. Your time keeps running and this was recorded.
          </p>
        </div>
      )}

      {/* Exam top bar */}
      <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--card)]">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white"><ShieldCheck className="h-5 w-5" /></div>
            <div>
              <p className="text-sm font-semibold leading-tight">{data.exam.title}</p>
              <p className="text-xs text-[var(--muted)]">{data.exam.code}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <SaveChip state={sync.state} />
            {proctored && (
              <span className="hidden items-center gap-1.5 rounded-full bg-brand-500/15 px-2.5 py-1 text-[11px] font-semibold text-brand-400 sm:inline-flex" title="Copy, paste, screenshots and tab-switching are disabled and logged.">
                <Lock className="h-3 w-3" /> {t("run.locked")}
              </span>
            )}
            <div className={clsx("flex items-center gap-2 rounded-xl px-3.5 py-2 font-display text-[15px] font-semibold tabular-nums",
              lowTime ? "bg-rose-500/15 text-rose-400" : "bg-[var(--bg)] text-[var(--fg)]")}>
              <Clock className={clsx("h-4 w-4", lowTime && "animate-pulse")} />
              {hrs > 0 && `${hrs}:`}{String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
            </div>
          </div>
        </div>
      </header>

      {banner && proctored && (
        <div className={clsx("mx-auto mt-3 flex max-w-6xl items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium",
          banner.level === "crit" ? "bg-rose-500/15 text-rose-400 ring-1 ring-rose-500/30" : "bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30")}>
          <AlertTriangle className="h-4 w-4 shrink-0" /> {banner.msg}
        </div>
      )}

      {/* Offline banner — shown when the browser has no internet connection */}
      {!online && (
        <div className="mx-auto mt-3 flex max-w-6xl items-center gap-2 rounded-xl bg-amber-500/15 px-4 py-3 text-sm font-medium text-amber-300 ring-1 ring-amber-500/30">
          <WifiOff className="h-4 w-4 shrink-0" />
          <span>You're offline — your answers are saved locally and will sync automatically when you reconnect. Do not close this window.</span>
        </div>
      )}

      {/* Messages from the proctor */}
      {proctorMsgs.filter((m) => !dismissedMsgs.has(m.id)).map((m) => (
        <div key={m.id} className="mx-auto mt-3 flex max-w-6xl items-start gap-2 rounded-xl bg-brand-500/15 px-4 py-3 text-sm font-medium text-brand-300 ring-1 ring-brand-500/30">
          <MessageSquare className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1"><span className="font-semibold">Proctor:</span> {m.text}</span>
          <button onClick={() => setDismissedMsgs((s) => new Set(s).add(m.id))} className="shrink-0 text-brand-300/70 hover:text-brand-200"><X className="h-4 w-4" /></button>
        </div>
      ))}

      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-5 py-6 lg:grid-cols-[1fr_300px]">
        {/* Question area */}
        <div>
          {section && (
            <div className="mb-3 rounded-[3px] border border-brand-500/30 bg-brand-500/10 px-4 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-brand-400">{section.title}</p>
                {section.timeLimitMinutes ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-400"><Clock className="h-3 w-3" /> Suggested {section.timeLimitMinutes} min</span> : null}
              </div>
              {section.instructions && <p className="mt-0.5 text-xs text-[var(--muted)]">{section.instructions}</p>}
            </div>
          )}
          <div className="card p-6">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-brand-400">
                Question {idx + 1} of {data.questions.length}
              </span>
              <div className="flex items-center gap-3">
                <button onClick={() => toggleFlag(q.id)}
                  className={clsx("inline-flex items-center gap-1.5 text-xs font-medium transition",
                    flagged.has(q.id) ? "text-amber-400" : "text-[var(--muted)] hover:text-[var(--fg)]")}
                  title="Flag this question to revisit before submitting">
                  <Flag className={clsx("h-3.5 w-3.5", flagged.has(q.id) && "fill-amber-400")} />
                  {flagged.has(q.id) ? "Flagged" : "Flag"}
                </button>
                <span className="text-xs text-[var(--muted)]">{q.points} points</span>
              </div>
            </div>
            <h2 className="mt-3 text-lg font-semibold leading-snug"><MathText>{q.prompt}</MathText></h2>

            <div className="mt-5 space-y-2.5">
              {q.type === "matching" ? (
                <MatchingAnswer q={q} value={answers[q.id] ?? ""} onChange={(v) => saveAnswer(q.id, v)} />
              ) : q.type === "ordering" ? (
                <OrderingAnswer q={q} value={answers[q.id] ?? ""} onChange={(v) => saveAnswer(q.id, v)} />
              ) : q.type === "cloze" ? (
                <ClozeAnswer q={q} value={answers[q.id] ?? ""} onChange={(v) => saveAnswer(q.id, v)} />
              ) : q.type === "hotspot" ? (
                <HotspotAnswer q={q} value={answers[q.id] ?? ""} onChange={(v) => saveAnswer(q.id, v)} />
              ) : q.type === "file_upload" ? (
                <FileUploadAnswer value={answers[q.id] ?? ""} onChange={(v) => saveAnswer(q.id, v)} />
              ) : q.type === "short" ? (
                <input
                  className="input"
                  placeholder="Type your answer…"
                  value={answers[q.id] ?? ""}
                  onChange={(e) => saveAnswer(q.id, e.target.value)}
                />
              ) : q.type === "numeric" || q.type === "parameterized" ? (
                <input
                  className="input max-w-xs"
                  type="number"
                  step="any"
                  inputMode="decimal"
                  placeholder="Enter a number…"
                  value={answers[q.id] ?? ""}
                  onChange={(e) => saveAnswer(q.id, e.target.value)}
                />
              ) : q.type === "code" ? (
                <CodeAnswer q={q} value={answers[q.id] ?? ""} onChange={(v) => saveAnswer(q.id, v)} runner={data.codeRunner} />
              ) : q.type === "essay" ? (
                <textarea
                  className="input min-h-[200px] resize-y leading-relaxed"
                  placeholder="Write your answer…"
                  value={answers[q.id] ?? ""}
                  onChange={(e) => saveAnswer(q.id, e.target.value)}
                />
              ) : q.type === "multi_select" ? (
                (() => {
                  let picked: string[] = [];
                  try { picked = JSON.parse(answers[q.id] || "[]"); } catch { picked = []; }
                  const toggle = (opt: string) => {
                    const next = picked.includes(opt) ? picked.filter((x) => x !== opt) : [...picked, opt];
                    saveAnswer(q.id, JSON.stringify(next));
                  };
                  return (q.options ?? []).map((opt) => {
                    const sel = picked.includes(opt);
                    return (
                      <button key={opt} onClick={() => toggle(opt)}
                        className={clsx("flex w-full items-center gap-3 rounded-[3px] border p-3.5 text-left text-sm transition",
                          sel ? "border-brand-500 bg-brand-500/15" : "border-[var(--border)] hover:bg-white/[0.02]")}>
                        {sel ? <CheckSquare className="h-4 w-4 text-brand-400" /> : <Square className="h-4 w-4 text-[var(--muted)]" />}
                        <span className="capitalize"><MathText>{opt}</MathText></span>
                      </button>
                    );
                  });
                })()
              ) : (
                (q.options ?? []).map((opt) => {
                  const selected = answers[q.id] === opt;
                  return (
                    <button
                      key={opt}
                      onClick={() => saveAnswer(q.id, opt)}
                      className={clsx(
                        "flex w-full items-center gap-3 rounded-[3px] border p-3.5 text-left text-sm transition",
                        selected ? "border-brand-500 bg-brand-500/15" : "border-[var(--border)] hover:bg-white/[0.02]",
                      )}
                    >
                      {selected ? <CircleDot className="h-4 w-4 text-brand-400" /> : <Circle className="h-4 w-4 text-[var(--muted)]" />}
                      <span className="capitalize"><MathText>{opt}</MathText></span>
                    </button>
                  );
                })
              )}
              {q.type === "multi_select" && <p className="text-xs text-[var(--muted)]">Select all that apply.</p>}
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <button className="btn btn-outline" disabled={idx === 0} onClick={() => setIdx((i) => i - 1)}>
              <ChevronLeft className="h-4 w-4" /> Previous
            </button>
            {idx < data.questions.length - 1 ? (
              <button className="btn btn-primary" onClick={() => setIdx((i) => i + 1)}>
                Next <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <button className="btn btn-primary" disabled={submitting || !online} onClick={requestSubmit}
                title={!online ? "You're offline — reconnect to submit" : undefined}>
                {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("run.submitting")}</> : !online ? <><WifiOff className="h-4 w-4" /> Offline</> : <><Send className="h-4 w-4" /> {t("run.submitExam")}</>}
              </button>
            )}
          </div>
        </div>

        {/* Proctoring + navigator sidebar */}
        <aside className="space-y-4">
          {proctored && (
            <div className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2 text-xs font-semibold">
                <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-brand-400" /> Proctoring</span>
                <span className="inline-flex h-2 w-2 rounded-full bg-rose-500 animate-pulse" title="Recording" />
              </div>
              <div className="relative aspect-video bg-black">
                <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
                {!cameraReady && <div className="absolute inset-0 flex items-center justify-center text-xs text-white/60">Camera…</div>}
              </div>
              <div className="space-y-1 px-3 py-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[var(--muted)]">Face</span>
                  <span className={clsx("font-medium",
                    faceStatus === "ok" ? "text-emerald-400" : faceStatus === "unsupported" ? "text-[var(--muted)]" : "text-amber-400")}>
                    {faceStatus === "ok" ? "Detected" : faceStatus === "no_face" ? "Not visible" : faceStatus === "multiple" ? "Multiple" : faceStatus === "unsupported" ? "N/A" : "…"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[var(--muted)]">Flags</span>
                  <span className={clsx("inline-flex items-center gap-1 font-medium", violationCount > 0 ? "text-amber-400" : "text-emerald-400")}>
                    {violationCount > 0 && <AlertTriangle className="h-3 w-3" />}{violationCount}{violationLimit ? `/${violationLimit}` : ""}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[var(--muted)]">Integrity</span>
                  <span className={clsx("font-semibold", integrity >= 80 ? "text-emerald-400" : integrity >= 60 ? "text-amber-400" : "text-rose-400")}>
                    {integrity}
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="card p-4">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span>Questions</span>
              <span className="text-[var(--muted)]">{answeredCount}/{data.questions.length} answered</span>
            </div>
            <div className="mt-3 grid grid-cols-6 gap-2">
              {data.questions.map((qq, i) => {
                const answered = isAnswered(qq);
                const isFlagged = flagged.has(qq.id);
                return (
                  <button
                    key={qq.id}
                    onClick={() => setIdx(i)}
                    className={clsx(
                      "relative flex h-9 items-center justify-center rounded-lg text-xs font-semibold transition",
                      i === idx ? "bg-brand-600 text-white"
                        : answered ? "bg-brand-500/15 text-brand-400"
                        : "border border-[var(--border)] text-[var(--muted)] hover:bg-white/[0.03]",
                    )}
                  >
                    {i + 1}
                    {isFlagged && <Flag className="absolute -right-1 -top-1 h-3 w-3 fill-amber-400 text-amber-400" />}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex items-center justify-center gap-3 text-[10px] text-[var(--muted)]">
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-brand-500/40" /> Answered</span>
              <span className="inline-flex items-center gap-1"><Flag className="h-2.5 w-2.5 fill-amber-400 text-amber-400" /> Flagged</span>
            </div>
            <button className="btn btn-primary mt-4 w-full" disabled={submitting || !online} onClick={requestSubmit}
              title={!online ? "You're offline — reconnect to submit" : undefined}>
              {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("run.submitting")}</> : !online ? <><WifiOff className="h-4 w-4" /> Offline</> : t("run.submitExam")}
            </button>
          </div>
        </aside>
      </div>

      {/* Pre-submit review */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setConfirmOpen(false)}>
          <div className="w-full max-w-md rounded-[4px] border border-[var(--border)] bg-[var(--card)] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">{t("run.submitConfirm")}</h2>
              <button onClick={() => setConfirmOpen(false)} className="rounded p-1 text-[var(--muted)] hover:text-[var(--fg)]"><X className="h-4 w-4" /></button>
            </div>
            <p className="mt-1 text-sm text-[var(--muted)]">You've answered <span className="font-semibold text-[var(--fg)]">{answeredCount} of {data.questions.length}</span> questions. This can't be undone.</p>

            {(unanswered.length > 0 || flagged.size > 0) && (
              <div className="mt-4 space-y-3">
                {unanswered.length > 0 && (
                  <div className="rounded-[3px] border border-amber-500/30 bg-amber-500/10 p-3">
                    <p className="text-xs font-semibold text-amber-400">{unanswered.length} unanswered</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {unanswered.map(({ i }) => (
                        <button key={i} onClick={() => { setIdx(i); setConfirmOpen(false); }}
                          className="rounded-sm bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/25">{i + 1}</button>
                      ))}
                    </div>
                  </div>
                )}
                {flagged.size > 0 && (
                  <div className="rounded-[3px] border border-[var(--border)] p-3">
                    <p className="text-xs font-semibold text-[var(--muted)]"><Flag className="mr-1 inline h-3 w-3 fill-amber-400 text-amber-400" />{flagged.size} flagged for review</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {data.questions.map((qq, i) => flagged.has(qq.id) ? (
                        <button key={qq.id} onClick={() => { setIdx(i); setConfirmOpen(false); }}
                          className="rounded-sm bg-white/[0.06] px-2 py-0.5 text-xs font-semibold hover:bg-white/[0.1]">{i + 1}</button>
                      ) : null)}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button onClick={() => setConfirmOpen(false)} className="btn btn-outline h-10">Keep working</button>
              <button onClick={() => { setConfirmOpen(false); submit(false); }} className="btn btn-primary h-10">
                <Send className="h-4 w-4" /> {t("run.submitExam")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SaveChip({ state }: { state: "saved" | "saving" | "error" | "offline" }) {
  const map = {
    saved:   { icon: Check,        text: "Saved",             cls: "text-emerald-400" },
    saving:  { icon: CloudUpload,  text: "Saving…",           cls: "text-[var(--muted)]" },
    error:   { icon: CloudOff,     text: "Reconnecting…",     cls: "text-amber-400" },
    offline: { icon: WifiOff,      text: "Offline — saved locally", cls: "text-amber-400" },
  } as const;
  const { icon: Icon, text, cls } = map[state];
  return (
    <span className={clsx("hidden items-center gap-1.5 text-[11px] font-medium sm:inline-flex", cls)} title="Your answers save automatically">
      <Icon className={clsx("h-3.5 w-3.5", state === "saving" && "animate-pulse")} /> {text}
    </span>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center gap-2 text-[var(--muted)]">{children}</div>
  );
}

/* ─────────────────────── New question-type answers ─────────────────────── */

// Matching: one dropdown per left prompt; options are the shuffled right values.
function MatchingAnswer({ q, value, onChange }: { q: PublicQuestion; value: string; onChange: (v: string) => void }) {
  const prompts = q.matchPrompts ?? [];
  const opts = q.options ?? [];
  const picks = arrAnswer(value, prompts.length);
  const set = (i: number, v: string) => { const next = [...picks]; next[i] = v; onChange(JSON.stringify(next)); };
  return (
    <div className="space-y-2.5">
      {prompts.map((p, i) => (
        <div key={i} className="flex flex-wrap items-center gap-3 rounded-[3px] border border-[var(--border)] p-3">
          <span className="min-w-[140px] flex-1 text-sm font-medium"><MathText>{p}</MathText></span>
          <ChevronRight className="h-4 w-4 text-[var(--muted)]" />
          <select className="input h-10 flex-1" value={picks[i]} onChange={(e) => set(i, e.target.value)}>
            <option value="">Choose…</option>
            {opts.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      ))}
    </div>
  );
}

// Ordering: reorder the served items up/down into the correct sequence.
function OrderingAnswer({ q, value, onChange }: { q: PublicQuestion; value: string; onChange: (v: string) => void }) {
  // Start from the candidate's saved order, else the served (shuffled) order.
  const served = q.options ?? [];
  const saved = arrAnswer(value, served.length).filter(Boolean);
  const order = saved.length === served.length ? saved : served;
  const move = (i: number, dir: -1 | 1) => { const j = i + dir; if (j < 0 || j >= order.length) return; const c = [...order]; [c[i], c[j]] = [c[j], c[i]]; onChange(JSON.stringify(c)); };
  return (
    <div className="space-y-2">
      {order.map((it, i) => (
        <div key={it + i} className="flex items-center gap-3 rounded-[3px] border border-[var(--border)] p-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-brand-500/15 text-xs font-bold text-brand-400">{i + 1}</span>
          <span className="flex-1 text-sm"><MathText>{it}</MathText></span>
          <button onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-1 text-[var(--muted)] hover:text-[var(--fg)] disabled:opacity-30"><ChevronUp className="h-4 w-4" /></button>
          <button onClick={() => move(i, 1)} disabled={i === order.length - 1} className="rounded p-1 text-[var(--muted)] hover:text-[var(--fg)] disabled:opacity-30"><ChevronDown className="h-4 w-4" /></button>
        </div>
      ))}
      <p className="text-xs text-[var(--muted)]">Use the arrows to arrange the items into the correct order.</p>
    </div>
  );
}

// Cloze: one input per blank.
function ClozeAnswer({ q, value, onChange }: { q: PublicQuestion; value: string; onChange: (v: string) => void }) {
  const n = q.blankCount ?? 0;
  const vals = arrAnswer(value, n);
  const set = (i: number, v: string) => { const next = [...vals]; next[i] = v; onChange(JSON.stringify(next)); };
  return (
    <div className="space-y-2.5">
      {Array.from({ length: n }).map((_, i) => (
        <label key={i} className="flex items-center gap-3">
          <span className="w-16 shrink-0 text-sm font-medium text-[var(--muted)]">Blank {i + 1}</span>
          <input className="input flex-1" value={vals[i]} placeholder="Your answer…" onChange={(e) => set(i, e.target.value)} />
        </label>
      ))}
    </div>
  );
}

// Hotspot: click the image; store the click position in %.
function HotspotAnswer({ q, value, onChange }: { q: PublicQuestion; value: string; onChange: (v: string) => void }) {
  let pt: { x: number; y: number } | null = null;
  try { const o = JSON.parse(value || "null"); if (o && Number.isFinite(o.x)) pt = o; } catch { /* ignore */ }
  const onClick = (e: React.MouseEvent<HTMLImageElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onChange(JSON.stringify({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 }));
  };
  if (!q.imageUrl) return <p className="text-sm text-[var(--muted)]">Image unavailable.</p>;
  return (
    <div>
      <div className="relative inline-block max-w-full overflow-hidden rounded-[3px] border border-[var(--border)]">
        <img src={q.imageUrl} alt="" onClick={onClick} className="block max-h-[420px] max-w-full cursor-crosshair select-none" draggable={false} />
        {pt && (
          <span className="pointer-events-none absolute -ml-3 -mt-3 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-brand-500/80 shadow" style={{ left: `${pt.x}%`, top: `${pt.y}%` }}>
            <Circle className="h-2 w-2 fill-white text-white" />
          </span>
        )}
      </div>
      <p className="mt-2 text-xs text-[var(--muted)]">Click the correct spot on the image. {pt ? "Click again to change your answer." : ""}</p>
    </div>
  );
}

// File upload: store the file as a JSON {name,type,data} payload.
function FileUploadAnswer({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  let meta: { name?: string } = {};
  try { meta = JSON.parse(value || "{}"); } catch { /* ignore */ }
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    if (file.size > 5_000_000) { alert("File must be under 5 MB."); return; }
    const r = new FileReader();
    r.onload = () => onChange(JSON.stringify({ name: file.name, type: file.type, data: String(r.result) }));
    r.readAsDataURL(file);
  };
  return (
    <div className="rounded-[3px] border border-dashed border-[var(--border)] p-5 text-center">
      <CloudUpload className="mx-auto h-7 w-7 text-[var(--muted)]" />
      {meta.name ? (
        <p className="mt-2 text-sm font-medium text-emerald-400"><Check className="mr-1 inline h-4 w-4" />{meta.name}</p>
      ) : (
        <p className="mt-2 text-sm text-[var(--muted)]">Attach your answer file (≤ 5 MB).</p>
      )}
      <label className="btn btn-outline mt-3 inline-flex h-9 cursor-pointer">
        <Upload className="h-4 w-4" /> {meta.name ? "Replace file" : "Choose file"}
        <input type="file" className="hidden" onChange={pick} />
      </label>
    </div>
  );
}
