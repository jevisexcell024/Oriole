import { type ComponentType, type ReactNode } from "react";
import { clsx } from "clsx";

/** A single shimmering placeholder block. Compose these to mirror real layout. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded-md bg-white/[0.06]", className)} />;
}

/**
 * Generic loading placeholder for list/table cards: an optional leading avatar,
 * a primary label, and a few trailing cells. Sits inside a `.card`.
 */
export function TableSkeleton({ rows = 6, cells = 4, avatar = true }: { rows?: number; cells?: number; avatar?: boolean }) {
  return (
    <div className="divide-y divide-[var(--border)]">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 py-3.5">
          {avatar && <Skeleton className="h-9 w-9 shrink-0 rounded-full" />}
          <Skeleton className="h-3.5 w-32 max-w-[35%]" />
          <div className="flex flex-1 items-center justify-end gap-5 sm:gap-8">
            {Array.from({ length: cells }).map((_, c) => (
              <Skeleton key={c} className={clsx("h-3", c === 0 ? "w-16" : "hidden w-10 sm:block")} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Friendly empty placeholder for zero-data and zero-results states. */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  className,
}: {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border)] px-6 py-14 text-center", className)}>
      {Icon && (
        <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.04] text-[var(--muted)]">
          <Icon className="h-6 w-6" />
        </span>
      )}
      <p className="text-sm font-semibold">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-sm text-[var(--muted)]">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
