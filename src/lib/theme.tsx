import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Sun, Moon } from "lucide-react";
import { clsx } from "clsx";

export type Theme = "dark" | "light";

const KEY = "orcalis-theme";

interface ThemeCtx { theme: Theme; setTheme: (t: Theme) => void; toggle: () => void; }
const Ctx = createContext<ThemeCtx>({ theme: "dark", setTheme: () => {}, toggle: () => {} });

function readInitial(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch { /* ignore */ }
  return "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readInitial);
  // A brief dark veil when switching TO light — softens what would otherwise
  // be a jarring instant brightness jump. setTheme only ever runs from a real
  // click (nothing calls it on mount), so no "first click" guard is needed —
  // just skip the no-op case of clicking the theme you're already on.
  const [flashKey, setFlashKey] = useState(0);
  const themeRef = useRef(theme);
  themeRef.current = theme;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("light", theme === "light");
    try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  const setTheme = (t: Theme) => {
    if (t === "light" && themeRef.current !== "light") setFlashKey((k) => k + 1);
    setThemeState(t);
  };

  const toggle = () => setTheme(theme === "dark" ? "light" : "dark");
  return (
    <Ctx.Provider value={{ theme, setTheme, toggle }}>
      {children}
      {flashKey > 0 && <ThemeSwitchVeil key={flashKey} />}
    </Ctx.Provider>
  );
}

/** Fixed full-screen dark overlay that fades in then straight back out — a
 *  quick veil covering the moment the canvas repaints light. Skips itself
 *  under reduced-motion (an instant opacity flash reads as a hard flicker,
 *  not a "veil," when there's no transition to soften it). */
function ThemeSwitchVeil() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = requestAnimationFrame(() => setVisible(false));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[999] bg-black transition-opacity duration-300 ease-out"
      style={{ opacity: visible ? 0.5 : 0 }}
    />
  );
}

export const useTheme = () => useContext(Ctx);

// Segmented sun/moon switch. The active half is filled green.
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  return (
    <div className={clsx("flex rounded-full border border-[var(--border)] bg-[var(--card)] p-0.5", className)} role="group" aria-label="Theme">
      <button onClick={() => setTheme("light")} aria-label="Light theme" aria-pressed={theme === "light"}
        className={clsx("flex h-7 w-7 items-center justify-center rounded-full transition", theme === "light" ? "text-white" : "text-[var(--muted)] hover:text-[var(--fg)]")}
        style={theme === "light" ? { background: "#111110" } : undefined}>
        <Sun className="h-3.5 w-3.5" />
      </button>
      <button onClick={() => setTheme("dark")} aria-label="Dark theme" aria-pressed={theme === "dark"}
        className={clsx("flex h-7 w-7 items-center justify-center rounded-full transition", theme === "dark" ? "text-white" : "text-[var(--muted)] hover:text-[var(--fg)]")}
        style={theme === "dark" ? { background: "#111110" } : undefined}>
        <Moon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
