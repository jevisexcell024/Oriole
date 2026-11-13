/**
 * Connection Quality Indicator
 *
 * Displays the current bandwidth mode when connection is degraded.
 * Hidden for normal (high) connections to avoid UI noise.
 */

import { Wifi, WifiLow, WifiOff } from "lucide-react";
import type { ConnectionTier } from "@/lib/connectionQuality";
import { getBandwidthModeLabel } from "@/lib/adaptiveSnapshot";
import { clsx } from "clsx";

interface ConnectionIndicatorProps {
  tier: ConnectionTier;
  degraded?: boolean;
  className?: string;
}

export function ConnectionIndicator({
  tier,
  degraded = false,
  className,
}: ConnectionIndicatorProps) {
  const label = getBandwidthModeLabel(tier);

  // Don't show for high-quality connections
  if (!label) return null;

  const configs: Record<
    Exclude<ConnectionTier, "high">,
    { Icon: typeof Wifi; bg: string; text: string; ring: string }
  > = {
    medium: {
      Icon: WifiLow,
      bg: "bg-amber-500/15",
      text: "text-amber-400",
      ring: "ring-amber-500/30",
    },
    low: {
      Icon: WifiLow,
      bg: "bg-orange-500/15",
      text: "text-orange-400",
      ring: "ring-orange-500/30",
    },
    critical: {
      Icon: WifiOff,
      bg: "bg-rose-500/15",
      text: "text-rose-400",
      ring: "ring-rose-500/30",
    },
  };

  // tier is guaranteed to not be "high" here (we return early above)
  const { Icon, bg, text, ring } = configs[tier as Exclude<ConnectionTier, "high">];

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1",
        bg,
        text,
        ring,
        className
      )}
      title={
        degraded
          ? `Connection degraded - using ${label.toLowerCase()} mode to save bandwidth`
          : `Slow connection detected - using ${label.toLowerCase()} mode`
      }
    >
      <Icon className="h-3 w-3" />
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}

/**
 * Compact version for tight spaces (icon only on mobile).
 */
export function ConnectionIndicatorCompact({
  tier,
  className,
}: {
  tier: ConnectionTier;
  className?: string;
}) {
  const label = getBandwidthModeLabel(tier);
  if (!label) return null;

  const iconColors: Record<Exclude<ConnectionTier, "high">, string> = {
    medium: "text-amber-400",
    low: "text-orange-400",
    critical: "text-rose-400",
  };

  // tier is guaranteed to not be "high" here (we return early above)
  const iconColor = iconColors[tier as Exclude<ConnectionTier, "high">];

  const Icon = tier === "critical" ? WifiOff : WifiLow;

  return (
    <span
      className={clsx("inline-flex items-center", iconColor, className)}
      title={`${label} mode active`}
    >
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
}
