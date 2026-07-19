import { useCallback, useEffect, useRef, useState } from "react";
import type { ProctorEventType, Severity } from "@shared/types";

export interface LockdownEvent {
  type: ProctorEventType;
  severity: Severity;
  message: string;
}

/**
 * Exam lockdown for proctored sessions. Best-effort browser-level hardening:
 *  - Forces fullscreen (exposes `fullscreen` so the UI can block the exam when it's lost)
 *  - Disables copy / cut / paste / text-selection / drag / right-click
 *  - Blocks risky shortcuts (Ctrl/Cmd+C/X/V/A/P/S/U, F12, devtools)
 *  - Deters screenshots: intercepts PrintScreen, wipes the clipboard, and blanks
 *    the screen (`obscured`) when focus is lost or PrintScreen is pressed
 * Every blocked action is reported via `onEvent` for the proctoring log.
 *
 * NOTE: a web page cannot truly prevent OS-level screen capture — that requires a
 * native lockdown browser. This maximises deterrence and records every attempt.
 */
export interface LockdownRules {
  fullscreen?: boolean;
  blockCopyPaste?: boolean;
  blockShortcuts?: boolean;
  tabSwitchDetection?: boolean;
}

export function useExamLockdown({
  active,
  onEvent,
  rules,
}: {
  active: boolean;
  onEvent?: (e: LockdownEvent) => void;
  rules?: LockdownRules;
}) {
  const r = {
    fullscreen: rules?.fullscreen ?? true,
    blockCopyPaste: rules?.blockCopyPaste ?? true,
    blockShortcuts: rules?.blockShortcuts ?? true,
    tabSwitchDetection: rules?.tabSwitchDetection ?? true,
  };
  const rulesRef = useRef(r);
  rulesRef.current = r;
  const [fullscreen, setFullscreen] = useState(
    typeof document !== "undefined" && !!document.fullscreenElement,
  );
  const [obscured, setObscured] = useState(false);
  // A second monitor lets a candidate read off-screen while the exam keeps focus
  // and stays fullscreen — surfaced as a blocking state, not just a flag.
  const [extraDisplay, setExtraDisplay] = useState(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const emit = useCallback((e: LockdownEvent) => onEventRef.current?.(e), []);
  // Switching away fires both `visibilitychange` and window `blur` near-simultaneously;
  // debounce those into a single flag, but keep re-flagging on every heartbeat tick for
  // as long as the candidate stays away — otherwise a single long absence (minutes) would
  // only ever cost one flag, letting a student sit outside the exam indefinitely no matter
  // how low the violation tolerance is configured.
  const awayFlaggedRef = useRef(false);
  const lastAwayFlagAtRef = useRef(0);
  const REFLAG_INTERVAL_MS = 3000;

  const requestFullscreen = useCallback(async () => {
    try { await document.documentElement.requestFullscreen(); } catch { /* user may decline */ }
  }, []);

  const clearObscured = useCallback(() => setObscured(false), []);

  useEffect(() => {
    if (!active) return;

    const onCopy = (e: ClipboardEvent) => {
      if (!rulesRef.current.blockCopyPaste) return;
      e.preventDefault();
      e.clipboardData?.setData("text/plain", "");
      emit({ type: "copy_attempt", severity: "warning", message: "Copying is disabled during this exam." });
    };
    const onCut = (e: ClipboardEvent) => {
      if (!rulesRef.current.blockCopyPaste) return;
      e.preventDefault();
      emit({ type: "copy_attempt", severity: "warning", message: "Cut is disabled during this exam." });
    };
    const onPaste = (e: ClipboardEvent) => {
      if (!rulesRef.current.blockCopyPaste) return;
      e.preventDefault();
      emit({ type: "paste_attempt", severity: "warning", message: "Pasting is disabled during this exam." });
    };
    const blockSelection = (e: Event) => { if (rulesRef.current.blockCopyPaste) e.preventDefault(); };

    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;

      // Screenshot deterrence is always on while locked. Covers the Windows
      // PrintScreen key, the Windows snip shortcut (Win/⊞+Shift+S) and the macOS
      // screenshot shortcuts (⌘+Shift+3/4/5). OS-level capture can't be blocked
      // outright from a web page, so we wipe the clipboard, blank the screen and
      // record a high-severity flag.
      const isWinSnip = e.shiftKey && e.metaKey && k === "s";
      const isMacShot = e.metaKey && e.shiftKey && ["3", "4", "5"].includes(e.key);
      if (e.key === "PrintScreen" || isWinSnip || isMacShot) {
        try { void navigator.clipboard?.writeText(""); } catch { /* needs focus */ }
        setObscured(true);
        window.setTimeout(() => setObscured(false), 1500);
        emit({ type: "screenshot_attempt", severity: "high", message: "Screenshot / screen-capture shortcut detected." });
        e.preventDefault();
        return;
      }
      if (rulesRef.current.blockShortcuts) {
        // Developer tools / view source / print / save
        if (e.key === "F12" || (mod && e.shiftKey && ["i", "j", "c"].includes(k)) || (mod && ["u", "p", "s"].includes(k))) {
          e.preventDefault();
          emit({ type: "shortcut_blocked", severity: "high", message: "A restricted keyboard shortcut was blocked." });
          return;
        }
      }
      if (rulesRef.current.blockCopyPaste && mod && ["c", "x", "v", "a"].includes(k)) {
        e.preventDefault();
        emit({ type: "shortcut_blocked", severity: "warning", message: `Shortcut ${e.metaKey ? "⌘" : "Ctrl"}+${k.toUpperCase()} is disabled.` });
      }
    };

    // Switching tab / app / virtual desktop (or minimising) blanks the exam and
    // records a flag. `visibilitychange` catches tab/minimise; window `blur`
    // catches alt-tab and desktop switches where the tab stays "visible".
    const flagAway = (message: string) => {
      if (!rulesRef.current.tabSwitchDetection) return;
      setObscured(true);
      const t = Date.now();
      if (awayFlaggedRef.current && t - lastAwayFlagAtRef.current < REFLAG_INTERVAL_MS) return;
      awayFlaggedRef.current = true;
      lastAwayFlagAtRef.current = t;
      emit({ type: "tab_blur", severity: "high", message });
    };
    const onHide = () => { if (document.hidden) flagAway("Candidate switched away from the exam (tab hidden or minimised)."); };
    const onBlur = () => flagAway("Candidate switched to another window, app or desktop.");
    const onFocus = () => { setObscured(false); awayFlaggedRef.current = false; };
    const onFsChange = () => {
      const fs = !!document.fullscreenElement;
      setFullscreen(fs);
      if (!fs && rulesRef.current.fullscreen) {
        emit({ type: "fullscreen_exit", severity: "high", message: "Candidate exited fullscreen mode." });
      }
    };

    // ── Second-display detection ──
    // `screen.isExtended` (Chromium) is true whenever more than one display is
    // connected. A second monitor is the classic "still fullscreen but cheating"
    // hole: the exam keeps focus + visibility, so blur/visibilitychange never
    // fire. We can't see the other screen, but we can detect it, flag it once,
    // and (via the UI) block the exam until it's disconnected.
    const scr = window.screen as unknown as {
      isExtended?: boolean;
      addEventListener?: (t: string, fn: () => void) => void;
      removeEventListener?: (t: string, fn: () => void) => void;
    };
    let wasExtended = false;
    const checkDisplays = () => {
      if (!rulesRef.current.tabSwitchDetection) { setExtraDisplay(false); return; }
      const ext = !!scr.isExtended;
      setExtraDisplay(ext);
      if (ext && !wasExtended) {
        emit({ type: "multi_monitor", severity: "high", message: "A second display was detected — disconnect extra monitors to continue." });
      }
      wasExtended = ext;
    };

    // ── Focus/visibility + Picture-in-Picture heartbeat ──
    // Safety net for cases the discrete blur/visibilitychange events miss, plus a
    // catch for Picture-in-Picture (an always-on-top window that doesn't blur the
    // exam) — close it and flag it.
    const docPip = document as Document & { pictureInPictureElement?: Element | null; exitPictureInPicture?: () => Promise<void> };
    const heartbeat = () => {
      if (docPip.pictureInPictureElement && rulesRef.current.tabSwitchDetection) {
        emit({ type: "tab_blur", severity: "high", message: "Picture-in-Picture was opened over the exam." });
        try { void docPip.exitPictureInPicture?.(); } catch { /* ignore */ }
      }
      if (document.hidden || !document.hasFocus()) flagAway("Candidate is not focused on the exam window.");
    };

    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    document.addEventListener("paste", onPaste);
    document.addEventListener("contextmenu", blockSelection);
    document.addEventListener("selectstart", blockSelection);
    document.addEventListener("dragstart", blockSelection);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("fullscreenchange", onFsChange);
    try { scr.addEventListener?.("change", checkDisplays); } catch { /* unsupported */ }
    const displayTimer = window.setInterval(checkDisplays, 5000);
    const heartbeatTimer = window.setInterval(heartbeat, 3000);
    checkDisplays();
    if (rulesRef.current.blockCopyPaste) document.body.classList.add("exam-lockdown");
    setFullscreen(!!document.fullscreenElement);

    return () => {
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCut);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("contextmenu", blockSelection);
      document.removeEventListener("selectstart", blockSelection);
      document.removeEventListener("dragstart", blockSelection);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("fullscreenchange", onFsChange);
      try { scr.removeEventListener?.("change", checkDisplays); } catch { /* unsupported */ }
      clearInterval(displayTimer);
      clearInterval(heartbeatTimer);
      document.body.classList.remove("exam-lockdown");
    };
  }, [active, emit]);

  return { fullscreen, obscured, extraDisplay, requestFullscreen, clearObscured };
}
