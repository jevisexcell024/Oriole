import { Globe } from "lucide-react";
import { LANGUAGES, useI18n, type Lang } from "@/lib/i18n";
import { clsx } from "clsx";

/** Compact language picker. Default styling is white-on-dark, for headers that
 *  stay a fixed dark panel regardless of theme (e.g. Shell.tsx). Pass `themed`
 *  on a surface that itself follows the light/dark toggle (e.g. Login.tsx's
 *  glass card) so the control reads correctly in both. */
export function LanguageSwitcher({ className, themed }: { className?: string; themed?: boolean }) {
  const { lang, setLang, t } = useI18n();
  return (
    <label className={clsx("relative inline-flex items-center", className)} title={t("common.language")}>
      <Globe className={clsx("pointer-events-none absolute left-2 h-4 w-4 opacity-70", themed ? "text-[var(--muted)]" : "text-current")} />
      <select
        aria-label={t("common.language")}
        value={lang}
        onChange={(e) => setLang(e.target.value as Lang)}
        className={clsx(
          "cursor-pointer appearance-none rounded-lg py-1.5 pl-8 pr-3 text-xs font-medium outline-none transition",
          themed
            ? "border border-[var(--glass-input-border)] bg-[var(--glass-input)] text-[var(--fg)] hover:bg-[var(--glass-highlight)] focus:border-brand-500"
            : "border border-white/20 bg-white/10 text-white hover:bg-white/20 focus:border-white/40",
        )}
      >
        {LANGUAGES.map((l) => <option key={l.code} value={l.code} className="text-[#111110]">{l.label}</option>)}
      </select>
    </label>
  );
}
