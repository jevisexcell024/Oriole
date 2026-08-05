import { useEffect, useState } from "react";
import { Link, useParams, useLocation } from "react-router-dom";
import {
  ArrowLeft, XCircle, CheckCircle2, ShieldAlert, MessageSquare, Send, X, AlertTriangle, Clock, ChevronRight,
  Loader2, Award, Hourglass, Copy, Check, Circle, ShieldCheck, ClipboardList, LayoutGrid, Info, Lock,
  BellRing, ArrowRight,
} from "lucide-react";
import { Shell } from "@/components/Shell";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { MathText } from "@/lib/richtext";
import { useT, type TFn } from "@/lib/i18n";
import type { Attempt, Certificate, Exam, GradingStatus, ProctorEvent } from "@shared/types";

// ── Design tokens ── theme-aware: these track the app's light/dark CSS
// variables (src/index.css) instead of a fixed dark palette. RED/ORANGE stay
// fixed — universal semantic colors regardless of theme. ──
const LIME = "var(--color-brand-500)";
const RED = "#ef4444";
const ORANGE = "#fb923c";
const CARD = "var(--card)";
const INNER = "var(--card-2)";
const DIM = "var(--muted)";
const BG = "var(--bg)";
const INK = "var(--brand-ink)";

interface ReviewItem {
  questionId: string; prompt: string; type: string; yourAnswer: string; correctAnswer: string;
  correct: boolean | null; awardedPoints: number | null; feedback: string | null; explanation: string | null;
  points: number; rubric: { id: string; label: string; maxPoints: number }[] | null; rubricScores: Record<string, number> | null;
}
interface ResultResp {
  attempt: Attempt; exam: Exam; review: ReviewItem[]; certificate: Certificate | null; proctorEvents: ProctorEvent[];
  tenantName?: string | null;
  gradingStatus: GradingStatus; held?: boolean; releaseAt?: string | null; letter?: string | null;
  canAppeal?: boolean; regrade?: { status: "open" | "resolved" | "rejected"; reason: string; response: string | null; createdAt: string } | null;
}

const SEVERITY_META: Record<string, { color: string; bg: string; labelKey: string }> = {
  high: { color: RED, bg: "rgba(239,68,68,0.12)", labelKey: "result.severityHigh" },
  warning: { color: ORANGE, bg: "rgba(251,146,60,0.12)", labelKey: "result.severityWarning" },
  info: { color: DIM, bg: "color-mix(in oklch, var(--muted) 12%, transparent)", labelKey: "result.severityInfo" },
};

export function Result() {
  const t = useT();
  const { attemptId } = useParams();
  const location = useLocation();
  const [data, setData] = useState<ResultResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Only the moment right after hitting "Submit exam" shows the receipt screen
  // (Session.tsx passes this in nav state); revisiting the same URL later —
  // reload, back button, a link from Results — goes straight to the normal view.
  const [showConfirmation, setShowConfirmation] = useState(!!(location.state as { justSubmitted?: boolean } | null)?.justSubmitted);

  useEffect(() => { api.get<ResultResp>(`/attempts/${attemptId}/result`).then(setData).catch((e) => setError(e.message)); }, [attemptId]);

  if (error) return <Shell><p className="text-sm text-rose-400">{error}</p></Shell>;
  if (!data) return <Shell><div className="flex items-center gap-2 text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}</div></Shell>;

  const { attempt, exam, gradingStatus } = data;
  const held = data.held ?? false;
  const pending = gradingStatus === "pending_review" || held;

  return (
    <Shell>
      <div className="print:hidden" style={{ minHeight: "100vh", backgroundColor: BG, fontFamily: "Inter, sans-serif", scrollbarWidth: "none" }}>
        <div style={{ maxWidth: 860, margin: "0 auto", paddingBottom: 48 }}>
          <Breadcrumb examTitle={exam.title} />
          {showConfirmation ? (
            <SubmissionConfirmation t={t} data={data} pending={pending} onContinue={() => setShowConfirmation(false)} />
          ) : pending ? (
            <PendingHero t={t} data={data} exam={exam} held={held} />
          ) : (
            <ResolvedView t={t} data={data} attemptId={attemptId!} />
          )}
        </div>
      </div>
    </Shell>
  );
}

// ── Breadcrumb ─────────────────────────────────────────────────────────
function Breadcrumb({ examTitle }: { examTitle: string }) {
  const t = useT();
  return (
    <div className="flex items-center" style={{ gap: 8, padding: "16px 24px" }}>
      <Link to="/exams" className="flex items-center gap-1.5 transition hover:opacity-70" style={{ color: DIM }}>
        <ArrowLeft className="h-[14px] w-[14px]" /> <span style={{ fontSize: 12 }}>{t("result.back")}</span>
      </Link>
      <ChevronRight className="h-3 w-3" style={{ color: "var(--muted)" }} />
      <span className="truncate" style={{ fontSize: 12, color: "var(--muted)" }}>{examTitle}</span>
    </div>
  );
}

// ── Submission confirmation — the receipt shown right after hitting Submit,
// before the score/pending view. Every figure below is derived from the real
// attempt/exam/proctor data already fetched for this page; nothing here is
// invented (no fake IP/device info, no "network stability" — we don't track
// that per attempt, so it's simply not shown). ──
function fmtHMS(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

function SubmissionConfirmation({ t, data, pending, onContinue }: { t: TFn; data: ResultResp; pending: boolean; onContinue: () => void }) {
  const { attempt, exam, review, proctorEvents } = data;
  const [copied, setCopied] = useState(false);

  const answered = review.filter((r) => r.yourAnswer && r.yourAnswer.trim()).length;
  const skipped = review.length - answered;
  const startedMs = new Date(attempt.startedAt).getTime();
  const submittedMs = attempt.submittedAt ? new Date(attempt.submittedAt).getTime() : Date.now();
  const timeUsed = fmtHMS(submittedMs - startedMs);
  const durationAllowed = fmtHMS(exam.durationMinutes * 60_000);
  const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

  const fullscreenExits = proctorEvents.filter((e) => e.type === "fullscreen_exit").length;
  const tabSwitches = proctorEvents.filter((e) => e.type === "tab_blur").length;
  const copyPasteAttempts = proctorEvents.filter((e) => e.type === "copy_attempt" || e.type === "paste_attempt").length;

  const resultsReady = !pending;
  const steps = [
    { label: t("subc.stepStarted"), done: true, at: fmtDate(attempt.startedAt) },
    { label: t("subc.stepCompleted"), done: true, at: fmtDate(attempt.submittedAt) },
    { label: t("subc.stepSubmitted"), done: true, at: fmtDate(attempt.submittedAt) },
    { label: t("subc.stepReview"), done: !pending, at: pending ? t("subc.pending") : t("subc.skippedAuto") },
    { label: t("subc.stepPublished"), done: resultsReady, at: resultsReady ? t("subc.now") : t("subc.pending") },
  ];

  const copyId = () => { navigator.clipboard?.writeText(attempt.id).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); };

  return (
    <div className="mx-6">
      <div className="flex flex-col items-center pb-6 pt-4 text-center">
        <div className="relative flex h-14 w-14 items-center justify-center rounded-full" style={{ background: "color-mix(in oklch, var(--color-brand-500) 14%, var(--card))" }}>
          <CheckCircle2 className="h-7 w-7" style={{ color: LIME }} />
        </div>
        <h1 className="mt-4 text-2xl font-extrabold" style={{ color: "var(--fg)" }}>{t("subc.title")}</h1>
        <p className="mt-1.5 max-w-md text-sm" style={{ color: DIM }}>{t("subc.subtitle")}</p>
        <button onClick={copyId} className="mt-3 inline-flex items-center gap-2 rounded-full transition hover:opacity-80"
          style={{ padding: "6px 14px", fontSize: 11, fontFamily: "monospace", color: DIM, background: INNER, border: "1px solid var(--border)" }}>
          {t("subc.submissionId")}: {attempt.id} {copied ? <Check className="h-3 w-3" style={{ color: LIME }} /> : <Copy className="h-3 w-3" />}
        </button>
      </div>

      {/* Timeline */}
      <div className="flex flex-wrap items-start justify-between gap-y-4 rounded-2xl p-5" style={{ background: CARD, border: "1px solid var(--border)" }}>
        {steps.map((s, i) => (
          <div key={s.label} className="flex flex-1 min-w-[110px] flex-col items-center text-center" style={{ position: "relative" }}>
            {i > 0 && <span className="absolute top-4 -translate-y-1/2" style={{ right: "50%", width: "100%", height: 2, background: steps[i - 1].done && s.done ? `color-mix(in oklch, ${LIME} 40%, transparent)` : "var(--border)", zIndex: 0 }} />}
            <span className="relative z-10 flex h-8 w-8 items-center justify-center rounded-full" style={{ background: s.done ? LIME : INNER, color: s.done ? INK : DIM, border: s.done ? "none" : "1px solid var(--border)" }}>
              {s.done ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-3.5 w-3.5" />}
            </span>
            <span className="relative z-10 mt-2 text-[11px] font-semibold" style={{ color: s.done ? "var(--fg)" : DIM }}>{s.label}</span>
            <span className="relative z-10 mt-0.5 text-[10px]" style={{ color: DIM }}>{s.at}</span>
          </div>
        ))}
      </div>

      {/* Stats */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatBox label={t("subc.totalQuestions")} value={review.length} />
        <StatBox label={t("subc.answered")} value={`${answered}/${review.length}`} />
        <StatBox label={t("subc.skipped")} value={skipped} accent={skipped > 0 ? ORANGE : undefined} />
        <StatBox label={t("subc.timeUsed")} value={timeUsed} mono />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Examination details */}
        <InfoCard icon={ClipboardList} title={t("subc.examDetails")}>
          <InfoRow label={t("subc.course")} value={exam.subject || exam.code} />
          <InfoRow label={t("subc.assessment")} value={exam.title} />
          <InfoRow label={t("subc.institution")} value={data.tenantName ?? "—"} />
        </InfoCard>

        {/* Integrity summary — only for proctored exams, only real tracked events */}
        {exam.proctored ? (
          <InfoCard icon={ShieldCheck} title={t("subc.integritySummary")}>
            <InfoRow label={t("subc.fullscreenStatus")} value={fullscreenExits === 0 ? t("subc.maintained") : t("subc.exitsDetected", { n: fullscreenExits })} good={fullscreenExits === 0} />
            <InfoRow label={t("subc.tabSwitches")} value={String(tabSwitches)} good={tabSwitches === 0} />
            <InfoRow label={t("subc.copyPasteAttempts")} value={String(copyPasteAttempts)} good={copyPasteAttempts === 0} />
            <InfoRow label={t("subc.flaggedEvents")} value={String(proctorEvents.length)} good={proctorEvents.length === 0} />
          </InfoCard>
        ) : (
          <InfoCard icon={LayoutGrid} title={t("subc.submissionSummary")}>
            <InfoRow label={t("subc.timeSubmitted")} value={fmtDate(attempt.submittedAt)} />
            <InfoRow label={t("subc.durationAllowed")} value={durationAllowed} />
            <InfoRow label={t("subc.status")} value={t("subc.finalized")} good />
          </InfoCard>
        )}
      </div>

      {exam.proctored && (
        <div className="mt-4">
          <InfoCard icon={LayoutGrid} title={t("subc.submissionSummary")} wide>
            <InfoRow label={t("subc.timeSubmitted")} value={fmtDate(attempt.submittedAt)} />
            <InfoRow label={t("subc.durationAllowed")} value={durationAllowed} />
            <InfoRow label={t("subc.status")} value={t("subc.finalized")} good />
          </InfoCard>
        </div>
      )}

      {/* What happens next */}
      <div className="mt-4 rounded-2xl p-5" style={{ background: CARD, border: "1px solid var(--border)" }}>
        <div className="mb-3 flex items-center gap-2">
          <Info className="h-4 w-4" style={{ color: LIME }} />
          <h2 style={{ fontSize: 13, fontWeight: 600, color: "var(--fg)" }}>{t("subc.whatsNext")}</h2>
        </div>
        <div className="flex flex-col gap-3">
          <NextItem icon={Lock} title={t("subc.secureStorage")} desc={t("subc.secureStorageDesc")} />
          {pending
            ? <NextItem icon={ShieldAlert} title={t("subc.institutionalReview")} desc={t("subc.institutionalReviewDesc")} />
            : <NextItem icon={CheckCircle2} title={t("subc.instantGrading")} desc={t("subc.instantGradingDesc")} />}
          <NextItem icon={BellRing} title={t("subc.notification")} desc={pending ? t("subc.notificationDescPending") : t("subc.notificationDescReady")} />
        </div>
      </div>

      {/* Candidate actions */}
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <Link to="/dashboard" className="rounded-lg transition hover:opacity-80" style={{ padding: "10px 16px", fontSize: 12, fontWeight: 600, color: DIM, border: "1px solid var(--border)" }}>
          {t("subc.backToDashboard")}
        </Link>
        <button onClick={onContinue} className="inline-flex items-center gap-2 rounded-lg transition hover:opacity-90"
          style={{ padding: "10px 16px", fontSize: 12, fontWeight: 600, color: INK, background: LIME }}>
          {pending ? t("subc.viewStatus") : t("subc.viewResults")} <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function StatBox({ label, value, accent, mono }: { label: string; value: string | number; accent?: string; mono?: boolean }) {
  return (
    <div className="rounded-xl p-3.5" style={{ background: CARD, border: "1px solid var(--border)" }}>
      <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: DIM }}>{label}</p>
      <p className={mono ? "tabular-nums" : undefined} style={{ marginTop: 4, fontSize: 18, fontWeight: 700, color: accent ?? "var(--fg)" }}>{value}</p>
    </div>
  );
}

function InfoCard({ icon: Icon, title, children, wide }: { icon: typeof ClipboardList; title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="rounded-2xl p-4" style={{ background: CARD, border: "1px solid var(--border)", gridColumn: wide ? "1 / -1" : undefined }}>
      <div className="mb-2.5 flex items-center gap-2">
        <Icon className="h-3.5 w-3.5" style={{ color: LIME }} />
        <h3 style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: DIM }}>{title}</h3>
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

function InfoRow({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span style={{ fontSize: 11, color: DIM }}>{label}</span>
      <span className="truncate text-right" style={{ fontSize: 12, fontWeight: 600, color: good === undefined ? "var(--fg)" : good ? LIME : ORANGE }}>{value}</span>
    </div>
  );
}

function NextItem({ icon: Icon, title, desc }: { icon: typeof Lock; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: "color-mix(in oklch, var(--color-brand-500) 10%, transparent)" }}>
        <Icon className="h-[14px] w-[14px]" style={{ color: LIME }} />
      </span>
      <div>
        <p style={{ fontSize: 12, fontWeight: 600, color: "var(--fg)" }}>{title}</p>
        <p className="mt-0.5 leading-relaxed" style={{ fontSize: 11.5, color: DIM }}>{desc}</p>
      </div>
    </div>
  );
}

// ── Pending / held state (unchanged real behaviour, restyled minimally) ──
function PendingHero({ t, data, exam, held }: { t: TFn; data: ResultResp; exam: Exam; held: boolean }) {
  const fmtRelease = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");
  return (
    <div className="mx-6 flex flex-col items-center gap-3 p-8 text-center" style={{ borderRadius: 16, background: "rgba(251,146,60,0.1)", border: "1px solid rgba(251,146,60,0.2)" }}>
      <div className="flex h-16 w-16 items-center justify-center rounded-full" style={{ background: ORANGE, color: INK }}>
        <Hourglass className="h-9 w-9" />
      </div>
      <div>
        <h1 className="text-2xl font-extrabold" style={{ color: "var(--fg)" }}>{held ? t("result.pendingReleaseTitle") : t("result.awaitingTitle")}</h1>
        <p className="mt-1 text-sm font-semibold" style={{ color: ORANGE }}>{held ? t("result.pendingReleaseMsg") : t("result.awaitingMsg")}</p>
        <p className="mt-1 text-xs" style={{ color: DIM }}>
          {held && data.releaseAt ? t("result.heldSub", { exam: exam.title, date: fmtRelease(data.releaseAt) }) : t("result.awaitingSub", { exam: exam.title })}
        </p>
      </div>
    </div>
  );
}

// ── Resolved (graded, released) view ─────────────────────────────────────
function ResolvedView({ t, data, attemptId }: { t: TFn; data: ResultResp; attemptId: string }) {
  const { user } = useAuth();
  const { attempt, exam, review, proctorEvents } = data;
  const passed = !!attempt.passed;
  const accent = passed ? LIME : RED;

  const correctCount = review.filter((r) => r.correct === true).length;
  const blankCount = review.filter((r) => !r.yourAnswer || !r.yourAnswer.trim()).length;
  const incorrectCount = review.filter((r) => r.correct === false && r.yourAnswer && r.yourAnswer.trim()).length;
  const earnedPts = review.reduce((s, r) => s + (r.awardedPoints ?? 0), 0);
  const totalPts = review.reduce((s, r) => s + r.points, 0);

  const durationMin = Math.max(0, Math.round((new Date(attempt.submittedAt!).getTime() - new Date(attempt.startedAt).getTime()) / 60000));
  const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

  return (
    <>
      <HeroCard t={t} exam={exam} attempt={attempt} accent={accent} passed={passed} studentName={user?.name ?? ""}
        durationMin={durationMin} fmtDate={fmtDate} correctCountAll={correctCount} incorrectCount={incorrectCount}
        blankCount={blankCount} earnedPts={earnedPts} totalPts={totalPts} total={review.length} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, margin: "16px 24px 0" }}>
        {exam.proctored && <ProctoringPanel t={t} events={proctorEvents} />}
        <ResultReviewPanel t={t} data={data} attemptId={attemptId} spanFull={!exam.proctored} />
      </div>

      <AnswerReviewSection t={t} review={review} correctCount={correctCount} passed={passed} accent={accent} />

      {passed && exam.proctored && data.certificate && (
        <div className="mx-6 mt-4">
          <Link to="/certificates" className="inline-flex items-center gap-2 transition hover:opacity-80"
            style={{ background: LIME, color: INK, fontSize: 12, fontWeight: 600, padding: "10px 16px", borderRadius: 8 }}>
            <Award className="h-4 w-4" /> {t("result.viewCertificate")}
          </Link>
        </div>
      )}
    </>
  );
}

function HeroCard({ t, exam, attempt, accent, passed, studentName, durationMin, fmtDate, correctCountAll, incorrectCount, blankCount, earnedPts, totalPts, total }: {
  t: TFn; exam: Exam; attempt: Attempt; accent: string; passed: boolean; studentName: string; durationMin: number;
  fmtDate: (iso: string | null) => string; correctCountAll: number; incorrectCount: number; blankCount: number; earnedPts: number; totalPts: number; total: number;
}) {
  const score = attempt.score ?? 0;
  const circumference = 2 * Math.PI * 52;
  const offset = circumference - (score / 100) * circumference;
  const gradient = passed
    ? "linear-gradient(145deg, color-mix(in oklch, #22c55e 14%, var(--card)) 0%, color-mix(in oklch, #22c55e 7%, var(--card)) 60%, var(--card) 100%)"
    : "linear-gradient(145deg, color-mix(in oklch, #ef4444 14%, var(--card)) 0%, color-mix(in oklch, #ef4444 7%, var(--card)) 60%, var(--card) 100%)";

  const breakdown = [
    { label: t("result.correctLabel"), value: correctCountAll, color: LIME },
    { label: t("result.incorrectLabel"), value: incorrectCount, color: RED },
    { label: t("result.blankLabel"), value: blankCount, color: DIM },
    { label: t("result.totalPtsLabel"), value: `${earnedPts}/${totalPts}`, color: "var(--fg)" },
  ];

  return (
    <div className="mx-6 overflow-hidden" style={{ borderRadius: 16, background: gradient, border: `1px solid color-mix(in oklch, ${accent} 12%, transparent)` }}>
      <div className="flex items-center justify-between" style={{ padding: "20px 24px 0" }}>
        <div>
          <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.12em", color: `color-mix(in oklch, ${accent} 60%, transparent)` }}>{t("result.examResultLabel")}</p>
          <p className="mt-1" style={{ fontSize: 13, fontWeight: 600, color: "var(--fg)" }}>{exam.title}</p>
        </div>
        <span style={{ padding: "4px 12px", borderRadius: 999, background: `color-mix(in oklch, ${accent} 12%, transparent)`, color: accent, border: `1px solid color-mix(in oklch, ${accent} 20%, transparent)`, fontSize: 11, fontWeight: 600 }}>
          {passed ? t("common.pass") : t("common.fail")}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-6" style={{ padding: "32px" }}>
        <div className="flex items-center" style={{ gap: 32 }}>
          <div className="relative shrink-0" style={{ width: 120, height: 120 }}>
            <svg width={120} height={120} viewBox="0 0 120 120" style={{ transform: "rotate(-90deg)" }}>
              <circle cx={60} cy={60} r={52} fill="none" stroke={`color-mix(in oklch, ${accent} 10%, transparent)`} strokeWidth={6} />
              <circle cx={60} cy={60} r={52} fill="none" stroke={accent} strokeWidth={6} strokeLinecap="round"
                strokeDasharray={circumference} strokeDashoffset={offset} style={{ transition: "stroke-dashoffset 0.6s ease" }} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span style={{ fontSize: 28, fontWeight: 700, color: accent, letterSpacing: "-1px" }}>{score}%</span>
              <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: DIM }}>score</span>
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2">
              {passed ? <CheckCircle2 className="h-4 w-4" style={{ color: LIME }} /> : <XCircle className="h-4 w-4" style={{ color: RED }} />}
              <span style={{ fontSize: 16, fontWeight: 700, color: "var(--fg)" }}>{passed ? t("result.passed") : t("result.failed")}</span>
            </div>
            <p className="mt-1" style={{ fontSize: 13, color: DIM }}>
              {studentName && <>{studentName} · </>}{correctCountAll}/{total} {t("result.correctLabel").toLowerCase()} · {t("result.passMarkLabel")} {exam.passingScore}%
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-col text-right" style={{ gap: 12 }}>
          <MetaItem label={t("result.submittedLabel")} value={fmtDate(attempt.submittedAt)} />
          <MetaItem label={t("result.durationLabel")} value={`${durationMin} min`} />
          <MetaItem label={t("result.passMarkLabel")} value={`${exam.passingScore}%`} />
        </div>
      </div>

      <div className="flex" style={{ borderTop: `1px solid color-mix(in oklch, ${accent} 8%, transparent)` }}>
        {breakdown.map((b, i) => (
          <div key={b.label} className="flex flex-1 flex-col items-center" style={{ padding: "16px 0", borderRight: i < breakdown.length - 1 ? `1px solid color-mix(in oklch, ${accent} 8%, transparent)` : undefined }}>
            <span style={{ fontSize: 20, fontWeight: 700, color: b.color }}>{b.value}</span>
            <span className="mt-0.5" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: DIM }}>{b.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: DIM }}>{label}</p>
      <p style={{ fontSize: 13, fontWeight: 600, color: "var(--fg)" }}>{value}</p>
    </div>
  );
}

function ProctoringPanel({ t, events }: { t: TFn; events: ProctorEvent[] }) {
  return (
    <div style={{ borderRadius: 16, padding: 20, backgroundColor: CARD, border: "1px solid var(--border)" }}>
      <div className="mb-4 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: "rgba(251,146,60,0.12)" }}>
          <ShieldAlert className="h-[14px] w-[14px]" style={{ color: ORANGE }} />
        </span>
        <h2 style={{ fontSize: 13, fontWeight: 600, color: "var(--fg)" }}>{t("result.proctoringSummary")}</h2>
      </div>

      {events.length === 0 ? (
        <p style={{ fontSize: 12, color: LIME }}>{t("result.cleanSession")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {events.map((e) => {
            const sev = SEVERITY_META[e.severity] ?? SEVERITY_META.info;
            return (
              <div key={e.id} className="flex items-start justify-between gap-3" style={{ padding: 12, borderRadius: 8, backgroundColor: INNER }}>
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" style={{ color: ORANGE }} />
                  <span className="leading-relaxed" style={{ fontSize: 12, color: "var(--fg)" }}>
                    <span className="capitalize">{e.type.replace(/_/g, " ")}</span> — {e.message}
                  </span>
                </div>
                <span className="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: sev.color, backgroundColor: sev.bg }}>
                  {t(sev.labelKey)}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-3" style={{ fontSize: 11, color: DIM }}>{t("result.integrityEventsFooter", { n: events.length })}</p>
    </div>
  );
}

function ResultReviewPanel({ t, data, attemptId, spanFull }: { t: TFn; data: ResultResp; attemptId: string; spanFull: boolean }) {
  const [reviewSent, setReviewSent] = useState(!!(data.regrade));
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (reason.trim().length < 10) { setErr(t("result.reasonPlaceholder")); return; }
    setBusy(true); setErr(null);
    try {
      await api.post(`/attempts/${attemptId}/regrade`, { reason });
      setReviewSent(true); setOpen(false);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const canRequest = data.canAppeal && !data.regrade;

  return (
    <div style={{ borderRadius: 16, padding: 20, backgroundColor: CARD, border: "1px solid var(--border)", gridColumn: spanFull ? "1 / -1" : undefined }}>
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: "color-mix(in oklch, var(--color-brand-500) 10%, transparent)" }}>
          <MessageSquare className="h-[14px] w-[14px]" style={{ color: LIME }} />
        </span>
        <h2 style={{ fontSize: 13, fontWeight: 600, color: "var(--fg)" }}>{t("result.resultReview")}</h2>
      </div>

      <p className="mb-5 leading-relaxed" style={{ fontSize: 12, color: DIM }}>{t("result.reviewPrompt")}</p>

      {reviewSent ? (
        <div className="flex items-center gap-2" style={{ padding: 12, borderRadius: 8, backgroundColor: "color-mix(in oklch, var(--color-brand-500) 8%, transparent)", border: "1px solid color-mix(in oklch, var(--color-brand-500) 15%, transparent)" }}>
          <CheckCircle2 className="h-[14px] w-[14px]" style={{ color: LIME }} />
          <span style={{ fontSize: 12, fontWeight: 500, color: LIME }}>{t("result.reviewSubmitted")}</span>
        </div>
      ) : !canRequest ? null : open ? (
        <div>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("result.reasonPlaceholder")}
            className="w-full resize-y outline-none" style={{ minHeight: 80, background: INNER, border: "1px solid var(--border)", borderRadius: 8, padding: 10, fontSize: 12, color: "var(--fg)" }} />
          {err && <p className="mt-1.5" style={{ fontSize: 11, color: RED }}>{err}</p>}
          <div className="mt-2 flex items-center gap-2">
            <button onClick={submit} disabled={busy} className="flex items-center gap-2 transition hover:opacity-80 disabled:opacity-60"
              style={{ backgroundColor: LIME, color: INK, fontSize: 12, fontWeight: 600, padding: "10px 16px", borderRadius: 8 }}>
              {busy ? <Loader2 className="h-[13px] w-[13px] animate-spin" /> : <Send size={13} />} {t("result.submitRequest")}
            </button>
            <button onClick={() => { setOpen(false); setErr(null); }} className="transition hover:opacity-70" style={{ fontSize: 12, color: DIM, padding: "10px 12px" }}>
              <X size={13} />
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setOpen(true)} className="flex items-center gap-2 transition hover:opacity-80"
          style={{ backgroundColor: LIME, color: INK, fontSize: 12, fontWeight: 600, padding: "10px 16px", borderRadius: 8 }}>
          <Send size={13} /> {t("result.requestReview")}
        </button>
      )}

      <div className="mt-4 flex items-center gap-2" style={{ padding: 12, borderRadius: 8, backgroundColor: INNER }}>
        <Clock className="h-3 w-3" style={{ color: DIM }} />
        <span style={{ fontSize: 11, color: DIM }}>{t("result.responseTimeNotice")}</span>
      </div>
    </div>
  );
}

function AnswerReviewSection({ t, review, correctCount, passed, accent }: { t: TFn; review: ReviewItem[]; correctCount: number; passed: boolean; accent: string }) {
  const pct = review.length ? Math.round((correctCount / review.length) * 100) : 0;
  return (
    <div className="mx-6 mt-8">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--fg)" }}>{t("result.answerReview")}</h2>
          <p style={{ fontSize: 12, color: DIM }}>{t("result.answeredCorrectly", { correct: correctCount, total: review.length })}</p>
        </div>
        <div className="flex items-center gap-2">
          <div style={{ width: 128, height: 6, borderRadius: 9999, backgroundColor: "var(--border)" }}>
            <div style={{ height: "100%", borderRadius: 9999, backgroundColor: LIME, width: `${pct}%` }} />
          </div>
          <span className="tabular-nums" style={{ fontSize: 11, fontWeight: 600, color: accent }}>{pct}%</span>
        </div>
      </div>

      <div className="flex flex-col" style={{ gap: 12 }}>
        {review.map((r, i) => <AnswerCard key={r.questionId} t={t} q={r} index={i} />)}
      </div>
    </div>
  );
}

function AnswerCard({ t, q, index }: { t: TFn; q: ReviewItem; index: number }) {
  const passed = !!q.correct;
  return (
    <div style={{ borderRadius: 12, overflow: "hidden", backgroundColor: CARD, border: `1px solid ${passed ? "color-mix(in oklch, var(--color-brand-500) 10%, transparent)" : "rgba(239,68,68,0.10)"}` }}>
      <div className="flex items-start gap-3" style={{ padding: "20px 20px 16px" }}>
        {passed ? <CheckCircle2 className="mt-0.5 h-[18px] w-[18px] shrink-0" style={{ color: LIME }} /> : <XCircle className="mt-0.5 h-[18px] w-[18px] shrink-0" style={{ color: RED }} />}
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center justify-between gap-4">
            <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: DIM }}>{t("result.questionLabel", { n: index + 1 })}</span>
            <span className="tabular-nums" style={{ fontSize: 11, fontWeight: 600, color: passed ? LIME : RED }}>{q.awardedPoints ?? 0}/{q.points} {t("result.pts")}</span>
          </div>
          <p className="leading-relaxed" style={{ fontSize: 13, fontWeight: 500, color: "var(--fg)" }}><MathText>{q.prompt}</MathText></p>
        </div>
      </div>

      <div className="mx-5 mb-5 overflow-hidden" style={{ borderRadius: 8, backgroundColor: INNER }}>
        <div className="flex items-start gap-2.5" style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
          <X className="mt-0.5 h-[13px] w-[13px] shrink-0" style={{ color: RED }} />
          <div>
            <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, color: DIM }}>{t("result.yourAnswerLabel")}</p>
            <p className="italic" style={{ fontSize: 12, color: "rgba(239,68,68,0.75)" }}>{q.yourAnswer && q.yourAnswer.trim() ? q.yourAnswer : t("result.blank")}</p>
          </div>
        </div>
        {!passed && q.correctAnswer && (
          <div className="flex items-start gap-2.5" style={{ padding: "12px 16px" }}>
            <CheckCircle2 className="mt-0.5 h-[13px] w-[13px] shrink-0" style={{ color: LIME }} />
            <div>
              <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, color: DIM }}>{t("result.correctAnswerLabel")}</p>
              <p className="font-mono" style={{ fontSize: 12, color: LIME }}>{q.correctAnswer}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
