import { type ReactNode } from "react";

/** Page header slot. The black title banner (breadcrumbs, title, subtitle) was
 *  removed from every page; this component stays so call sites keep working, and
 *  renders only the page's `actions` (primary buttons) — nothing at all when a
 *  page has none. `title`, `subtitle`, `eyebrow` and `crumbCurrent` are accepted
 *  and ignored. */
export function PageHeader({ actions }: { title?: ReactNode; subtitle?: ReactNode; eyebrow?: ReactNode; actions?: ReactNode; crumbCurrent?: string }) {
  if (!actions) return null;
  return <div className="mb-5 flex flex-wrap items-center justify-end gap-2">{actions}</div>;
}
