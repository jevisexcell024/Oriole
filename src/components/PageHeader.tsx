import { type ReactNode } from "react";

/** Consistent page header — a #111110 panel with title, optional eyebrow/subtitle,
 *  and optional right-side actions. A pumpkin keyline ties it to the brand.
 *  Used across every admin and student page. */
export function PageHeader({ title, subtitle, eyebrow, actions }: { title: ReactNode; subtitle?: ReactNode; eyebrow?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="sticky top-[var(--app-header-h,0px)] z-10 mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[6px] bg-[#111110] px-5 py-4">
      <div className="flex min-w-0 items-stretch gap-3.5">
        {/* Brand keyline */}
        <span aria-hidden className="mt-0.5 w-[3px] shrink-0 rounded-full bg-[#c6ff34]" />
        <div className="min-w-0">
          {eyebrow && <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#c6ff34]">{eyebrow}</p>}
          <h1 className="font-display text-2xl font-semibold tracking-tight text-white">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-[#C7D6DA]">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
