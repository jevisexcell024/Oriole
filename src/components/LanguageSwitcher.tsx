import { Globe } from "lucide-react";
import { LANGUAGES, useI18n, type Lang } from "@/lib/i18n";
import { clsx } from "clsx";

/** Compact language picker. Default styling suits a dark/charcoal header or the login panel. */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { lang, setLang, t } = useI18n();
  return (
    <label className={clsx("relative inline-flex items-center", className)} title={t("common.language")}>
      <Globe className="pointer-events-none absolute left-2 h-4 w-4 text-current opacity-70" />
      <select
        aria-label={t("common.language")}
        value={lang}
        onChange={(e) => setLang(e.target.value as Lang)}
        className="cursor-pointer appearance-none rounded-lg border border-white/20 bg-white/10 py-1.5 pl-8 pr-3 text-xs font-medium text-white outline-none transition hover:bg-white/20 focus:border-white/40"
      >
        {LANGUAGES.map((l) => <option key={l.code} value={l.code} className="text-[#111110]">{l.label}</option>)}
      </select>
    </label>
  );
}
