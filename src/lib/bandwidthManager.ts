/**
 * Bandwidth Manager
 *
 * Dynamically adjusts connection tier based on actual request performance.
 * Degrades quickly on failures, upgrades gradually on sustained success.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ConnectionTier,
  useConnectionQuality,
  type ConnectionQuality,
} from "./connectionQuality";
import { compareTiers, tierOrder } from "./adaptiveSnapshot";

/** Order of tiers from worst to best */
const TIER_ORDER: ConnectionTier[] = ["critical", "low", "medium", "high"];

interface BandwidthManagerState {
  /** Current effective tier (may differ from detected tier due to degradation) */
  tier: ConnectionTier;
  /** Detected tier from Network Information API or latency measurement */
  detectedTier: ConnectionTier;
  /** Whether currently degraded below detected tier */
  degraded: boolean;
  /** Number of consecutive failures */
  consecutiveFailures: number;
  /** Time of last upgrade check */
  lastUpgradeCheck: number;
}

interface UseBandwidthManagerOptions {
  /** Callback when tier changes */
  onTierChange?: (tier: ConnectionTier, degraded: boolean) => void;
  /** Number of consecutive failures before degrading */
  failuresBeforeDegrade?: number;
  /** Minimum time (ms) at current tier before considering upgrade */
  upgradeDelayMs?: number;
  /** Number of successful requests needed to consider upgrade */
  successesBeforeUpgrade?: number;
}

const DEFAULT_OPTIONS: Required<UseBandwidthManagerOptions> = {
  onTierChange: () => {},
  failuresBeforeDegrade: 2,
  upgradeDelayMs: 30_000,
  successesBeforeUpgrade: 5,
};

/**
 * React hook for adaptive bandwidth management.
 *
 * Returns the current tier and functions to report request outcomes.
 * Automatically degrades on failures and upgrades on sustained success.
 */
export function useBandwidthManager(options: UseBandwidthManagerOptions = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const detectedQuality = useConnectionQuality();

  const [state, setState] = useState<BandwidthManagerState>(() => ({
    tier: detectedQuality?.tier ?? "high",
    detectedTier: detectedQuality?.tier ?? "high",
    degraded: false,
    consecutiveFailures: 0,
    lastUpgradeCheck: Date.now(),
  }));

  // Track successful requests for upgrade consideration
  const successCount = useRef(0);
  const latencyHistory = useRef<number[]>([]);

  // Update detected tier when connection quality changes
  useEffect(() => {
    if (!detectedQuality) return;

    setState((prev) => {
      const newDetected = detectedQuality.tier;

      // If detected tier is worse than current, immediately adopt it
      if (compareTiers(newDetected, prev.tier) < 0) {
        return {
          ...prev,
          tier: newDetected,
          detectedTier: newDetected,
          degraded: false,
          consecutiveFailures: 0,
        };
      }

      // Otherwise just update detected (current may be degraded)
      return {
        ...prev,
        detectedTier: newDetected,
        // If we were degraded and detected improved, we're still degraded
        // relative to the new detected tier
        degraded: compareTiers(prev.tier, newDetected) < 0,
      };
    });
  }, [detectedQuality]);

  /**
   * Report a successful request with optional latency.
   * May trigger tier upgrade if conditions are met.
   */
  const reportSuccess = useCallback(
    (latencyMs?: number) => {
      if (latencyMs !== undefined) {
        latencyHistory.current.push(latencyMs);
        // Keep last 10 measurements
        if (latencyHistory.current.length > 10) {
          latencyHistory.current.shift();
        }
      }

      successCount.current += 1;

      setState((prev) => {
        const newState = {
          ...prev,
          consecutiveFailures: 0,
        };

        // Check if we should upgrade
        const now = Date.now();
        const timeSinceLastCheck = now - prev.lastUpgradeCheck;

        if (
          prev.degraded &&
          timeSinceLastCheck >= opts.upgradeDelayMs &&
          successCount.current >= opts.successesBeforeUpgrade
        ) {
          // Check if latency supports upgrade
          const avgLatency =
            latencyHistory.current.length > 0
              ? latencyHistory.current.reduce((a, b) => a + b, 0) /
                latencyHistory.current.length
              : 0;

          // Only upgrade if latency is good (under 500ms average)
          if (avgLatency < 500 || latencyHistory.current.length === 0) {
            const currentIdx = TIER_ORDER.indexOf(prev.tier);
            const detectedIdx = TIER_ORDER.indexOf(prev.detectedTier);

            // Can only upgrade up to detected tier
            if (currentIdx < detectedIdx) {
              const newTier = TIER_ORDER[currentIdx + 1];
              successCount.current = 0;

              opts.onTierChange(newTier, newTier !== prev.detectedTier);

              return {
                ...newState,
                tier: newTier,
                degraded: newTier !== prev.detectedTier,
                lastUpgradeCheck: now,
              };
            }
          }
        }

        return newState;
      });
    },
    [opts]
  );

  /**
   * Report a failed request.
   * May trigger tier degradation after consecutive failures.
   */
  const reportFailure = useCallback(() => {
    successCount.current = 0;

    setState((prev) => {
      const newFailures = prev.consecutiveFailures + 1;

      if (newFailures >= opts.failuresBeforeDegrade) {
        const currentIdx = TIER_ORDER.indexOf(prev.tier);

        // Can't degrade below critical
        if (currentIdx > 0) {
          const newTier = TIER_ORDER[currentIdx - 1];

          opts.onTierChange(newTier, true);

          return {
            ...prev,
            tier: newTier,
            degraded: true,
            consecutiveFailures: 0,
            lastUpgradeCheck: Date.now(),
          };
        }
      }

      return {
        ...prev,
        consecutiveFailures: newFailures,
      };
    });
  }, [opts]);

  /**
   * Force a specific tier (e.g., from user settings).
   */
  const forceTier = useCallback(
    (tier: ConnectionTier) => {
      successCount.current = 0;
      latencyHistory.current = [];

      setState((prev) => ({
        ...prev,
        tier,
        degraded: compareTiers(tier, prev.detectedTier) < 0,
        consecutiveFailures: 0,
        lastUpgradeCheck: Date.now(),
      }));

      opts.onTierChange(tier, tier !== state.detectedTier);
    },
    [opts, state.detectedTier]
  );

  /**
   * Reset to detected tier (clear any degradation).
   */
  const reset = useCallback(() => {
    successCount.current = 0;
    latencyHistory.current = [];

    setState((prev) => ({
      ...prev,
      tier: prev.detectedTier,
      degraded: false,
      consecutiveFailures: 0,
      lastUpgradeCheck: Date.now(),
    }));

    opts.onTierChange(state.detectedTier, false);
  }, [opts, state.detectedTier]);

  return {
    /** Current effective tier */
    tier: state.tier,
    /** Tier detected from Network API or latency */
    detectedTier: state.detectedTier,
    /** Whether currently operating below detected tier */
    degraded: state.degraded,
    /** Full connection quality info if available */
    connectionQuality: detectedQuality,
    /** Report a successful request */
    reportSuccess,
    /** Report a failed request */
    reportFailure,
    /** Force a specific tier */
    forceTier,
    /** Reset to detected tier */
    reset,
  };
}
