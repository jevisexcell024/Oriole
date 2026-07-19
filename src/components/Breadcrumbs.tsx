import { Link, useLocation } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useT } from "@/lib/i18n";
import { buildCrumbs } from "@/lib/breadcrumbs";

/** `panel` styling matches PageHeader's permanently-dark #111110 panel; `page` uses
 *  theme-aware tokens for use directly on the regular page background. */
export function Breadcrumbs({ current, variant = "page" }: { current?: string; variant?: "panel" | "page" }) {
  const t = useT();
  const loc = useLocation();
  const segments = buildCrumbs(loc.pathname, current);
  if (segments.length < 2) return null;

  const muted = variant === "panel" ? "text-[#9FBCC2]" : "text-[var(--muted)]";
  const hoverCls = variant === "panel" ? "hover:text-white" : "hover:text-[var(--fg)]";
  const currentCls = variant === "panel" ? "text-white" : "text-[var(--fg)]";

  return (
    <nav aria-label={t("bc.navLabel")} className={`mb-1.5 flex flex-wrap items-center gap-1 text-[12px] ${muted}`}>
      {segments.map((s, i) => {
        const isLast = i === segments.length - 1;
        const label = s.label ?? t(s.labelKey!);
        return (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />}
            {s.to && !isLast
              ? <Link to={s.to} className={`truncate hover:underline ${hoverCls}`}>{label}</Link>
              : <span className={isLast ? `truncate font-medium ${currentCls}` : "truncate"} aria-current={isLast ? "page" : undefined}>{label}</span>}
          </span>
        );
      })}
    </nav>
  );
}
