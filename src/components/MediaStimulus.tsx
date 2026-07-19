import { useEffect, useRef, useState } from "react";
import { ZoomIn, ZoomOut, Maximize2, X } from "lucide-react";
import type { Question } from "@shared/types";
import { sendBeaconJson } from "@/lib/api";
import { MathText } from "@/lib/richtext";
import { clsx } from "clsx";

interface Props {
  /** Undefined in the Exam Builder's own preview — no candidate attempt to log analytics against there. */
  attemptId?: string;
  mediaKind: "audio" | "video" | "image" | "pdf" | "passage";
  /** Authenticated, ownership-checked URLs (see GET /api/attempts/:id/media/:assetId) — never raw data. */
  mediaUrls: string[];
  mediaExternalUrl?: string;
  mediaConfig?: Question["mediaConfig"];
  passageText?: string;
}

/** Shared stimulus renderer for media_comprehension questions — used by both the
 *  Exam Builder's author preview and the Session candidate runner, so the
 *  candidate-facing security posture (no download, no context menu, no PiP,
 *  best-effort replay/seek limits) only has to be implemented once. */
export function MediaStimulus({ attemptId, mediaKind, mediaUrls, mediaExternalUrl, mediaConfig, passageText }: Props) {
  const cfg = mediaConfig ?? {};
  const src = mediaUrls[0] || mediaExternalUrl || "";

  const log = (type: "media_play" | "media_pause" | "media_replay" | "media_completed") => {
    if (!attemptId) return;
    sendBeaconJson(`/attempts/${attemptId}/proctor-event`, { type, severity: "info", message: `${mediaKind} ${type.slice(6)}` });
  };

  const blockContextMenu = (e: React.MouseEvent) => e.preventDefault();

  if (mediaKind === "passage") {
    return (
      <div className="max-h-[420px] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--card-2)] p-4 text-sm leading-relaxed" onContextMenu={blockContextMenu}>
        <MathText>{passageText || ""}</MathText>
      </div>
    );
  }

  if (mediaKind === "image") {
    return <ImageStimulus urls={mediaUrls} onOpen={() => log("media_play")} />;
  }

  if (mediaKind === "pdf") {
    return (
      <div className="overflow-hidden rounded-xl border border-[var(--border)]" style={{ height: 480 }} onContextMenu={blockContextMenu}>
        {src ? (
          <iframe src={src} title="Document" className="h-full w-full bg-white" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">No document uploaded.</div>
        )}
      </div>
    );
  }

  return <AvStimulus kind={mediaKind} src={src} config={cfg} onLog={log} />;
}

// ── Audio / Video ──

function AvStimulus({ kind, src, config, onLog }: {
  kind: "audio" | "video";
  src: string;
  config: NonNullable<Question["mediaConfig"]>;
  onLog: (t: "media_play" | "media_pause" | "media_replay" | "media_completed") => void;
}) {
  const ref = useRef<HTMLMediaElement | null>(null);
  const wasPlayingRef = useRef(false);
  const lastAllowedTimeRef = useRef(0);
  const playCountRef = useRef(0);
  const [replaysUsed, setReplaysUsed] = useState(0);
  const [countdown, setCountdown] = useState(config.countdownSeconds ?? 0);
  const [ready, setReady] = useState(!config.countdownSeconds);
  const [rate, setRate] = useState(1);

  useEffect(() => {
    if (!config.countdownSeconds) { setReady(true); return; }
    setReady(false);
    setCountdown(config.countdownSeconds);
    const id = window.setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) { window.clearInterval(id); setReady(true); return 0; }
        return c - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  useEffect(() => { if (ref.current) ref.current.playbackRate = rate; }, [rate]);

  const replayLimit = config.replayLimit ?? 0;
  const limitReached = replayLimit > 0 && replaysUsed >= replayLimit;

  const onPlay = () => {
    if (limitReached && ref.current) { ref.current.pause(); return; }
    wasPlayingRef.current = true;
    playCountRef.current += 1;
    if (playCountRef.current > 1) { setReplaysUsed((n) => n + 1); onLog("media_replay"); }
    onLog("media_play");
  };
  const onPause = () => { if (wasPlayingRef.current) onLog("media_pause"); wasPlayingRef.current = false; };
  const onEnded = () => { onLog("media_completed"); wasPlayingRef.current = false; };
  const onTimeUpdate = () => { if (ref.current && !ref.current.seeking) lastAllowedTimeRef.current = ref.current.currentTime; };
  // Best-effort: this app can't truly prevent a determined user from seeking a
  // native player — this snaps an out-of-order seek back, same "deterrence,
  // not a guarantee" posture as the rest of the exam lockdown system.
  const onSeeking = () => {
    if (config.allowSeek === false && ref.current && Math.abs(ref.current.currentTime - lastAllowedTimeRef.current) > 0.75) {
      ref.current.currentTime = lastAllowedTimeRef.current;
    }
  };
  const blockContextMenu = (e: React.MouseEvent) => e.preventDefault();

  if (!ready) {
    return (
      <div className="flex h-20 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--card-2)] text-sm text-[var(--muted)]">
        Starting in {countdown}s…
      </div>
    );
  }

  const mediaProps = {
    ref: ref as never,
    src,
    controls: true,
    controlsList: config.preventDownload === false ? undefined : "nodownload noplaybackrate",
    autoPlay: !!config.autoplay,
    onPlay, onPause, onEnded, onTimeUpdate, onSeeking,
    onContextMenu: blockContextMenu,
    className: "w-full rounded-xl border border-[var(--border)] bg-black",
  };

  return (
    <div className="relative">
      {kind === "video"
        ? <video {...mediaProps} disablePictureInPicture playsInline style={{ maxHeight: 420 }} />
        : <audio {...mediaProps} />}
      {limitReached && (
        <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/70 text-xs font-medium text-white">
          Replay limit reached ({replayLimit}/{replayLimit})
        </div>
      )}
      <div className="mt-1.5 flex items-center gap-3 text-xs text-[var(--muted)]">
        {replayLimit > 0 && <span>Plays used: {Math.min(playCountRef.current, replayLimit)}/{replayLimit}</span>}
        {config.playbackSpeedControl && (
          <label className="flex items-center gap-1.5">
            Speed
            <select value={rate} onChange={(e) => setRate(Number(e.target.value))} className="rounded border border-[var(--border)] bg-[var(--card-2)] px-1 py-0.5 text-xs">
              {[0.75, 1, 1.25, 1.5].map((r) => <option key={r} value={r}>{r}x</option>)}
            </select>
          </label>
        )}
      </div>
    </div>
  );
}

// ── Image(s) — zoom / pan / fullscreen / side-by-side ──

function ImageStimulus({ urls, onOpen }: { urls: string[]; onOpen: () => void }) {
  const [fullscreenIdx, setFullscreenIdx] = useState<number | null>(null);
  if (urls.length === 0) return <div className="rounded-xl border border-[var(--border)] bg-[var(--card-2)] p-6 text-center text-sm text-[var(--muted)]">No image uploaded.</div>;

  return (
    <>
      <div className={clsx("grid gap-2", urls.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
        {urls.map((u, i) => (
          <button
            key={u}
            type="button"
            onClick={() => { setFullscreenIdx(i); onOpen(); }}
            onContextMenu={(e) => e.preventDefault()}
            className="group relative overflow-hidden rounded-xl border border-[var(--border)] bg-black"
          >
            <img src={u} alt={`Exhibit ${i + 1}`} className="max-h-72 w-full select-none object-contain" draggable={false} />
            <span className="absolute bottom-2 right-2 rounded-full bg-black/60 p-1.5 opacity-0 transition group-hover:opacity-100"><Maximize2 className="h-3.5 w-3.5 text-white" /></span>
          </button>
        ))}
      </div>
      {fullscreenIdx !== null && (
        <ImageLightbox urls={urls} index={fullscreenIdx} onClose={() => setFullscreenIdx(null)} onChangeIndex={setFullscreenIdx} />
      )}
    </>
  );
}

function ImageLightbox({ urls, index, onClose, onChangeIndex }: { urls: string[]; index: number; onClose: () => void; onChangeIndex: (i: number) => void }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, [index]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (zoom <= 1) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pan.x, origY: pan.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const { startX, startY, origX, origY } = dragRef.current;
    setPan({ x: origX + (e.clientX - startX), y: origY + (e.clientY - startY) });
  };
  const onPointerUp = () => { dragRef.current = null; };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95" onContextMenu={(e) => e.preventDefault()}>
      <div className="flex items-center justify-between p-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setZoom((z) => Math.max(1, z - 0.5))} className="rounded-lg bg-white/10 p-2 text-white hover:bg-white/20"><ZoomOut className="h-4 w-4" /></button>
          <button type="button" onClick={() => setZoom((z) => Math.min(4, z + 0.5))} className="rounded-lg bg-white/10 p-2 text-white hover:bg-white/20"><ZoomIn className="h-4 w-4" /></button>
          {urls.length > 1 && (
            <div className="ml-2 flex gap-1">
              {urls.map((_, i) => (
                <button key={i} type="button" onClick={() => onChangeIndex(i)} className={clsx("h-7 w-7 rounded-md text-xs font-medium", i === index ? "bg-[#c6ff34] text-[#111110]" : "bg-white/10 text-white hover:bg-white/20")}>{i + 1}</button>
              ))}
            </div>
          )}
        </div>
        <button type="button" onClick={onClose} className="rounded-lg bg-white/10 p-2 text-white hover:bg-white/20"><X className="h-4 w-4" /></button>
      </div>
      <div className="flex flex-1 items-center justify-center overflow-hidden" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
        <img
          src={urls[index]}
          alt={`Exhibit ${index + 1}, enlarged`}
          className="max-h-full max-w-full select-none"
          draggable={false}
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, cursor: zoom > 1 ? "grab" : "default", transition: dragRef.current ? "none" : "transform 0.15s" }}
        />
      </div>
    </div>
  );
}
