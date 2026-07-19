import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft, Loader2, CheckCircle2, XCircle, Award, ShieldAlert, User, Mail, Send, Gauge, Film, Clock, Download, EyeOff, Scale,
} from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MediaStimulus } from "@/components/MediaStimulus";
import { api } from "@/lib/api";
import { useT, type TFn } from "@/lib/i18n";
import type { Attempt, Certificate, Exam, GradingStatus, ProctorEvent, RubricCriterion } from "@shared/types";
import { clsx } from "clsx";

const SEV_KEY: Record<string, string> = { high: "common.high", warning: "common.warning", low: "aar.sevLow", info: "aar.sevInfo" };

interface ReviewItem {
  answerId: string | null;
  questionId: string;
  prompt: string;
  type: string;
  points: number;
  yourAnswer: string;
  correctAnswer: string;
  correct: boolean | null;
  awardedPoints: number;
  needsReview: boolean;
  gradedBy: "auto" | "manual" | null;
  feedback: string | null;
  rubric: RubricCriterion[] | null;
  rubricScores: Record<string, number> | null;
  explanation: string | null;
  fileUpload: { name: string; type: string; data: string } | null;
  answerFormat: string | null;
  media: { kind: string | null; urls: string[]; externalUrl: string | null; passageText: string | null } | null;
}
interface Deduction { type: string; severity: string; count: number; weight: number; deducted: number; }
interface IntegrityBreakdown { base: number; score: number; totalDeducted: number; deductions: Deduction[]; }
interface SnapshotFrame { id: string; dataUrl: string; at: string; }
interface Resp {
  attempt: Attempt; exam: Exam; candidate: { name: string; email: string };
  review: ReviewItem[]; proctorEvents: ProctorEvent[]; certificate: Certificate | null;
  integrity: number; integrityBreakdown: IntegrityBreakdown; studentRef: string | null;
  gradingStatus: GradingStatus; pendingCount: number;
  verificationPhoto: string | null; snapshot: string | null; snapshots: SnapshotFrame[];
  registrationId: string; idDocumentPhoto: string | null; idVerified: boolean; idVerifiedBy: string | null; roomScanPhotos: string[];
  anonymous: boolean;
  secondMark: { graderId: string; graderName: string; score: number; at: string } | null;
}

export function AdminAttemptReview() {
  const t = useT();
  const { attemptId } = useParams();
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [releasing, setReleasing] = useState(false);

  const load = useCallback(() => {
    api.get<Resp>(`/admin/attempts/${attemptId}`).then(setData).catch((e) => setError(e.message));
  }, [attemptId]);

  useEffect(() => { load(); }, [load]);

  if (error) return <AdminShell wide><p className="text-sm text-rose-400">{error}</p></AdminShell>;
  if (!data) return <AdminShell wide><div className="flex items-center gap-2 text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}</div></AdminShell>;

  const { attempt, exam, candidate, review, proctorEvents, certificate, integrity, integrityBreakdown, studentRef, verificationPhoto, snapshots, gradingStatus, pendingCount, anonymous, secondMark, idDocumentPhoto, idVerified, idVerifiedBy, registrationId, roomScanPhotos } = data;
  const correctCount = review.filter((r) => r.correct).length;
  const pending = gradingStatus === "pending_review";

  async function recordSecondMark(score: number) {
    setSaving("__second");
    try {
      await api.post(`/admin/attempts/${attemptId}/second-mark`, { score });
      load();
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(null); }
  }

  async function gradeAnswer(answerId: string, awardedPoints: number, feedback: string, rubricScores?: Record<string, number>) {
    setSaving(answerId);
    try {
      await api.patch(`/admin/answers/${answerId}/grade`, { awardedPoints, feedback, rubricScores });
      load();
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(null); }
  }

  async function release() {
    setReleasing(true);
    try {
      await api.post(`/admin/attempts/${attemptId}/release`);
      load();
    } catch (e) { setError((e as Error).message); }
    finally { setReleasing(false); }
  }

  async function verifyId(regId: string, verified: boolean) {
    setSaving("__id");
    try {
      await api.post(`/admin/registrations/${regId}/verify-id`, { verified });
      load();
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(null); }
  }

  return (
    <AdminShell wide>
      <div className="fade-in max-w-3xl">
        <Breadcrumbs current={anonymous ? undefined : candidate.name} />
        <Link to="/admin/grading" className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--fg)]">
          <ArrowLeft className="h-4 w-4" /> {t("aar.gradingQueue")}
        </Link>

        <div className="card mt-4 overflow-hidden">
          <div className={clsx("flex items-center justify-between gap-4 p-6",
            pending ? "bg-amber-500/15" : attempt.passed ? "bg-emerald-500/15" : "bg-rose-500/15")}>
            <div>
              <div className="flex items-center gap-2">
                {pending
                  ? <ClipboardPending />
                  : attempt.passed ? <CheckCircle2 className="h-6 w-6 text-emerald-400" /> : <XCircle className="h-6 w-6 text-rose-400" />}
                <h1 className="text-3xl font-extrabold tabular-nums">{attempt.score}%</h1>
                <GradingBadge t={t} status={gradingStatus} />
              </div>
              <p className={clsx("mt-1 text-sm font-semibold",
                pending ? "text-amber-400" : attempt.passed ? "text-emerald-400" : "text-rose-400")}>
                {pending
                  ? t("aar.provisional", { n: pendingCount })
                  : `${t(attempt.passed ? "aar.passed" : "aar.didNotPass")} · ${t("aar.correctOf", { n: correctCount, total: review.length })}`}
              </p>
            </div>
            <div className="text-right text-sm">
              <p className="flex items-center justify-end gap-1.5 font-medium">{anonymous ? <EyeOff className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />} {candidate.name}</p>
              {anonymous
                ? <p className="flex items-center justify-end gap-1 text-xs font-semibold text-brand-400">{t("aar.anonymousGrading")}</p>
                : <p className="flex items-center justify-end gap-1.5 text-xs text-[var(--muted)]"><Mail className="h-3 w-3" /> {candidate.email}</p>}
              {studentRef && <p className="text-xs text-[var(--muted)]">{t("aar.idPrefix", { ref: studentRef })}</p>}
              <p className="mt-1 text-xs text-[var(--muted)]">{exam.title}</p>
              <p className="mt-1 text-xs">
                {t("aar.integrity")} <span className={clsx("font-semibold", integrity >= 80 ? "text-emerald-400" : integrity >= 60 ? "text-amber-400" : "text-rose-400")}>{integrity}/100</span>
              </p>
            </div>
          </div>

          {pending && (
            <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] bg-[var(--card)] px-6 py-3">
              <p className="text-xs text-[var(--muted)]">
                {t("aar.releaseHint", { cert: exam.passingScore ? t("aar.releaseHintCert") : "" })}
              </p>
              <button
                onClick={release}
                disabled={pendingCount > 0 || releasing}
                className="btn btn-primary disabled:opacity-50"
                title={pendingCount > 0 ? t("aar.gradeAllFirst") : t("aar.publishToCandidate")}
              >
                {releasing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {t("aar.releaseResults")}
              </button>
            </div>
          )}

          {certificate && (
            <div className="flex items-center gap-2 border-t border-[var(--border)] px-6 py-3 text-sm">
              <Award className="h-4 w-4 text-amber-500" /> {t("aar.certificate")} <span className="font-mono text-xs">{certificate.certNumber}</span>
            </div>
          )}
        </div>

        <SecondMarkerPanel t={t} firstScore={attempt.score ?? 0} secondMark={secondMark} saving={saving === "__second"} onRecord={recordSecondMark} />

        {exam.proctored && (
          <IntegrityCard t={t} integrity={integrity} breakdown={integrityBreakdown} eventCount={proctorEvents.length} />
        )}

        {!anonymous && idDocumentPhoto && (
          <div className="card mt-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold"><User className="h-4 w-4 text-brand-400" /> {t("aar.identityVerification")}</div>
              {idVerified
                ? <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> {t("aar.idVerified")}{idVerifiedBy ? t("aar.verifiedBySuffix", { by: idVerifiedBy }) : ""}</span>
                : <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-400"><ShieldAlert className="h-3.5 w-3.5" /> {t("aar.notVerified")}</span>}
            </div>
            <p className="mt-1 text-xs text-[var(--muted)]">{t("aar.compareHint")}</p>
            <div className="mt-3 flex flex-wrap gap-4">
              <figure>
                {verificationPhoto
                  ? <img src={verificationPhoto} alt={t("aar.checkinSelfie")} className="h-36 w-48 rounded-lg object-cover ring-1 ring-[var(--border)]" />
                  : <div className="flex h-36 w-48 items-center justify-center rounded-lg bg-[var(--card-2)] text-xs text-[var(--muted)] ring-1 ring-[var(--border)]">{t("aar.noSelfie")}</div>}
                <figcaption className="mt-1 text-center text-[11px] text-[var(--muted)]">{t("aar.checkinSelfie")}</figcaption>
              </figure>
              <figure>
                <img src={idDocumentPhoto} alt={t("aar.photoId")} className="h-36 w-56 rounded-lg object-contain bg-[var(--bg-subtle)] ring-1 ring-[var(--border)]" />
                <figcaption className="mt-1 text-center text-[11px] text-[var(--muted)]">{t("aar.photoId")}</figcaption>
              </figure>
            </div>
            <div className="mt-4 flex items-center gap-2">
              {idVerified
                ? <button onClick={() => verifyId(registrationId, false)} disabled={saving === "__id"} className="btn btn-outline h-9">{saving === "__id" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {t("aar.clearVerification")}</button>
                : <button onClick={() => verifyId(registrationId, true)} disabled={saving === "__id"} className="btn btn-primary h-9">{saving === "__id" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} {t("aar.confirmIdMatches")}</button>}
            </div>
          </div>
        )}

        {!anonymous && roomScanPhotos.length > 0 && (
          <div className="card mt-4 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold"><Film className="h-4 w-4 text-brand-400" /> {t("aar.roomScan")}
              <span className="text-xs font-normal text-[var(--muted)]">{t("aar.roomScanFrames", { n: roomScanPhotos.length })}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-3">
              {roomScanPhotos.map((f, i) => (
                <img key={i} src={f} alt={`${t("aar.roomScan")} ${i + 1}`} className="h-28 w-40 rounded-lg object-cover ring-1 ring-[var(--border)]" />
              ))}
            </div>
          </div>
        )}

        {exam.proctored && (verificationPhoto || snapshots.length > 0) && (
          <div className="card mt-4 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold"><Film className="h-4 w-4 text-brand-400" /> {t("aar.webcamTimeline")}
              <span className="text-xs font-normal text-[var(--muted)]">{t("aar.framesCount", { n: snapshots.length })}</span>
            </div>
            {verificationPhoto && (
              <div className="mt-3">
                <p className="mb-1 text-xs text-[var(--muted)]">{t("aar.checkinVerification")}</p>
                <img src={verificationPhoto} alt={t("aar.checkinVerification")} className="h-32 w-44 rounded-lg object-cover ring-1 ring-[var(--border)]" />
              </div>
            )}
            {snapshots.length > 0 ? (
              <div className="mt-3 flex gap-3 overflow-x-auto pb-2">
                {snapshots.map((s) => (
                  <figure key={s.id} className="shrink-0">
                    <img src={s.dataUrl} alt="Frame" className="h-24 w-32 rounded-lg object-cover ring-1 ring-[var(--border)]" />
                    <figcaption className="mt-1 text-center text-[10px] text-[var(--muted)]">{new Date(s.at).toLocaleTimeString()}</figcaption>
                  </figure>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs text-[var(--muted)]">{t("aar.noLiveFrames")}</p>
            )}
          </div>
        )}

        {(exam.proctored || proctorEvents.length > 0) && (
          <div className="card mt-4 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold"><ShieldAlert className="h-4 w-4 text-brand-400" /> {t("aar.eventTimeline")}</div>
            {proctorEvents.length === 0 ? (
              <p className="mt-2 text-sm text-emerald-400">{t("aar.noFlags")}</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {proctorEvents.map((e) => (
                  <li key={e.id} className="flex items-center justify-between rounded-lg bg-[var(--bg)] px-3 py-2 text-xs">
                    <span className="capitalize">{e.type.replace(/_/g, " ")} — {e.message}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-[var(--muted)]">{new Date(e.at).toLocaleTimeString()}</span>
                      <span className={clsx("font-semibold", e.severity === "high" ? "text-rose-400" : e.severity === "warning" ? "text-amber-400" : "text-[var(--muted)]")}>{t(SEV_KEY[e.severity] ?? e.severity)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <h2 className="mt-6 text-sm font-semibold">{t("aar.answers")}</h2>
        <div className="mt-3 space-y-3">
          {review.map((r, i) => (
            <AnswerCard
              key={r.questionId}
              t={t}
              index={i}
              item={r}
              saving={saving === r.answerId}
              onGrade={(pts, fb, rs) => r.answerId && gradeAnswer(r.answerId, pts, fb, rs)}
            />
          ))}
        </div>
      </div>
    </AdminShell>
  );
}

function IntegrityCard({ t, integrity, breakdown, eventCount }: {
  t: TFn; integrity: number; breakdown: IntegrityBreakdown; eventCount: number;
}) {
  const tone = integrity >= 80 ? "emerald" : integrity >= 60 ? "amber" : "rose";
  const toneText = tone === "emerald" ? "text-emerald-400" : tone === "amber" ? "text-amber-400" : "text-rose-400";
  const toneBar = tone === "emerald" ? "bg-emerald-500" : tone === "amber" ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="card mt-4 p-5">
      <div className="flex items-center gap-2 text-sm font-semibold"><Gauge className="h-4 w-4 text-brand-400" /> {t("aar.integrityBreakdown")}</div>
      <div className="mt-3 flex items-center gap-4">
        <div className="text-center">
          <p className={clsx("font-display text-3xl font-semibold tabular-nums", toneText)}>{integrity}</p>
          <p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">/ 100</p>
        </div>
        <div className="flex-1">
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
            <div className={clsx("h-full rounded-full", toneBar)} style={{ width: `${integrity}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-[var(--muted)]">
            {eventCount === 0
              ? t("aar.cleanNoDeductions")
              : t("aar.startedAt100", { n: breakdown.totalDeducted, f: eventCount })}
          </p>
        </div>
      </div>
      {breakdown.deductions.length > 0 && (
        <table className="mt-4 w-full text-xs">
          <thead className="text-[var(--muted)]">
            <tr className="text-left">
              <th className="pb-1 font-medium">{t("aar.flagType")}</th>
              <th className="pb-1 text-center font-medium">{t("aar.severity")}</th>
              <th className="pb-1 text-center font-medium">{t("aar.count")}</th>
              <th className="pb-1 text-right font-medium">{t("aar.deducted")}</th>
            </tr>
          </thead>
          <tbody>
            {breakdown.deductions.map((d) => (
              <tr key={d.type} className="border-t border-[var(--border)]">
                <td className="py-1.5 capitalize">{d.type.replace(/_/g, " ")}</td>
                <td className="py-1.5 text-center">
                  <span className={clsx("font-semibold", d.severity === "high" ? "text-rose-400" : d.severity === "warning" ? "text-amber-400" : "text-[var(--muted)]")}>{t(SEV_KEY[d.severity] ?? d.severity)}</span>
                </td>
                <td className="py-1.5 text-center tabular-nums">{d.count} × {d.weight}</td>
                <td className="py-1.5 text-right font-semibold tabular-nums text-rose-400">−{d.deducted}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ClipboardPending() {
  return <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500 text-white"><Clock className="h-3.5 w-3.5" /></span>;
}

function GradingBadge({ t, status }: { t: TFn; status: GradingStatus }) {
  const map: Record<GradingStatus, { labelKey: string; cls: string }> = {
    auto_graded: { labelKey: "aar.autoGraded", cls: "bg-[var(--card-2)] text-[var(--muted)]" },
    pending_review: { labelKey: "aar.pendingReview", cls: "bg-amber-500/20 text-amber-400" },
    released: { labelKey: "aar.released", cls: "bg-emerald-500/20 text-emerald-400" },
  };
  const m = map[status];
  return <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-semibold", m.cls)}>{t(m.labelKey)}</span>;
}

function SecondMarkerPanel({ t, firstScore, secondMark, saving, onRecord }: {
  t: TFn; firstScore: number; secondMark: { graderName: string; score: number; at: string } | null; saving: boolean; onRecord: (score: number) => void;
}) {
  const [val, setVal] = useState("");
  const diff = secondMark ? Math.abs(firstScore - secondMark.score) : 0;
  const flagged = diff >= 10; // ≥10-point gap → reconcile
  return (
    <div className="card mt-4 p-5">
      <div className="flex items-center gap-2 text-sm font-semibold"><Scale className="h-4 w-4 text-brand-400" /> {t("aar.secondMarker")}</div>
      <p className="mt-0.5 text-xs text-[var(--muted)]">{t("aar.secondMarkerHint")}</p>
      {secondMark ? (
        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
          <span>{t("aar.firstMark")} <span className="font-bold tabular-nums">{firstScore}%</span></span>
          <span>{t("aar.secondMark")} <span className="font-bold tabular-nums">{secondMark.score}%</span> <span className="text-xs text-[var(--muted)]">{t("aar.byGrader", { name: secondMark.graderName })}</span></span>
          <span className={clsx("rounded-full px-2.5 py-0.5 text-xs font-semibold", flagged ? "bg-rose-500/15 text-rose-400" : "bg-emerald-500/15 text-emerald-400")}>
            {flagged ? t("aar.discrepancy", { n: diff }) : t("aar.agreement", { n: diff })}
          </span>
          <button onClick={() => onRecord(Number(val))} disabled={!val || saving} className="ml-auto text-xs text-brand-400 hover:underline disabled:opacity-40">{t("aar.reRecord")}</button>
          <input type="number" min={0} max={100} value={val} onChange={(e) => setVal(e.target.value)} placeholder={t("aar.newPh")} className="input h-8 w-20 text-sm" />
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-[var(--muted)]">{t("aar.independentScore")}</span>
          <input type="number" min={0} max={100} value={val} onChange={(e) => setVal(e.target.value)} placeholder="0–100" className="input h-9 w-24" />
          <button onClick={() => onRecord(Number(val))} disabled={!val || saving} className="btn btn-outline h-9 disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scale className="h-4 w-4" />} {t("aar.recordSecondMark")}</button>
        </div>
      )}
    </div>
  );
}

function AnswerCard({ t, index, item, saving, onGrade }: {
  t: TFn; index: number; item: ReviewItem; saving: boolean; onGrade: (pts: number, fb: string, rubricScores?: Record<string, number>) => void;
}) {
  const [pts, setPts] = useState(item.awardedPoints);
  const [fb, setFb] = useState(item.feedback ?? "");
  const [scores, setScores] = useState<Record<string, number>>(item.rubricScores ?? {});
  const hasRubric = !!item.rubric?.length;
  const rubricTotal = (item.rubric ?? []).reduce((s, c) => s + Math.max(0, Math.min(c.maxPoints, Number(scores[c.id]) || 0)), 0);
  const isMedia = item.type === "media_comprehension";
  const gradeable = !!item.answerId && (
    item.type === "short" || item.type === "essay" || item.type === "code" || item.type === "file_upload"
    || (isMedia && (item.answerFormat === "short" || item.answerFormat === "essay"))
  );
  const icon = item.correct === true
    ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
    : item.needsReview
      ? <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-amber-400" />
      : <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" />;

  return (
    <div className={clsx("card p-4", item.needsReview && "ring-1 ring-amber-300")}>
      <div className="flex items-start gap-3">
        {icon}
        <div className="flex-1">
          <p className="text-sm font-medium">
            {index + 1}. {item.prompt}{" "}
            <span className="text-xs text-[var(--muted)]">{t("aar.ptsSuffix", { a: item.awardedPoints, p: item.points })}{item.gradedBy === "manual" ? t("aar.manualSuffix") : ""}</span>
          </p>
          <p className="mt-1.5 text-xs text-[var(--muted)]">
            {t("aar.answerLabel")} <span className={clsx("font-medium", item.correct ? "text-emerald-400" : item.needsReview ? "text-amber-400" : "text-rose-400")}>{item.yourAnswer || t("aar.blank")}</span>
          </p>
          {item.media && (
            <div className="mt-2 max-w-md">
              <MediaStimulus
                mediaKind={(item.media.kind as "audio" | "video" | "image" | "pdf" | "passage" | null) ?? "passage"}
                mediaUrls={item.media.urls}
                mediaExternalUrl={item.media.externalUrl ?? undefined}
                passageText={item.media.passageText ?? undefined}
              />
            </div>
          )}
          {item.fileUpload && (
            <a href={item.fileUpload.data} download={item.fileUpload.name}
              className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-medium text-brand-400 hover:bg-[var(--card-2)]">
              <Download className="h-3.5 w-3.5" /> {t("aar.download", { name: item.fileUpload.name })}
            </a>
          )}
          {item.explanation && (
            <p className="mt-1.5 text-xs text-[var(--muted)]"><span className="font-semibold">{t("aar.explanationLabel")}</span> {item.explanation}</p>
          )}
          {(item.type === "short" || (isMedia && item.answerFormat === "short")) && (
            <p className="text-xs text-[var(--muted)]">{t("aar.reference")} <span className="font-medium text-emerald-400">{item.correctAnswer || "—"}</span></p>
          )}
          {!item.correct && item.type !== "short" && !(isMedia && item.answerFormat === "short") && (
            <p className="text-xs text-[var(--muted)]">{t("aar.correctLabel")} <span className="font-medium capitalize text-emerald-400">{item.correctAnswer}</span></p>
          )}

          {gradeable && (
            <div className="mt-3 space-y-3 rounded-lg bg-[var(--bg)] p-3">
              {hasRubric ? (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">{t("aar.rubric")}</p>
                  {item.rubric!.map((c) => (
                    <div key={c.id} className="flex items-center gap-2">
                      <span className="flex-1 text-sm">{c.label}</span>
                      <input
                        type="number" min={0} max={c.maxPoints} value={scores[c.id] ?? 0}
                        onChange={(e) => setScores((s) => ({ ...s, [c.id]: Math.max(0, Math.min(c.maxPoints, Number(e.target.value) || 0)) }))}
                        className="w-16 rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-sm tabular-nums"
                      />
                      <span className="w-10 text-xs text-[var(--muted)]">/ {c.maxPoints}</span>
                    </div>
                  ))}
                  <p className="pt-1 text-sm font-semibold">{t("aar.total")} <span className="tabular-nums text-brand-400">{rubricTotal}</span> / {item.points}</p>
                </div>
              ) : (
                <label className="text-xs font-medium text-[var(--muted)]">
                  {t("aar.awardPoints")}
                  <div className="mt-1 flex items-center gap-1">
                    <input
                      type="number" min={0} max={item.points} value={pts}
                      onChange={(e) => setPts(Math.max(0, Math.min(item.points, Number(e.target.value))))}
                      className="w-20 rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-sm tabular-nums"
                    />
                    <span className="text-xs text-[var(--muted)]">/ {item.points}</span>
                  </div>
                </label>
              )}
              <label className="block text-xs font-medium text-[var(--muted)]">
                {t("aar.feedbackOptional")}
                <input
                  type="text" value={fb} onChange={(e) => setFb(e.target.value)}
                  placeholder={t("aar.feedbackPh")}
                  className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-sm"
                />
              </label>
              <button onClick={() => onGrade(hasRubric ? rubricTotal : pts, fb, hasRubric ? scores : undefined)} disabled={saving} className="btn btn-primary disabled:opacity-50">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("aar.saveGrade")}
              </button>
            </div>
          )}

          {!gradeable && item.feedback && (
            <p className="mt-1.5 rounded-md bg-[var(--bg)] px-2 py-1 text-xs text-[var(--fg)]"><span className="font-semibold text-[var(--muted)]">{t("aar.feedbackLabel")}</span> {item.feedback}</p>
          )}
        </div>
      </div>
    </div>
  );
}
