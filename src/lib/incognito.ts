// Best-effort private/incognito-mode detection.
//
// There is no official API for this, so we use the storage-quota heuristic that
// works across Chromium browsers: a private window is given a much smaller
// `navigator.storage.estimate().quota` (a few hundred MB at most) than a normal
// window (which is sized as a fraction of free disk — typically many GB). We
// treat a quota under ~700MB as private. This can't be defeated by simply
// hiding the window, and it has a low false-positive rate on modern hardware.
//
// Like all browser-side proctoring, it's a deterrent + signal, not a guarantee:
// it's surfaced as a check-in warning and recorded as a flag, not silently
// trusted. Returns false when detection isn't possible (older browsers).
export async function detectIncognito(): Promise<boolean> {
  try {
    const nav = navigator as Navigator & {
      storage?: { estimate?: () => Promise<{ quota?: number }> };
    };
    if (nav.storage?.estimate) {
      const { quota } = await nav.storage.estimate();
      if (typeof quota === "number" && quota > 0 && quota < 700 * 1024 * 1024) {
        return true;
      }
    }
  } catch {
    /* detection unavailable — fail open */
  }
  return false;
}
