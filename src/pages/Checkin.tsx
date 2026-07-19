import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import {
  Camera, Mic, Wifi, ScanFace, CheckCircle2, XCircle, Loader2, ArrowRight, ArrowLeft, ShieldCheck, ShieldAlert, FileCheck, MapPin, KeyRound,
} from "lucide-react";
import { Shell } from "@/components/Shell";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useProctoring } from "@/lib/proctoring";
import { useGeofence } from "@/lib/geofence";
import { detectIncognito } from "@/lib/incognito";
import { isRunningInSeb, sebLaunchHref } from "@/lib/seb";
import type { Attempt, Exam, PublicQuestion, Registration } from "@shared/types";

type CheckState = "pending" | "ok" | "fail";

function Row({ icon: Icon, label, hint, state }: { icon: typeof Camera; label: string; hint: string; state: CheckState }) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-[var(--border)] p-4">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--bg)] text-[var(--muted)]">
        <Icon className="h-5 w-5" />
      </div>
      <div className="flex-1">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-xs text-[var(--muted)]">{hint}</p>
      </div>
      {state === "pending" && <Loader2 className="h-5 w-5 animate-spin text-[var(--muted)]" />}
      {state === "ok" && <CheckCircle2 className="h-5 w-5 text-emerald-500" />}
      {state === "fail" && <XCircle className="h-5 w-5 text-rose-500" />}
    </div>
  );
}

export function Checkin() {
  const t = useT();
  const { registrationId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<{ registration: Registration; exam: Exam } | null>(null);
  const [netState, setNetState] = useState<CheckState>("pending");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [studentRef, setStudentRef] = useState("");
  const [examCode, setExamCode] = useState("");
  const [agree, setAgree] = useState({ rules: false, integrity: false, privacy: false });
  const [photo, setPhoto] = useState<string | null>(null);
  const [incognito, setIncognito] = useState<CheckState>("pending");

  const recheckPrivate = () => {
    setIncognito("pending");
    detectIncognito().then((p) => setIncognito(p ? "fail" : "ok")).catch(() => setIncognito("ok"));
  };
  useEffect(() => { recheckPrivate(); }, []);

  const proctored = data?.exam.proctored ?? false;
  const ld = data?.exam.lockdown;
  const webcamRule = ld?.webcam ?? true;
  const { videoRef, cameraReady, micReady, error: mediaError, faceStatus, retry: retryCamera } = useProctoring({ active: !!data && proctored && webcamRule });

  const requireGeofence = ld?.requireGeofence ?? false;
  const { state: geoState, error: geoError, distanceMeters: geoDistance, retry: retryGeo } = useGeofence({ active: !!data && requireGeofence, registrationId: data?.registration.id });

  const [idPhoto, setIdPhoto] = useState<string | null>(null);

  const capturePhoto = () => {
    const v = videoRef.current;
    if (!v || v.readyState < 2) return;
    const c = document.createElement("canvas");
    c.width = 320; c.height = 240;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, c.width, c.height);
    setPhoto(c.toDataURL("image/jpeg", 0.6));
  };

  // Capture the candidate's physical photo-ID — either snapped from the webcam or uploaded.
  const captureId = () => {
    const v = videoRef.current;
    if (!v || v.readyState < 2) return;
    const c = document.createElement("canvas");
    c.width = 480; c.height = 360;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, c.width, c.height);
    setIdPhoto(c.toDataURL("image/jpeg", 0.7));
  };
  const onIdFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) { setError("Please upload an image of your ID."); return; }
    const r = new FileReader();
    r.onload = () => setIdPhoto(typeof r.result === "string" ? r.result.slice(0, 600_000) : null);
    r.readAsDataURL(f);
  };

  // Room scan: capture a short series of webcam frames (one per second) while the
  // candidate slowly pans the camera around the room.
  const ROOM_SCAN_FRAMES = 6;
  const [roomScan, setRoomScan] = useState<string[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const recordRoomScan = () => {
    const v = videoRef.current;
    if (!v || v.readyState < 2) return;
    setScanning(true);
    const frames: string[] = [];
    const id = setInterval(() => {
      const c = document.createElement("canvas");
      c.width = 320; c.height = 240;
      const ctx = c.getContext("2d");
      if (ctx) { ctx.drawImage(v, 0, 0, c.width, c.height); frames.push(c.toDataURL("image/jpeg", 0.5)); }
      setRoomScan([...frames]);
      if (frames.length >= ROOM_SCAN_FRAMES) { clearInterval(id); setScanning(false); }
    }, 1000);
  };

  useEffect(() => {
    api.get<{ registration: Registration; exam: Exam }>(`/exams/${registrationId}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [registrationId]);

  // Network check — time a request to the API.
  useEffect(() => {
    if (!data) return;
    const t0 = performance.now();
    api.get("/health").then(() => {
      const ms = performance.now() - t0;
      setNetState(ms < 2000 ? "ok" : "fail");
    }).catch(() => setNetState("fail"));
  }, [data]);

  const needCam = proctored && webcamRule;
  const camState: CheckState = !needCam ? "ok" : cameraReady ? "ok" : mediaError ? "fail" : "pending";
  const micState: CheckState = !needCam ? "ok" : micReady ? "ok" : mediaError ? "fail" : "pending";
  const faceState: CheckState = !needCam || !(ld?.faceMonitoring ?? true)
    ? "ok"
    : faceStatus === "ok" || faceStatus === "unsupported" ? "ok"
    : faceStatus === "no_face" || faceStatus === "multiple" ? "fail" : "pending";

  // Agreement is required in both modes (default on); identity only applies to proctored exams.
  const requireAgreement = ld?.requireAgreement ?? true;
  const agreementItems: [keyof typeof agree, string][] = proctored
    ? [["rules", "I have read and agree to the Examination Rules."],
       ["integrity", "I agree to the Academic Integrity Policy."],
       ["privacy", "I consent to webcam/audio proctoring per the Privacy Notice."]]
    : [["rules", "I have read and agree to the Examination Rules."],
       ["integrity", "I agree to the Academic Integrity Policy."]];
  const identityOk = !(proctored && (ld?.requireIdentity ?? false)) || studentRef.trim().length > 0;
  const requireExamCode = ld?.requireExamCode ?? false;
  const examCodeOk = !requireExamCode || examCode.trim().toUpperCase() === (data?.exam.code || "").trim().toUpperCase();
  const requireIdDoc = proctored && (ld?.requireIdDocument ?? false);
  const idDocOk = !requireIdDoc || !!idPhoto;
  const requireRoomScan = proctored && (ld?.requireRoomScan ?? false);
  const roomScanOk = !requireRoomScan || (roomScan?.length ?? 0) >= ROOM_SCAN_FRAMES;
  const agreementOk = !requireAgreement || agreementItems.every(([k]) => agree[k]);
  // Private/incognito browsing is blocked for proctored exams (heuristic).
  const privateOk = !proctored || incognito === "ok";
  // Safe Exam Browser: when required, the exam can only start inside SEB.
  const sebRequired = !!ld?.requireSafeExamBrowser;
  const sebOk = !sebRequired || isRunningInSeb();
  const sebHref = sebLaunchHref(ld?.sebLaunchUrl);
  const checks = proctored ? [camState, micState, netState, faceState, incognito] : [netState];
  if (requireGeofence) checks.push(geoState);
  const allReady = checks.every((s) => s === "ok") && identityOk && idDocOk && roomScanOk && agreementOk && privateOk && sebOk && examCodeOk;

  const start = async () => {
    if (!data) return;
    setStarting(true);
    setError(null);
    try {
      await api.post(`/registrations/${data.registration.id}/checkin`, {
        studentRef: studentRef.trim(),
        accepted: agreementOk,
        verificationPhoto: photo,
        idDocumentPhoto: idPhoto,
        roomScan: roomScan ?? undefined,
        examCode: requireExamCode ? examCode.trim() : undefined,
      });
      const { attempt } = await api.post<{ attempt: Attempt; questions: PublicQuestion[] }>("/attempts", {
        registrationId: data.registration.id,
      });
      if (proctored && (ld?.fullscreen ?? true)) {
        try { await document.documentElement.requestFullscreen(); } catch { /* user can decline */ }
      }
      navigate(`/attempts/${attempt.id}/session`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the exam.");
      setStarting(false);
    }
  };

  if (error && !data) {
    return <Shell><p className="text-sm text-rose-400">{error}</p></Shell>;
  }
  if (!data) {
    return <Shell><div className="flex items-center gap-2 text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div></Shell>;
  }

  // ---- Agreement block (shared) ----
  const agreementBlock = requireAgreement && (
    <div className="rounded-xl border border-[var(--border)] p-4">
      <p className="text-sm font-semibold">{t("chk.agreement")}</p>
      <div className="mt-2 space-y-2">
        {agreementItems.map(([k, label]) => (
          <label key={k} className="flex cursor-pointer items-start gap-2 text-xs">
            <input type="checkbox" className="mt-0.5" checked={agree[k]} onChange={(e) => setAgree((a) => ({ ...a, [k]: e.target.checked }))} />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </div>
  );

  // ---- Exam code confirmation block (shared) ----
  const examCodeBlock = requireExamCode && (
    <div className="rounded-xl border border-[var(--border)] p-4">
      <label className="flex items-center gap-1.5 text-sm font-semibold"><KeyRound className="h-4 w-4" /> {t("chk.examCodeLabel")}</label>
      <p className="mb-2 mt-0.5 text-xs text-[var(--muted)]">{t("chk.examCodeHint")}</p>
      <input className="input h-9 uppercase tracking-wider" value={examCode} onChange={(e) => setExamCode(e.target.value)} placeholder={data.exam.code || ""} />
      {examCode.trim().length > 0 && !examCodeOk && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-rose-400"><XCircle className="h-3.5 w-3.5 shrink-0" /> {t("chk.examCodeMismatch")}</p>
      )}
    </div>
  );

  // ---- Location verification block (shared) ----
  const geoBlock = requireGeofence && (
    <>
      <Row icon={MapPin} label={t("chk.location")} hint={geoState === "ok" && geoDistance != null ? t("chk.locationVerifiedHint", { distance: geoDistance }) : t("chk.locationHint")} state={geoState} />
      {geoState === "fail" && geoError && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-500/30 bg-rose-500/15 px-4 py-3 text-xs text-rose-400">
          <span>{geoError}</span>
          <button onClick={retryGeo} className="btn btn-outline h-8 shrink-0 text-xs">{t("chk.retry")}</button>
        </div>
      )}
    </>
  );

  const startButton = (
    <>
      {sebRequired && !sebOk && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/15 p-4">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-rose-400">
            <ShieldAlert className="h-4 w-4" /> Safe Exam Browser required
          </p>
          <p className="mt-1 text-xs text-rose-400/90">
            This exam can only be taken inside Safe Exam Browser, which locks down your computer
            (no screenshots, screen recording, app-switching or other windows). Open it in SEB to continue.
          </p>
          {sebHref ? (
            <a href={sebHref} className="btn btn-primary mt-3 h-9 text-xs">Open in Safe Exam Browser</a>
          ) : (
            <p className="mt-3 text-xs text-rose-400/90">Ask your administrator for the Safe Exam Browser launch link / config file.</p>
          )}
        </div>
      )}
      {error && <div className="rounded-lg border border-rose-500/30 bg-rose-500/15 px-3 py-2 text-xs text-rose-400">{error}</div>}
      <button className="btn btn-primary mt-2 h-11 w-full" disabled={!allReady || starting} onClick={start}>
        {starting ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("chk.starting")}</> : <>{t("chk.startExam")} <ArrowRight className="h-4 w-4" /></>}
      </button>
      {!allReady && <p className="text-center text-xs text-[var(--muted)]">{proctored ? t("chk.completeChecks") : t("chk.acceptTerms")}</p>}
    </>
  );

  // ---- Non-proctored: terms-only, single column ----
  if (!proctored) {
    return (
      <Shell>
        <div className="fade-in max-w-xl">
          <Link to="/exams" className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--fg)]">
            <ArrowLeft className="h-4 w-4" /> Back to exams
          </Link>
          <h1 className="mt-3 text-2xl font-bold tracking-tight">{t("chk.readyToBegin")}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">{data.exam.title} · {data.exam.durationMinutes} min · Pass ≥ {data.exam.passingScore}%</p>

          <div className="mt-6 space-y-3">
            <div className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/15 p-4 text-sm text-emerald-500">
              <FileCheck className="h-5 w-5 shrink-0" />
              <span>{t("chk.notProctored")}</span>
            </div>
            <Row icon={Wifi} label={t("chk.network")} hint={t("chk.stableConnection")} state={netState} />
            {geoBlock}
            {examCodeBlock}
            {agreementBlock}
            {startButton}
          </div>
        </div>
      </Shell>
    );
  }

  // ---- Proctored: full system check, two columns ----
  return (
    <Shell>
      <div className="fade-in max-w-4xl">
        <Link to="/exams" className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--fg)]">
          <ArrowLeft className="h-4 w-4" /> Back to exams
        </Link>
        <h1 className="mt-3 text-2xl font-bold tracking-tight">{t("chk.systemCheck")}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">{data.exam.title} · This is an AI-proctored exam.</p>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_1fr]">
          <div className="space-y-3">
            <Row icon={Camera} label={t("chk.camera")} hint={t("chk.requiredForProctoring")} state={camState} />
            <Row icon={Mic} label={t("chk.microphone")} hint={t("chk.requiredForProctoring")} state={micState} />
            <Row icon={Wifi} label={t("chk.network")} hint={t("chk.stableConnection")} state={netState} />
            <Row icon={ScanFace} label={t("chk.identityFace")} hint={faceStatus === "unsupported" ? "Face analytics unavailable on this browser" : t("chk.faceVisible")} state={faceState} />
            <Row icon={ShieldAlert} label={t("chk.browserMode")} hint={incognito === "fail" ? "Private/incognito window detected — reopen in a normal window" : "Normal (non-private) browsing window"} state={incognito} />
            {geoBlock}

            {incognito === "fail" && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-500/30 bg-rose-500/15 px-4 py-3 text-xs text-rose-400">
                <span>This looks like a private/incognito window, which isn't allowed for proctored exams. Reopen this exam in a normal window, then re-check.</span>
                <button onClick={recheckPrivate} className="btn btn-outline h-8 shrink-0 text-xs">Re-check</button>
              </div>
            )}

            {(ld?.requireIdentity ?? false) && (
              <div className="rounded-xl border border-[var(--border)] p-4">
                <label className="block text-sm font-semibold">Identity verification</label>
                <p className="mb-2 mt-0.5 text-xs text-[var(--muted)]">Enter your student ID / registration number.</p>
                <input className="input h-9" value={studentRef} onChange={(e) => setStudentRef(e.target.value)} placeholder="e.g. UG-2026-04412" />
              </div>
            )}

            {requireIdDoc && (
              <div className="rounded-xl border border-[var(--border)] p-4">
                <label className="block text-sm font-semibold">Photo ID</label>
                <p className="mb-2 mt-0.5 text-xs text-[var(--muted)]">Provide a clear photo of your government or institution photo-ID. A proctor compares it with your webcam.</p>
                {idPhoto && <img src={idPhoto} alt="Your ID document" className="mb-2 h-28 w-44 rounded-md bg-[var(--bg)] object-contain ring-1 ring-[var(--border)]" />}
                <div className="flex flex-wrap gap-2">
                  <label className="btn btn-outline h-8 cursor-pointer text-xs">
                    <FileCheck className="h-3.5 w-3.5" /> {idPhoto ? "Replace" : "Upload ID"}
                    <input type="file" accept="image/*" className="hidden" onChange={onIdFile} />
                  </label>
                  {needCam && <button onClick={captureId} disabled={!cameraReady} className="btn btn-outline h-8 text-xs"><Camera className="h-3.5 w-3.5" /> Snap with camera</button>}
                  {idPhoto && <button onClick={() => setIdPhoto(null)} className="btn btn-ghost h-8 text-xs">Clear</button>}
                </div>
              </div>
            )}

            {requireRoomScan && (
              <div className="rounded-xl border border-[var(--border)] p-4">
                <label className="block text-sm font-semibold">Room scan</label>
                <p className="mb-2 mt-0.5 text-xs text-[var(--muted)]">Slowly pan your webcam around your room (desk, walls, doorway) while we capture a few frames for the proctor.</p>
                {roomScan && roomScan.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {roomScan.map((f, i) => <img key={i} src={f} alt="" className="h-12 w-16 rounded-md object-cover ring-1 ring-[var(--border)]" />)}
                  </div>
                )}
                <button onClick={recordRoomScan} disabled={!cameraReady || scanning || roomScanOk} className="btn btn-outline h-8 text-xs disabled:opacity-50">
                  {scanning ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Scanning… {roomScan?.length ?? 0}/{ROOM_SCAN_FRAMES}</>
                    : roomScanOk ? <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> Room scan captured</>
                    : <><Camera className="h-3.5 w-3.5" /> Record room scan</>}
                </button>
              </div>
            )}

            {examCodeBlock}
            {agreementBlock}

            <div className="rounded-xl border border-brand-500/30 bg-brand-500/15 p-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-brand-400"><ShieldAlert className="h-3.5 w-3.5" /> Active lockdown rules</p>
              <ul className="mt-2 grid grid-cols-1 gap-1 text-xs text-[var(--muted)]">
                {ld?.fullscreen && <li>• Fullscreen is enforced; exiting is flagged</li>}
                {ld?.blockCopyPaste && <li>• Copy, paste and text selection are disabled</li>}
                {ld?.blockShortcuts && <li>• Risky keyboard shortcuts are blocked</li>}
                <li>• Screenshot / screen-capture shortcuts are blocked and logged</li>
                {ld?.tabSwitchDetection && <li>• Switching tabs, apps or desktops is detected and logged</li>}
                <li>• Private/incognito windows are not permitted</li>
                {ld?.requireSafeExamBrowser && <li className="font-medium text-brand-400">• Safe Exam Browser is required — full OS-level lockdown (no screenshots or recording)</li>}
                {(ld?.violationLimit ?? 0) > 0
                  ? <li>• Exam auto-submits after {ld?.violationLimit} violations</li>
                  : <li className="font-medium text-rose-400">• Zero tolerance — any violation submits your exam immediately</li>}
              </ul>
            </div>

            {mediaError && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/15 px-3 py-2 text-xs text-rose-400">
                <p>{mediaError}</p>
                <button onClick={retryCamera} className="btn btn-outline mt-2 h-7 border-rose-500/40 text-xs text-rose-400 hover:bg-rose-500/20">
                  Retry camera access
                </button>
              </div>
            )}
            {startButton}
          </div>

          <div className="card overflow-hidden">
            <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3 text-sm font-semibold">
              <ShieldCheck className="h-4 w-4 text-brand-400" /> {t("chk.cameraPreview")}
            </div>
            <div className="relative aspect-video bg-black">
              <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
              {faceStatus !== "unsupported" && (
                <div className="absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-1 text-xs text-white">
                  {faceStatus === "ok" ? "Face detected" : faceStatus === "no_face" ? "No face detected" : faceStatus === "multiple" ? "Multiple faces" : "Analysing…"}
                </div>
              )}
            </div>
            {needCam && (
              <div className="flex items-center gap-3 border-t border-[var(--border)] px-4 py-3">
                {photo ? (
                  <img src={photo} alt="Verification" className="h-12 w-16 rounded-md object-cover ring-1 ring-[var(--border)]" />
                ) : (
                  <div className="flex h-12 w-16 items-center justify-center rounded-md bg-[var(--bg)] text-[10px] text-[var(--muted)]">No photo</div>
                )}
                <div className="flex-1 text-xs text-[var(--muted)]">{photo ? "Verification photo captured." : "Capture a verification photo of yourself."}</div>
                <button onClick={capturePhoto} disabled={!cameraReady} className="btn btn-outline h-8 text-xs">
                  <Camera className="h-3.5 w-3.5" /> {photo ? "Retake" : "Capture"}
                </button>
              </div>
            )}
            <p className="px-4 py-3 text-xs text-[var(--muted)]">
              Your camera feed is monitored during the exam. Keep your face visible and stay in fullscreen.
            </p>
          </div>
        </div>
      </div>
    </Shell>
  );
}
