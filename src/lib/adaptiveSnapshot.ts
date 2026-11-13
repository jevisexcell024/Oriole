/**
 * Adaptive Snapshot Configuration
 *
 * Adjusts webcam snapshot capture settings based on connection quality
 * to minimize bandwidth usage while maintaining proctoring integrity.
 */

import type { ConnectionTier } from "./connectionQuality";

export interface SnapshotConfig {
  /** Interval between snapshots in milliseconds */
  intervalMs: number;
  /** Canvas width for snapshot */
  width: number;
  /** Canvas height for snapshot */
  height: number;
  /** JPEG compression quality (0-1) */
  quality: number;
  /** Convert to grayscale to reduce size */
  grayscale: boolean;
  /** Estimated bytes per snapshot at these settings */
  estimatedBytes: number;
}

/**
 * Snapshot configuration by connection tier.
 *
 * Bandwidth estimates per tier (per hour):
 * - high:     ~120-190 KB/hour (30s interval, 240x180, q0.5)
 * - medium:   ~40-70 KB/hour   (60s interval, 160x120, q0.4)
 * - low:      ~15-25 KB/hour   (120s interval, 120x90, q0.3, grayscale)
 * - critical: ~5-10 KB/hour    (300s interval, 80x60, q0.2, grayscale)
 */
export const SNAPSHOT_CONFIGS: Record<ConnectionTier, SnapshotConfig> = {
  high: {
    intervalMs: 30_000,
    width: 240,
    height: 180,
    quality: 0.5,
    grayscale: false,
    estimatedBytes: 5_500, // ~5-6 KB typical
  },
  medium: {
    intervalMs: 60_000,
    width: 160,
    height: 120,
    quality: 0.4,
    grayscale: false,
    estimatedBytes: 2_500, // ~2-3 KB typical
  },
  low: {
    intervalMs: 120_000,
    width: 120,
    height: 90,
    quality: 0.3,
    grayscale: true,
    estimatedBytes: 1_200, // ~1-1.5 KB typical
  },
  critical: {
    intervalMs: 300_000,
    width: 80,
    height: 60,
    quality: 0.2,
    grayscale: true,
    estimatedBytes: 600, // ~0.5-0.8 KB typical
  },
};

/**
 * Get snapshot configuration for a given connection tier.
 */
export function getSnapshotConfig(tier: ConnectionTier): SnapshotConfig {
  return SNAPSHOT_CONFIGS[tier];
}

/**
 * Apply grayscale filter to canvas context.
 */
function applyGrayscale(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): void {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    // Luminance formula: 0.299*R + 0.587*G + 0.114*B
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    data[i] = gray; // R
    data[i + 1] = gray; // G
    data[i + 2] = gray; // B
    // Alpha channel (data[i + 3]) unchanged
  }

  ctx.putImageData(imageData, 0, 0);
}

/**
 * Capture a snapshot from a video element with adaptive settings.
 * Returns the data URL and actual byte size.
 */
export function captureAdaptiveSnapshot(
  video: HTMLVideoElement,
  config: SnapshotConfig
): { dataUrl: string; bytes: number } | null {
  if (video.readyState < 2) return null;

  const canvas = document.createElement("canvas");
  canvas.width = config.width;
  canvas.height = config.height;

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Draw video frame to canvas at target resolution
  ctx.drawImage(video, 0, 0, config.width, config.height);

  // Apply grayscale if configured (reduces JPEG size by ~20-30%)
  if (config.grayscale) {
    applyGrayscale(ctx, config.width, config.height);
  }

  const dataUrl = canvas.toDataURL("image/jpeg", config.quality);

  // Calculate actual byte size (base64 is ~4/3 larger than binary)
  // Data URL format: "data:image/jpeg;base64,<data>"
  const base64Start = dataUrl.indexOf(",") + 1;
  const base64Length = dataUrl.length - base64Start;
  const bytes = Math.ceil((base64Length * 3) / 4);

  return { dataUrl, bytes };
}

/**
 * Estimate bandwidth usage for a given tier over one hour.
 */
export function estimateHourlyBandwidth(tier: ConnectionTier): {
  snapshotsPerHour: number;
  bytesPerHour: number;
  kbPerHour: number;
} {
  const config = SNAPSHOT_CONFIGS[tier];
  const snapshotsPerHour = Math.floor(3_600_000 / config.intervalMs);
  const bytesPerHour = snapshotsPerHour * config.estimatedBytes;

  return {
    snapshotsPerHour,
    bytesPerHour,
    kbPerHour: Math.round(bytesPerHour / 1024),
  };
}

/**
 * Get a human-readable description of the current bandwidth mode.
 */
export function getBandwidthModeLabel(tier: ConnectionTier): string | null {
  switch (tier) {
    case "high":
      return null; // Don't show anything for normal connection
    case "medium":
      return "Reduced quality";
    case "low":
      return "Low bandwidth";
    case "critical":
      return "Minimal data";
  }
}

/**
 * Get the tier order for comparison (higher = better)
 */
export function tierOrder(tier: ConnectionTier): number {
  const order: Record<ConnectionTier, number> = {
    critical: 0,
    low: 1,
    medium: 2,
    high: 3,
  };
  return order[tier];
}

/**
 * Compare two tiers. Returns:
 *  -1 if a < b (a is worse)
 *   0 if a === b
 *   1 if a > b (a is better)
 */
export function compareTiers(a: ConnectionTier, b: ConnectionTier): -1 | 0 | 1 {
  const diff = tierOrder(a) - tierOrder(b);
  return diff < 0 ? -1 : diff > 0 ? 1 : 0;
}
