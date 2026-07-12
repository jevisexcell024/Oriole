import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft, XCircle, CheckCircle2, ShieldAlert, MessageSquare, Send, X, AlertTriangle, Clock, ChevronRight,
  Loader2, Award, Hourglass,
} from "lucide-react";
import { Shell } from "@/components/Shell";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { MathText } from "@/lib/richtext";
import { useT, type TFn } from "@/lib/i18n";
import type { Attempt, Certificate, Exam, GradingStatus, ProctorEvent } from "@shared/types";

// ── Design tokens ────────────────────────────────────────────────────────
const LIME = "#c8f53d";
const RED = "#ef4444";
const ORANGE = "#fb923c";
const CARD = "#1a1a1a";
const INNER = "#212121";
const DIM = "#7a7a8a";
const BG = "#0f0f0f";

interface ReviewItem {
  questionId: string; prompt: string; type: string; yourAnswer: string; correctAnswer: string;
  correct: boolean | null; awardedPoints: number | null; feedback: string | null; explanation: string | null;
  points: number; rubric: { id: string; label: string; maxPoints: number }[] | null; rubricScores: Record<string, number> | null;
}
interface ResultResp {
  attempt: Attempt; exam: Exam; review: ReviewItem[]; certificate: Certificate | null; proctorEvents: ProctorEvent[];
  gradingStatus: GradingStatus; held?: boolean; releaseAt?: string | null; letter?: string | null;
  canAppeal?: boolean; regrade?: { status: "open" | "resolved" | "rejected"; reason: string; response: string | null; createdAt: string } | null;
}

const SEVERITY_META: Record<string, { color: string; bg: string; labelKey: string }> = {
  high: { color: RED, bg: "rgba(239,68,68,0.12)", labelKey: "result.severityHigh" },
  warning: { color: ORANGE, bg: "rgba(251,146,60,0.12)", labelKey: "result.severityWarning" },
  info: { color: DIM, bg: "rgba(122,122,138,0.12)", labelKey: "result.severityInfo" },
};

export function Result() {
  const t = useT();
  const { attemptId } = useParams();
  const [data, setData] = useState<ResultResp | null>(null);
  const [error, setError] = useState<string | null>(null);

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
          {pending ? <PendingHero t={t} data={data} exam={exam} held={held} /> : <ResolvedView t={t} data={data} attemptId={attemptId!} />}
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
      <ChevronRight className="h-3 w-3" style={{ color: "rgba(122,122,138,0.4)" }} />
      <span className="truncate" style={{ fontSize: 12, color: "#9a9a9a" }}>{examTitle}</span>
    </div>
  );
}

// ── Pending / held state (unchanged real behaviour, restyled minimally) ──
function PendingHero({ t, data, exam, held }: { t: TFn; data: ResultResp; exam: Exam; held: boolean }) {
  const fmtRelease = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");
  return (
    <div className="mx-6 flex flex-col items-center gap-3 p-8 text-center" style={{ borderRadius: 16, background: "rgba(251,146,60,0.1)", border: "1px solid rgba(251,146,60,0.2)" }}>
      <div className="flex h-16 w-16 items-center justify-center rounded-full" style={{ background: ORANGE, color: "#0f0f0f" }}>
        <Hourglass className="h-9 w-9" />
      </div>
      <div>
        <h1 className="text-2xl font-extrabold" style={{ color: "#f0f0f0" }}>{held ? t("result.pendingReleaseTitle") : t("result.awaitingTitle")}</h1>
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
            style={{ background: LIME, color: "#0a0a0a", fontSize: 12, fontWeight: 600, padding: "10px 16px", borderRadius: 8 }}>
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
    ? "linear-gradient(145deg, #0a1e0e 0%, #0d1a0f 60%, #0a1614 100%)"
    : "linear-gradient(145deg, #1e0a0a 0%, #1a0d0d 60%, #160a14 100%)";

  const breakdown = [
    { label: t("result.correctLabel"), value: correctCountAll, color: LIME },
    { label: t("result.incorrectLabel"), value: incorrectCount, color: RED },
    { label: t("result.blankLabel"), value: blankCount, color: DIM },
    { label: t("result.totalPtsLabel"), value: `${earnedPts}/${totalPts}`, color: "#d0d0d0" },
  ];

  return (
    <div className="mx-6 overflow-hidden" style={{ borderRadius: 16, background: gradient, border: `1px solid ${accent}1f` }}>
      <div className="flex items-center justify-between" style={{ padding: "20px 24px 0" }}>
        <div>
          <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.12em", color: `${accent}99` }}>{t("result.examResultLabel")}</p>
          <p className="mt-1" style={{ fontSize: 13, fontWeight: 600, color: "#d0d0d0" }}>{exam.title}</p>
        </div>
        <span style={{ padding: "4px 12px", borderRadius: 999, background: `${accent}1f`, color: accent, border: `1px solid ${accent}33`, fontSize: 11, fontWeight: 600 }}>
          {passed ? t("common.pass") : t("common.fail")}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-6" style={{ padding: "32px" }}>
        <div className="flex items-center" style={{ gap: 32 }}>
          <div className="relative shrink-0" style={{ width: 120, height: 120 }}>
            <svg width={120} height={120} viewBox="0 0 120 120" style={{ transform: "rotate(-90deg)" }}>
              <circle cx={60} cy={60} r={52} fill="none" stroke={`${accent}1a`} strokeWidth={6} />
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
              <span style={{ fontSize: 16, fontWeight: 700, color: "#f0f0f0" }}>{passed ? t("result.passed") : t("result.failed")}</span>
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

      <div className="flex" style={{ borderTop: `1px solid ${accent}14` }}>
        {breakdown.map((b, i) => (
          <div key={b.label} className="flex flex-1 flex-col items-center" style={{ padding: "16px 0", borderRight: i < breakdown.length - 1 ? `1px solid ${accent}14` : undefined }}>
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
      <p style={{ fontSize: 13, fontWeight: 600, color: "#e0e0e0" }}>{value}</p>
    </div>
  );
}

function ProctoringPanel({ t, events }: { t: TFn; events: ProctorEvent[] }) {
  return (
    <div style={{ borderRadius: 16, padding: 20, backgroundColor: CARD, border: "1px solid rgba(255,255,255,0.06)" }}>
      <div className="mb-4 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: "rgba(251,146,60,0.12)" }}>
          <ShieldAlert className="h-[14px] w-[14px]" style={{ color: ORANGE }} />
        </span>
        <h2 style={{ fontSize: 13, fontWeight: 600, color: "#f0f0f0" }}>{t("result.proctoringSummary")}</h2>
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
                  <span className="leading-relaxed" style={{ fontSize: 12, color: "#d0d0d0" }}>
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
    <div style={{ borderRadius: 16, padding: 20, backgroundColor: CARD, border: "1px solid rgba(255,255,255,0.06)", gridColumn: spanFull ? "1 / -1" : undefined }}>
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: "rgba(200,245,61,0.1)" }}>
          <MessageSquare className="h-[14px] w-[14px]" style={{ color: LIME }} />
        </span>
        <h2 style={{ fontSize: 13, fontWeight: 600, color: "#f0f0f0" }}>{t("result.resultReview")}</h2>
      </div>

      <p className="mb-5 leading-relaxed" style={{ fontSize: 12, color: DIM }}>{t("result.reviewPrompt")}</p>

      {reviewSent ? (
        <div className="flex items-center gap-2" style={{ padding: 12, borderRadius: 8, backgroundColor: "rgba(200,245,61,0.08)", border: "1px solid rgba(200,245,61,0.15)" }}>
          <CheckCircle2 className="h-[14px] w-[14px]" style={{ color: LIME }} />
          <span style={{ fontSize: 12, fontWeight: 500, color: LIME }}>{t("result.reviewSubmitted")}</span>
        </div>
      ) : !canRequest ? null : open ? (
        <div>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("result.reasonPlaceholder")}
            className="w-full resize-y outline-none" style={{ minHeight: 80, background: INNER, border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 10, fontSize: 12, color: "#e0e0e0" }} />
          {err && <p className="mt-1.5" style={{ fontSize: 11, color: RED }}>{err}</p>}
          <div className="mt-2 flex items-center gap-2">
            <button onClick={submit} disabled={busy} className="flex items-center gap-2 transition hover:opacity-80 disabled:opacity-60"
              style={{ backgroundColor: LIME, color: "#0a0a0a", fontSize: 12, fontWeight: 600, padding: "10px 16px", borderRadius: 8 }}>
              {busy ? <Loader2 className="h-[13px] w-[13px] animate-spin" /> : <Send size={13} />} {t("result.submitRequest")}
            </button>
            <button onClick={() => { setOpen(false); setErr(null); }} className="transition hover:opacity-70" style={{ fontSize: 12, color: DIM, padding: "10px 12px" }}>
              <X size={13} />
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setOpen(true)} className="flex items-center gap-2 transition hover:opacity-80"
          style={{ backgroundColor: LIME, color: "#0a0a0a", fontSize: 12, fontWeight: 600, padding: "10px 16px", borderRadius: 8 }}>
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
          <h2 style={{ fontSize: 15, fontWeight: 700, color: "#f0f0f0" }}>{t("result.answerReview")}</h2>
          <p style={{ fontSize: 12, color: DIM }}>{t("result.answeredCorrectly", { correct: correctCount, total: review.length })}</p>
        </div>
        <div className="flex items-center gap-2">
          <div style={{ width: 128, height: 6, borderRadius: 9999, backgroundColor: "rgba(255,255,255,0.08)" }}>
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
    <div style={{ borderRadius: 12, overflow: "hidden", backgroundColor: CARD, border: `1px solid ${passed ? "rgba(200,245,61,0.10)" : "rgba(239,68,68,0.10)"}` }}>
      <div className="flex items-start gap-3" style={{ padding: "20px 20px 16px" }}>
        {passed ? <CheckCircle2 className="mt-0.5 h-[18px] w-[18px] shrink-0" style={{ color: LIME }} /> : <XCircle className="mt-0.5 h-[18px] w-[18px] shrink-0" style={{ color: RED }} />}
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center justify-between gap-4">
            <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: DIM }}>{t("result.questionLabel", { n: index + 1 })}</span>
            <span className="tabular-nums" style={{ fontSize: 11, fontWeight: 600, color: passed ? LIME : RED }}>{q.awardedPoints ?? 0}/{q.points} {t("result.pts")}</span>
          </div>
          <p className="leading-relaxed" style={{ fontSize: 13, fontWeight: 500, color: "#e8e8e8" }}><MathText>{q.prompt}</MathText></p>
        </div>
      </div>

      <div className="mx-5 mb-5 overflow-hidden" style={{ borderRadius: 8, backgroundColor: INNER }}>
        <div className="flex items-start gap-2.5" style={{ padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
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
