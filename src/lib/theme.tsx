import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
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
  const [theme, setTheme] = useState<Theme>(readInitial);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("light", theme === "light");
    try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  const toggle = () => setTheme((t) => (t === "dark" ? "light" : "dark"));
  return <Ctx.Provider value={{ theme, setTheme, toggle }}>{children}</Ctx.Provider>;
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
