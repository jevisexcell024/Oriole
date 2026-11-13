/**
 * Connection Quality Detection
 *
 * Detects network conditions and classifies them into tiers for adaptive
 * bandwidth usage. Uses the Network Information API when available, with
 * latency-based fallback for broader browser support.
 */

export type ConnectionTier = "high" | "medium" | "low" | "critical";

export interface ConnectionQuality {
  tier: ConnectionTier;
  rttMs: number | null;
  downlinkMbps: number | null;
  effectiveType: string | null;
  /** True if using Network Information API, false if using latency fallback */
  apiAvailable: boolean;
}

interface NetworkInformation {
  readonly effectiveType: "slow-2g" | "2g" | "3g" | "4g";
  readonly rtt: number;
  readonly downlink: number;
  readonly saveData: boolean;
  onchange: ((this: NetworkInformation, ev: Event) => void) | null;
  addEventListener(type: "change", listener: () => void): void;
  removeEventListener(type: "change", listener: () => void): void;
}

declare global {
  interface Navigator {
    connection?: NetworkInformation;
    mozConnection?: NetworkInformation;
    webkitConnection?: NetworkInformation;
  }
}

/** Get the Network Information API connection object if available */
function getNetworkInfo(): NetworkInformation | null {
  return navigator.connection ?? navigator.mozConnection ?? navigator.webkitConnection ?? null;
}

/** Classify connection tier from Network Information API data */
function classifyFromApi(info: NetworkInformation): ConnectionTier {
  // If user has enabled data saver, respect it
  if (info.saveData) return "low";

  const { effectiveType, downlink, rtt } = info;

  // Primary classification by effective type
  if (effectiveType === "slow-2g") return "critical";
  if (effectiveType === "2g") return "low";

  // For 3g/4g, refine by actual measured values
  if (effectiveType === "3g") {
    // Poor 3G conditions
    if (downlink < 0.5 || rtt > 600) return "low";
    return "medium";
  }

  // 4g - check if it's actually performing well
  if (downlink < 1.0 || rtt > 400) return "medium";
  if (downlink < 0.3 || rtt > 800) return "low";

  return "high";
}

/** Classify connection tier from measured latency */
function classifyFromLatency(rttMs: number): ConnectionTier {
  if (rttMs > 2000) return "critical";
  if (rttMs > 1000) return "low";
  if (rttMs > 400) return "medium";
  return "high";
}

/**
 * Measure actual request latency by timing a small request to the server.
 * Uses the existing /api/health endpoint or falls back to a timestamp endpoint.
 */
async function measureLatency(endpoint = "/api/health"): Promise<number> {
  const start = performance.now();
  try {
    // Use a lightweight endpoint with cache-busting
    const resp = await fetch(`${endpoint}?_t=${Date.now()}`, {
      method: "HEAD",
      cache: "no-store",
    });
    if (!resp.ok) throw new Error("Health check failed");
  } catch {
    // If health endpoint fails, try timing the control endpoint
    // (we'll get a 401 but that still measures latency)
    try {
      await fetch(`/api/ping?_t=${Date.now()}`, { method: "HEAD", cache: "no-store" });
    } catch {
      // Network completely unavailable
      return 5000;
    }
  }
  return performance.now() - start;
}

/**
 * Detect current connection quality.
 * Returns immediately with API data if available, otherwise measures latency.
 */
export async function detectConnectionQuality(): Promise<ConnectionQuality> {
  const info = getNetworkInfo();

  if (info) {
    return {
      tier: classifyFromApi(info),
      rttMs: info.rtt,
      downlinkMbps: info.downlink,
      effectiveType: info.effectiveType,
      apiAvailable: true,
    };
  }

  // Fallback: measure actual latency
  const rttMs = await measureLatency();
  return {
    tier: classifyFromLatency(rttMs),
    rttMs,
    downlinkMbps: null,
    effectiveType: null,
    apiAvailable: false,
  };
}

/**
 * Get connection quality synchronously using cached/API data.
 * Returns null if no data is available yet.
 */
export function getConnectionQualitySync(): ConnectionQuality | null {
  const info = getNetworkInfo();
  if (!info) return null;

  return {
    tier: classifyFromApi(info),
    rttMs: info.rtt,
    downlinkMbps: info.downlink,
    effectiveType: info.effectiveType,
    apiAvailable: true,
  };
}

/**
 * Subscribe to connection quality changes.
 * Calls the callback immediately with current state, then on each change.
 */
export function subscribeToConnectionChanges(
  callback: (quality: ConnectionQuality) => void
): () => void {
  const info = getNetworkInfo();

  // Initial detection
  detectConnectionQuality().then(callback);

  if (!info) {
    // No API available - set up periodic latency checks
    let active = true;
    const check = async () => {
      if (!active) return;
      const quality = await detectConnectionQuality();
      if (active) callback(quality);
    };
    // Check every 30 seconds when no API
    const interval = setInterval(check, 30_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }

  // API available - listen for changes
  const onChange = () => {
    callback({
      tier: classifyFromApi(info),
      rttMs: info.rtt,
      downlinkMbps: info.downlink,
      effectiveType: info.effectiveType,
      apiAvailable: true,
    });
  };

  info.addEventListener("change", onChange);
  return () => info.removeEventListener("change", onChange);
}

/**
 * React hook for connection quality monitoring.
 * Automatically updates when connection changes.
 */
import { useEffect, useState } from "react";

export function useConnectionQuality(): ConnectionQuality | null {
  const [quality, setQuality] = useState<ConnectionQuality | null>(() =>
    getConnectionQualitySync()
  );

  useEffect(() => {
    return subscribeToConnectionChanges(setQuality);
  }, []);

  return quality;
}
