import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { messages } from "./i18n-messages";

/** Supported UI languages. `dir` drives the document direction (RTL for Arabic). */
export const LANGUAGES = [
  { code: "en", label: "English", dir: "ltr" },
  { code: "fr", label: "Français", dir: "ltr" },
  { code: "es", label: "Español", dir: "ltr" },
  { code: "pt", label: "Português", dir: "ltr" },
  { code: "ar", label: "العربية", dir: "rtl" },
] as const;

export type Lang = (typeof LANGUAGES)[number]["code"];

const DEFAULT: Lang = "en";

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  dir: "ltr" | "rtl";
  /** Translate a key (falls back to English, then the key itself). `{name}` vars interpolate. */
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nCtx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      const s = localStorage.getItem("orcalis-lang");
      if (s && LANGUAGES.some((l) => l.code === s)) return s as Lang;
    } catch { /* ignore */ }
    return DEFAULT;
  });

  const dir = LANGUAGES.find((l) => l.code === lang)?.dir ?? "ltr";

  useEffect(() => {
    try { localStorage.setItem("orcalis-lang", lang); } catch { /* ignore */ }
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  const t = (key: string, vars?: Record<string, string | number>) => {
    const entry = messages[key];
    let str = entry ? (entry[lang] ?? entry.en ?? key) : key;
    if (vars) for (const [k, v] of Object.entries(vars)) str = str.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    return str;
  };

  return <I18nContext.Provider value={{ lang, setLang: setLangState, dir, t }}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nCtx {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}

/** The translate function signature — handy for passing `t` into helpers. */
export type TFn = (key: string, vars?: Record<string, string | number>) => string;

/** Convenience: just the translate function. */
export function useT(): TFn {
  return useI18n().t;
}
