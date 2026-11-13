/**
 * Offline Status Indicator
 *
 * Shows detailed offline/sync status during exams.
 * Provides reassurance that data is being saved locally.
 */

import { useState } from "react";
import {
  Wifi,
  WifiOff,
  Cloud,
  CloudOff,
  Check,
  Loader2,
  AlertTriangle,
  HardDrive,
  RefreshCw,
} from "lucide-react";
import { clsx } from "clsx";
import {
  type OfflineSyncStatus,
  getStatusMessage,
  formatOfflineDuration,
} from "@/lib/useOfflineSync";

interface OfflineIndicatorProps {
  status: OfflineSyncStatus;
  unsyncedCount: number;
  offlineDuration?: number;
  onRetry?: () => void;
  className?: string;
}

export function OfflineIndicator({
  status,
  unsyncedCount,
  offlineDuration = 0,
  onRetry,
  className,
}: OfflineIndicatorProps) {
  const [expanded, setExpanded] = useState(false);

  const config = {
    online: {
      Icon: Check,
      bg: "bg-emerald-500/15",
      text: "text-emerald-400",
      ring: "ring-emerald-500/30",
      label: "Saved",
      showDot: false,
    },
    syncing: {
      Icon: Loader2,
      bg: "bg-blue-500/15",
      text: "text-blue-400",
      ring: "ring-blue-500/30",
      label: "Syncing...",
      showDot: false,
      animate: true,
    },
    pending: {
      Icon: Cloud,
      bg: "bg-amber-500/15",
      text: "text-amber-400",
      ring: "ring-amber-500/30",
      label: `${unsyncedCount} pending`,
      showDot: true,
    },
    offline: {
      Icon: HardDrive,
      bg: "bg-orange-500/15",
      text: "text-orange-400",
      ring: "ring-orange-500/30",
      label: "Saved locally",
      showDot: true,
    },
    error: {
      Icon: AlertTriangle,
      bg: "bg-rose-500/15",
      text: "text-rose-400",
      ring: "ring-rose-500/30",
      label: "Retrying...",
      showDot: true,
    },
  }[status];

  const { Icon, bg, text, ring, label, showDot, animate } = config;
  const offlineText = formatOfflineDuration(offlineDuration);

  return (
    <div className={clsx("relative", className)}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className={clsx(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 transition",
          bg,
          text,
          ring,
          "hover:brightness-110"
        )}
        title={getStatusMessage(status, unsyncedCount)}
      >
        <Icon className={clsx("h-3 w-3", animate && "animate-spin")} />
        <span className="hidden sm:inline">{label}</span>
        {showDot && (
          <span className="absolute -right-0.5 -top-0.5 flex h-2 w-2">
            <span
              className={clsx(
                "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
                status === "offline" ? "bg-orange-400" : status === "error" ? "bg-rose-400" : "bg-amber-400"
              )}
            />
            <span
              className={clsx(
                "relative inline-flex h-2 w-2 rounded-full",
                status === "offline" ? "bg-orange-500" : status === "error" ? "bg-rose-500" : "bg-amber-500"
              )}
            />
          </span>
        )}
      </button>

      {/* Expanded details */}
      {expanded && (
        <div
          className={clsx(
            "absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 shadow-xl",
            ring
          )}
        >
          <div className="flex items-start gap-3">
            <div
              className={clsx(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                bg
              )}
            >
              {status === "offline" ? (
                <WifiOff className={clsx("h-4 w-4", text)} />
              ) : (
                <Wifi className={clsx("h-4 w-4", text)} />
              )}
            </div>
            <div className="flex-1">
              <p className={clsx("text-sm font-semibold", text)}>
                {status === "online" && "Connected & Synced"}
                {status === "syncing" && "Syncing Data..."}
                {status === "pending" && "Sync Pending"}
                {status === "offline" && "You're Offline"}
                {status === "error" && "Sync Error"}
              </p>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                {status === "online" &&
                  "All your answers are saved to the server."}
                {status === "syncing" &&
                  `Uploading ${unsyncedCount} item${unsyncedCount !== 1 ? "s" : ""}...`}
                {status === "pending" &&
                  `${unsyncedCount} item${unsyncedCount !== 1 ? "s" : ""} waiting to sync.`}
                {status === "offline" &&
                  "Your answers are saved locally and will sync when you reconnect."}
                {status === "error" &&
                  "Having trouble connecting. Will retry automatically."}
              </p>
            </div>
          </div>

          {(status === "offline" || offlineText) && (
            <div className="mt-3 flex items-center gap-2 rounded-md bg-[var(--bg)] px-2.5 py-2 text-xs">
              <HardDrive className="h-3.5 w-3.5 text-[var(--muted)]" />
              <span className="text-[var(--muted)]">
                {status === "offline"
                  ? "Don't close this tab - your work is safe"
                  : offlineText}
              </span>
            </div>
          )}

          {unsyncedCount > 0 && (
            <div className="mt-2 flex items-center justify-between text-xs">
              <span className="text-[var(--muted)]">
                {unsyncedCount} unsaved item{unsyncedCount !== 1 ? "s" : ""}
              </span>
              {status !== "syncing" && status !== "offline" && onRetry && (
                <button
                  type="button"
                  onClick={() => {
                    onRetry();
                    setExpanded(false);
                  }}
                  className={clsx(
                    "inline-flex items-center gap-1 font-medium",
                    text,
                    "hover:underline"
                  )}
                >
                  <RefreshCw className="h-3 w-3" />
                  Sync now
                </button>
              )}
            </div>
          )}

          {status === "offline" && (
            <p className="mt-3 rounded-md border border-orange-500/30 bg-orange-500/10 px-2.5 py-2 text-xs text-orange-300">
              <strong>Keep this tab open.</strong> Your answers are being saved
              to your device and will automatically sync when you reconnect.
            </p>
          )}
        </div>
      )}

      {/* Click outside to close */}
      {expanded && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setExpanded(false)}
        />
      )}
    </div>
  );
}

/**
 * Simple inline status for tight spaces.
 */
export function OfflineStatusBadge({
  status,
  className,
}: {
  status: OfflineSyncStatus;
  className?: string;
}) {
  if (status === "online") return null;

  const config = {
    syncing: { Icon: Loader2, text: "text-blue-400", animate: true },
    pending: { Icon: Cloud, text: "text-amber-400", animate: false },
    offline: { Icon: WifiOff, text: "text-orange-400", animate: false },
    error: { Icon: CloudOff, text: "text-rose-400", animate: false },
  }[status];

  if (!config) return null;

  const { Icon, text, animate } = config;

  return (
    <span className={clsx("inline-flex items-center", text, className)}>
      <Icon className={clsx("h-3.5 w-3.5", animate && "animate-spin")} />
    </span>
  );
}

/**
 * Full-width banner for critical offline situations.
 */
export function OfflineBanner({
  status,
  unsyncedCount,
  offlineDuration,
  onRetry,
}: {
  status: OfflineSyncStatus;
  unsyncedCount: number;
  offlineDuration: number;
  onRetry?: () => void;
}) {
  if (status === "online" || status === "syncing") return null;

  const isExtendedOffline = offlineDuration > 60_000; // More than 1 minute

  return (
    <div
      className={clsx(
        "flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium ring-1",
        status === "offline"
          ? "bg-orange-500/15 text-orange-300 ring-orange-500/30"
          : status === "error"
          ? "bg-rose-500/15 text-rose-300 ring-rose-500/30"
          : "bg-amber-500/15 text-amber-300 ring-amber-500/30"
      )}
    >
      {status === "offline" ? (
        <WifiOff className="h-4 w-4 shrink-0" />
      ) : status === "error" ? (
        <AlertTriangle className="h-4 w-4 shrink-0" />
      ) : (
        <Cloud className="h-4 w-4 shrink-0" />
      )}

      <span className="flex-1">
        {status === "offline" && (
          <>
            You're offline — your answers are saved locally
            {isExtendedOffline && " and will sync when you reconnect"}.
            <strong className="ml-1">Don't close this window.</strong>
          </>
        )}
        {status === "error" && (
          <>
            Connection unstable — {unsyncedCount} item
            {unsyncedCount !== 1 ? "s" : ""} waiting to sync. Retrying...
          </>
        )}
        {status === "pending" && (
          <>
            {unsyncedCount} item{unsyncedCount !== 1 ? "s" : ""} waiting to sync.
          </>
        )}
      </span>

      {status !== "offline" && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-md bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20"
        >
          Retry
        </button>
      )}
    </div>
  );
}
