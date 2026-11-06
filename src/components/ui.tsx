import { type ComponentType, type ReactNode } from "react";
import { X } from "lucide-react";
import { clsx } from "clsx";

/** The Super Admin console's stat-tile — icon in a tinted rounded box, a big
 *  number, a muted label, and an optional note line. Was independently
 *  reimplemented (byte-for-byte, down to the exact bg-[#c6ff34]/10 tint)
 *  across SuperAdminLicenseKeys/Plans/TenantRequests/Monitoring — one shared
 *  component here instead. Not used outside the Super Admin console: the
 *  candidate/tenant-admin pages have their own distinct stat-tile styles
 *  (different theme, different visual language) that stay separate on
 *  purpose rather than being forced into this shape. */
export function SuperAdminStatCard({ icon: Icon, label, value, note }: { icon: ComponentType<{ className?: string }>; label: string; value: string | number; note?: string }) {
  return (
    <div className="card flex items-center gap-3 p-4">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#c6ff34]/10 text-[#c6ff34]"><Icon className="h-5 w-5" /></div>
      <div className="min-w-0">
        <p className="truncate text-xl font-bold tabular-nums">{value}</p>
        <p className="text-xs text-[var(--muted)]">{label}</p>
        {note && <p className="mt-0.5 text-[11px] text-[var(--muted)]">{note}</p>}
      </div>
    </div>
  );
}

/** A single shimmering placeholder block. Compose these to mirror real layout.
 *  Uses the theme-aware `.skeleton` fill (index.css) — the old white-alpha fill
 *  vanished on the light canvas. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("skeleton animate-pulse rounded-md", className)} />;
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

/** Centered modal dialog. Only the X (or the caller's own buttons) closes it —
 *  clicking the scrim does nothing, so a stray click can't discard work. Body
 *  scroll is the caller's concern; this only owns the overlay/panel chrome. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h2 className="text-lg font-bold">{title}</h2><button onClick={onClose} className="rounded-lg p-1 text-[var(--muted)] hover:bg-white/[0.05]"><X className="h-5 w-5" /></button></div>
        {children}
      </div>
    </div>
  );
}

/** Inline error banner — the app's standard way to surface a failed request. */
export function ErrorBanner({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={clsx("rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400", className)}>{children}</p>;
}
