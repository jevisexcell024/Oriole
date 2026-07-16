import { useCallback, useEffect, useRef, useState } from "react";
import { checkPermissionsPolicy } from "./permissionsPolicyCheck";

export type FaceStatus = "ok" | "no_face" | "multiple" | "unsupported" | "pending";

export interface ProctorEventInput {
  type: "face_missing" | "multiple_faces" | "tab_blur" | "fullscreen_exit" | "system_check" | "audio_noise";
  severity: "info" | "warning" | "high";
  message: string;
}

interface Options {
  active: boolean;
  onEvent?: (e: ProctorEventInput) => void;
  /** Listen on the microphone for sustained talking/noise and flag it. */
  audioMonitoring?: boolean;
}

// Chrome's experimental FaceDetector — typed loosely since it isn't in lib.dom.
type FaceDetectorLike = { detect: (src: CanvasImageSource) => Promise<unknown[]> };
declare global {
  interface Window {
    FaceDetector?: new (opts?: { fastMode?: boolean; maxDetectedFaces?: number }) => FaceDetectorLike;
  }
}

/** For NotAllowedError/SecurityError specifically: a rejection here looks
 *  identical whether a person clicked "Block" or the *server* is blocking the
 *  feature outright via its Permissions-Policy header (no prompt is ever shown
 *  in the latter case, so "click the camera icon to allow" is actively wrong
 *  advice). Reading back the real header distinguishes the two so the message
 *  — and who needs to act on it — is actually correct. */
async function policySpecificReason(feature: "camera" | "microphone"): Promise<string | null> {
  const policy = await checkPermissionsPolicy();
  if (policy.fetchError) return null; // can't tell — fall back to the generic message
  const state = policy[feature];
  if (state === "allowed") return null; // genuinely a user/device-level denial
  return state === "blocked"
    ? `This site's server configuration is blocking ${feature} access outright (Permissions-Policy: ${feature}=()) — no permission prompt was ever shown, and this isn't something you can fix from your device. Contact your administrator.`
    : `This site's server configuration doesn't explicitly allow ${feature} access, and the browser may be silently refusing it. Contact your administrator if Retry doesn't work.`;
}

async function mediaErrorMessage(err: unknown): Promise<string> {
  if (!navigator.mediaDevices) {
    return "Camera access requires a secure HTTPS connection. Please contact your administrator.";
  }
  if (err instanceof DOMException) {
    switch (err.name) {
      case "NotAllowedError":
        return (await policySpecificReason("camera"))
          ?? "Camera/microphone access was denied. Click the camera icon in your browser's address bar to allow access, then click Retry.";
      case "NotFoundError":
        return "No camera or microphone was found. Please connect a webcam and click Retry.";
      case "NotReadableError":
        return "Your camera is in use by another application. Close other apps using the camera (video calls, etc.) and click Retry.";
      case "OverconstrainedError":
        return "Your camera doesn't meet the video requirements. Try a different browser or camera, then click Retry.";
      case "SecurityError":
        return (await policySpecificReason("camera"))
          ?? "Camera access is blocked by a browser security policy. Make sure the page is loaded over HTTPS.";
      default:
        return `Camera error: ${err.message}. Click Retry to try again.`;
    }
  }
  return "Could not access camera or microphone. Click Retry to try again.";
}

export function useProctoring({ active, onEvent, audioMonitoring }: Options) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<FaceDetectorLike | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [micReady, setMicReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [faceStatus, setFaceStatus] = useState<FaceStatus>("pending");
  const [violations, setViolations] = useState(0);
  // Incrementing this triggers the camera acquisition useEffect to re-run.
  const [retryCount, setRetryCount] = useState(0);

  const emit = useCallback(
    (e: ProctorEventInput) => {
      if (e.severity !== "info") setViolations((v) => v + 1);
      onEvent?.(e);
    },
    [onEvent],
  );

  // Acquire camera + mic.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    // Clear previous error so the UI shows "pending" while we try again.
    setError(null);
    setCameraReady(false);
    setMicReady(false);
    setFaceStatus("pending");
    (async () => {
      // Guard: mediaDevices is only available in secure contexts (HTTPS / localhost).
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Camera access requires a secure HTTPS connection. Please contact your administrator.");
        return;
      }
      try {
        // Use `ideal` constraints — they express a preference, not a hard requirement,
        // so the browser picks the closest available resolution instead of throwing
        // OverconstrainedError when the device can't hit exactly 640×480.
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: { ideal: "user" } },
          audio: true,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        setCameraReady(stream.getVideoTracks().length > 0);
        setMicReady(stream.getAudioTracks().length > 0);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        if (window.FaceDetector) {
          try {
            detectorRef.current = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 3 });
            setFaceStatus("pending");
          } catch {
            setFaceStatus("unsupported");
          }
        } else {
          setFaceStatus("unsupported");
        }
      } catch (err) {
        if (!cancelled) {
          setError(await mediaErrorMessage(err));
          setCameraReady(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [active, retryCount]);

  // Periodic face detection.
  useEffect(() => {
    if (!active || !cameraReady || !detectorRef.current) return;
    let lastState: FaceStatus = "ok";
    const interval = setInterval(async () => {
      const video = videoRef.current;
      const detector = detectorRef.current;
      if (!video || !detector || video.readyState < 2) return;
      try {
        const faces = await detector.detect(video);
        let state: FaceStatus = "ok";
        if (faces.length === 0) state = "no_face";
        else if (faces.length > 1) state = "multiple";
        setFaceStatus(state);
        if (state !== lastState && state !== "ok") {
          emit({
            type: state === "no_face" ? "face_missing" : "multiple_faces",
            severity: state === "multiple" ? "high" : "warning",
            message:
              state === "no_face"
                ? "No face detected in frame."
                : "Multiple faces detected in frame.",
          });
        }
        lastState = state;
      } catch {
        /* ignore transient detection errors */
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [active, cameraReady, emit]);

  // Audio monitoring: listen on the mic for SUSTAINED loud audio (talking) and flag
  // it. Uses the Web Audio API on the existing mic stream — no recording is stored.
  // Debounced so a single conversation doesn't spam flags.
  useEffect(() => {
    if (!active || !audioMonitoring || !micReady) return;
    const stream = streamRef.current;
    if (!stream || stream.getAudioTracks().length === 0) return;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    let raf = 0;
    let ctx: AudioContext | null = null;
    let loudMs = 0;
    let lastFlag = 0;
    let prev = performance.now();
    try {
      ctx = new AC();
      const srcNode = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      srcNode.connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / buf.length); // 0..1
        const now = performance.now();
        const dt = now - prev; prev = now;
        // Accumulate time spent above the talking threshold; decay quickly when quiet.
        if (rms > 0.12) loudMs += dt; else loudMs = Math.max(0, loudMs - dt * 1.5);
        if (loudMs > 2500 && now - lastFlag > 15000) {
          lastFlag = now; loudMs = 0;
          emit({ type: "audio_noise", severity: "warning", message: "Sustained talking or background noise detected." });
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    } catch { /* Web Audio unavailable — skip audio monitoring */ }
    return () => { cancelAnimationFrame(raf); ctx?.close().catch(() => {}); };
  }, [active, audioMonitoring, micReady, emit]);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraReady(false);
  }, []);

  /** Re-request camera/mic access — useful after a permission denial or device error. */
  const retry = useCallback(() => setRetryCount((c) => c + 1), []);

  return { videoRef, cameraReady, micReady, error, faceStatus, violations, stop, retry };
}
