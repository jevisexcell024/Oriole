import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  CheckCircle2, XCircle, ArrowLeft, Loader2, ShieldAlert, Hourglass, Award, MessageSquareWarning, Send, X,
} from "lucide-react";
import { Shell } from "@/components/Shell";
import { api } from "@/lib/api";
import { MathText } from "@/lib/richtext";
import { useT } from "@/lib/i18n";
import type { Attempt, Certificate, Exam, GradingStatus, ProctorEvent } from "@shared/types";
import { clsx } from "clsx";

interface ReviewItem {
  questionId: string;
  prompt: string;
  type: string;
  yourAnswer: string;
  correctAnswer: string;
  correct: boolean | null;
  awardedPoints: number | null;
  feedback: string | null;
  explanation: string | null;
  points: number;
  rubric: { id: string; label: string; maxPoints: number }[] | null;
  rubricScores: Record<string, number> | null;
}
interface ResultResp {
  attempt: Attempt;
  exam: Exam;
  review: ReviewItem[];
  certificate: Certificate | null;
  proctorEvents: ProctorEvent[];
  gradingStatus: GradingStatus;
  held?: boolean;
  releaseAt?: string | null;
  letter?: string | null;
  canAppeal?: boolean;
  regrade?: { status: "open" | "resolved" | "rejected"; reason: string; response: string | null; createdAt: string } | null;
}

export function Result() {
  const t = useT();
  const { attemptId } = useParams();
  const [data, setData] = useState<ResultResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appealOpen, setAppealOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [appealBusy, setAppealBusy] = useState(false);
  const [submittedAppeal, setSubmittedAppeal] = useState<ResultResp["regrade"]>(null);

  useEffect(() => {
    api.get<ResultResp>(`/attempts/${attemptId}/result`).then(setData).catch((e) => setError(e.message));
  }, [attemptId]);

  const submitAppeal = async () => {
    setAppealBusy(true);
    try {
      const r = await api.post<{ regrade: ResultResp["regrade"] }>(`/attempts/${attemptId}/regrade`, { reason });
      setSubmittedAppeal(r.regrade);
      setAppealOpen(false);
    } catch (e) { alert((e as Error).message); }
    finally { setAppealBusy(false); }
  };

  if (error) return <Shell><p className="text-sm text-rose-400">{error}</p></Shell>;
  if (!data) return <Shell><div className="flex items-center gap-2 text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}</div></Shell>;

  const { attempt, exam, review, proctorEvents, gradingStatus } = data;
  const held = data.held ?? false;
  // `pending` = hide marks/answers (either awaiting grading, or held for scheduled release).
  const pending = gradingStatus === "pending_review" || held;
  const passed = attempt.passed;
  const correctCount = review.filter((r) => r.correct).length;
  const fmtRelease = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");

  return (
    <Shell>
      <div className="fade-in max-w-4xl">
        <Link to="/exams" className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--fg)]">
          <ArrowLeft className="h-4 w-4" /> {t("result.back")}
        </Link>

        {/* Score hero */}
        <div className={clsx("card mt-4 overflow-hidden")}>
          {pending ? (
            <div className="flex flex-col items-center gap-3 bg-amber-500/15 p-8 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-500 text-white">
                <Hourglass className="h-9 w-9" />
              </div>
              <div>
                <h1 className="text-2xl font-extrabold">{held ? t("result.pendingReleaseTitle") : t("result.awaitingTitle")}</h1>
                <p className="mt-1 text-sm font-semibold text-amber-400">
                  {held ? t("result.pendingReleaseMsg") : t("result.awaitingMsg")}
                </p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {held && data.releaseAt
                    ? t("result.heldSub", { exam: exam.title, date: fmtRelease(data.releaseAt) })
                    : t("result.awaitingSub", { exam: exam.title })}
                </p>
              </div>
            </div>
          ) : (
            <div className={clsx("flex flex-col items-center gap-3 p-8 text-center",
              passed ? "bg-emerald-500/15" : "bg-rose-500/15")}>
              <div className={clsx("flex h-16 w-16 items-center justify-center rounded-full",
                passed ? "bg-emerald-500 text-white" : "bg-rose-500 text-white")}>
                {passed ? <CheckCircle2 className="h-9 w-9" /> : <XCircle className="h-9 w-9" />}
              </div>
              <div>
                <h1 className="text-3xl font-extrabold tabular-nums">{attempt.score}%{data.letter && <span className="ml-2 align-middle text-xl">· {t("result.grade")} {data.letter}</span>}</h1>
                <p className={clsx("mt-1 text-sm font-semibold", passed ? "text-emerald-400" : "text-rose-400")}>
                  {passed ? t("result.passed") : t("result.failed")}
                </p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {t("result.scoreSub", { exam: exam.title, correct: correctCount, total: review.length, pass: exam.passingScore })}
                </p>
                {passed && exam.proctored && <Link to="/certificates" className="btn btn-primary mt-4 h-9"><Award className="h-4 w-4" /> {t("result.viewCertificate")}</Link>}
              </div>
            </div>
          )}
        </div>

        {/* Proctoring summary */}
        {exam.proctored && (
          <div className="card mt-4 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <ShieldAlert className="h-4 w-4 text-brand-400" /> {t("result.proctoringSummary")}
            </div>
            {proctorEvents.length === 0 ? (
              <p className="mt-2 text-sm text-emerald-400">{t("result.cleanSession")}</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {proctorEvents.map((e) => (
                  <li key={e.id} className="flex items-center justify-between rounded-lg bg-[var(--bg)] px-3 py-2 text-xs">
                    <span className="capitalize">{e.type.replace(/_/g, " ")} — {e.message}</span>
                    <span className={clsx("font-semibold",
                      e.severity === "high" ? "text-rose-400" : e.severity === "warning" ? "text-amber-400" : "text-[var(--muted)]")}>
                      {e.severity}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Regrade / appeal */}
        {(() => {
          const appeal = submittedAppeal ?? data.regrade ?? null;
          if (!appeal && !(data.canAppeal && !pending)) return null;
          return (
            <div className="card mt-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold"><MessageSquareWarning className="h-4 w-4 text-brand-400" /> {t("result.resultReview")}</div>
                {!appeal && (
                  <button onClick={() => setAppealOpen(true)} className="btn btn-outline h-9 text-sm"><MessageSquareWarning className="h-4 w-4" /> {t("result.requestReview")}</button>
                )}
              </div>
              {appeal ? (
                <div className="mt-3 space-y-2 text-sm">
                  <p className="flex items-center gap-2">
                    {t("result.statusLabel")}
                    <span className={clsx("rounded-full px-2 py-0.5 text-xs font-semibold",
                      appeal.status === "open" ? "bg-amber-500/15 text-amber-400" : appeal.status === "resolved" ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400")}>
                      {appeal.status === "open" ? t("result.underReview") : appeal.status === "resolved" ? t("result.reviewed") : t("result.declined")}
                    </span>
                  </p>
                  <p className="text-xs text-[var(--muted)]">{t("result.yourReason")} {appeal.reason}</p>
                  {appeal.response && <p className="rounded-md bg-[var(--bg)] px-2.5 py-2 text-xs"><span className="font-semibold text-[var(--muted)]">{t("result.examinerResponse")}</span> {appeal.response}</p>}
                </div>
              ) : (
                <p className="mt-1 text-xs text-[var(--muted)]">{t("result.reviewPrompt")}</p>
              )}
            </div>
          );
        })()}

        {/* Answer review */}
        <h2 className="mt-6 text-lg font-semibold">{t("result.answerReview")}</h2>
        {pending && (
          <p className="mt-1 text-xs text-[var(--muted)]">{t("result.marksLater")}</p>
        )}
        <div className="mt-3 space-y-3">
          {review.map((r, i) => (
            <div key={r.questionId} className="card p-4">
              <div className="flex items-start gap-3">
                {pending
                  ? <Hourglass className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
                  : r.correct ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" /> : <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" />}
                <div className="flex-1">
                  <p className="text-sm font-medium">
                    {i + 1}. <MathText>{r.prompt}</MathText>
                    {!pending && <span className="text-xs text-[var(--muted)]"> · {r.awardedPoints}/{r.points} {t("result.pts")}</span>}
                  </p>
                  <p className="mt-1.5 text-xs text-[var(--muted)]">
                    {t("result.yourAnswer")} <span className={clsx("font-medium capitalize", pending ? "text-[var(--fg)]" : r.correct ? "text-emerald-400" : "text-rose-400")}>{r.yourAnswer || t("result.blank")}</span>
                  </p>
                  {!pending && !r.correct && r.correctAnswer && (
                    <p className="text-xs text-[var(--muted)]">
                      {t("result.correctAnswer")} <span className="font-medium capitalize text-emerald-400">{r.correctAnswer}</span>
                    </p>
                  )}
                  {!pending && r.rubric && r.rubric.length > 0 && r.rubricScores && (
                    <div className="mt-2 rounded-md bg-[var(--bg)] px-2.5 py-2">
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">{t("result.rubric")}</p>
                      <div className="space-y-0.5">
                        {r.rubric.map((c) => (
                          <div key={c.id} className="flex items-center justify-between text-xs">
                            <span className="text-[var(--muted)]">{c.label}</span>
                            <span className="font-medium tabular-nums">{r.rubricScores?.[c.id] ?? 0}/{c.maxPoints}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {!pending && r.explanation && (
                    <p className="mt-1.5 rounded-md bg-brand-500/10 px-2.5 py-1.5 text-xs"><span className="font-semibold text-brand-400">{t("result.explanation")}</span> <MathText>{r.explanation}</MathText></p>
                  )}
                  {!pending && r.feedback && (
                    <p className="mt-1.5 rounded-md bg-[var(--bg)] px-2 py-1 text-xs"><span className="font-semibold text-[var(--muted)]">{t("result.feedback")}</span> {r.feedback}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {appealOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setAppealOpen(false)}>
          <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">{t("result.requestReviewTitle")}</h2>
              <button onClick={() => setAppealOpen(false)} className="rounded p-1 text-[var(--muted)] hover:text-[var(--fg)]"><X className="h-4 w-4" /></button>
            </div>
            <p className="mt-1 text-sm text-[var(--muted)]">{t("result.requestReviewDesc")}</p>
            <textarea className="input mt-3 min-h-[120px] w-full resize-y" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("result.reasonPlaceholder")} />
            <div className="mt-4 flex items-center justify-end gap-2">
              <button onClick={() => setAppealOpen(false)} className="btn btn-outline h-10">{t("result.cancel")}</button>
              <button onClick={submitAppeal} disabled={reason.trim().length < 10 || appealBusy} className="btn btn-primary h-10 disabled:opacity-50">
                {appealBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {t("result.submitRequest")}
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
