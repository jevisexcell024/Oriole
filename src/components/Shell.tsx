import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LogOut, LayoutDashboard, BookOpen, BarChart3, CalendarCheck, CalendarDays, Megaphone, User, Dumbbell, Menu, X, ChevronsLeft, LayoutGrid, Bell,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { NotificationsBell } from "@/components/Announcements";
import { BrandMark } from "@/components/BrandMark";
import { ThemeToggle } from "@/lib/theme";
import { useT } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { clsx } from "clsx";

function greetingKeyFor(d: Date) {
  const h = d.getHours();
  return h < 12 ? "greeting.morning" : h < 18 ? "greeting.afternoon" : "greeting.evening";
}

// Student portal navigation. (Certificates and Payments intentionally excluded.)
const NAV = [
  { to: "/dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard },
  { to: "/exams", labelKey: "nav.myExams", icon: BookOpen },
  { to: "/calendar", labelKey: "nav.calendar", icon: CalendarDays },
  { to: "/results", labelKey: "nav.myResults", icon: BarChart3 },
  { to: "/attendance", labelKey: "nav.attendance", icon: CalendarCheck },
  { to: "/announcements", labelKey: "nav.announcements", icon: Megaphone },
  { to: "/inbox", labelKey: "nav.inbox", icon: Bell },
  { to: "/profile", labelKey: "nav.profile", icon: User },
  { to: "/practice", labelKey: "nav.practiceTests", icon: Dumbbell },
];

export function Shell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const t = useT();
  const navigate = useNavigate();
  const loc = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [apps, setApps] = useState(false);
  const appsRef = useRef<HTMLDivElement>(null);
  // Desktop collapse — icon-only rail, persisted across sessions (shared key with admin).
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem("orcalis-nav-collapsed") === "1"; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem("orcalis-nav-collapsed", collapsed ? "1" : "0"); } catch { /* ignore */ } }, [collapsed]);

  const isActive = (to: string) => loc.pathname === to || loc.pathname.startsWith(to + "/");

  // Close the mobile drawer + apps menu whenever the route changes.
  useEffect(() => { setMobileOpen(false); setApps(false); }, [loc.pathname]);

  // Close the apps menu on outside click.
  useEffect(() => {
    if (!apps) return;
    const onDown = (e: MouseEvent) => { if (appsRef.current && !appsRef.current.contains(e.target as Node)) setApps(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [apps]);

  const today = new Date();

  return (
    <div className="flex min-h-screen">
      {/* Backdrop (mobile) */}
      {mobileOpen && <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setMobileOpen(false)} />}

      {/* Sidebar — static on desktop, slide-in drawer on mobile */}
      <aside className={clsx(
        "fixed inset-y-0 left-0 z-50 flex h-screen w-60 shrink-0 flex-col border-r border-[var(--border)] bg-[#111110] text-[#DCE8EA] transition-[transform,width] duration-200",
        "lg:sticky lg:top-0 lg:z-auto lg:translate-x-0",
        collapsed ? "lg:w-[74px]" : "lg:w-60",
        mobileOpen ? "translate-x-0" : "-translate-x-full",
      )}>
        <div className={clsx("flex h-16 items-center gap-2.5 border-b border-[var(--border)] px-5", collapsed && "lg:justify-center lg:px-2")}>
          <button onClick={() => collapsed && setCollapsed(false)} title={collapsed ? "Expand sidebar" : undefined}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white p-1">
            <BrandMark className="h-full w-full object-contain" />
          </button>
          <div className={clsx("leading-tight", collapsed && "lg:hidden")}>
            <span className="block text-[15px] font-bold tracking-tight text-white">Oriole</span>
            <span className="block text-[11px] font-medium text-[#9FBCC2]">{t("nav.studentPortal")}</span>
          </div>
          <button onClick={() => setCollapsed(true)} aria-label="Collapse sidebar" title="Collapse sidebar"
            className={clsx("ml-auto hidden rounded-lg p-1.5 text-[#9FBCC2] hover:bg-[#c6ff34] hover:text-[#111110]", !collapsed && "lg:inline-flex")}>
            <ChevronsLeft className="h-4 w-4" />
          </button>
          <button onClick={() => setMobileOpen(false)} aria-label="Close menu" className="ml-auto rounded-lg p-1.5 text-[#9FBCC2] hover:bg-[#c6ff34] hover:text-[#111110] lg:hidden">
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-5">
          {NAV.map((n) => {
            const active = isActive(n.to);
            return (
              <Link key={n.to} to={n.to}
                title={collapsed ? t(n.labelKey) : undefined}
                className={clsx("group relative flex items-center gap-2.5 rounded-[3px] px-3 py-2 text-[13px] font-medium transition",
                  collapsed && "lg:justify-center lg:px-0",
                  active
                    ? "bg-[#c6ff34] text-[#111110]"
                    : "text-[#D7E3E6] hover:bg-[#c6ff34] hover:text-[#111110]")}>
                {active && <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-[#111110]" />}
                <n.icon className={clsx("h-4 w-4 shrink-0 transition-colors", active ? "text-[#111110]" : "text-[#9FBCC2] group-hover:text-[#111110]")} />
                <span className={clsx("flex-1", collapsed && "lg:hidden")}>{t(n.labelKey)}</span>
              </Link>
            );
          })}
        </nav>

        {/* User (→ profile) + sign out */}
        <div className={clsx("flex items-center gap-2.5 border-t border-[var(--border)] px-4 py-3", collapsed && "lg:flex-col lg:gap-2 lg:px-2")}>
          <Link to="/profile" className={clsx("group flex min-w-0 flex-1 items-center gap-2.5 rounded-[3px] p-1 hover:bg-[#c6ff34]", collapsed && "lg:flex-none")} title="Profile">
            {user?.avatarUrl
              ? <img src={user.avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
              : <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#111110] text-sm font-bold text-white">
                  {user?.name?.split(" ").map((w) => w[0]).slice(0, 2).join("")}
                </div>}
            <div className={clsx("min-w-0 flex-1", collapsed && "lg:hidden")}>
              <p className="truncate text-sm font-semibold leading-tight text-white group-hover:text-[#111110]">{user?.name}</p>
              <p className="text-xs capitalize text-[#9FBCC2] group-hover:text-[#111110]">{user?.role}</p>
            </div>
          </Link>
          <button className="rounded-lg p-2 text-[#9FBCC2] hover:bg-[#c6ff34] hover:text-[#111110]"
            title={t("nav.signOut")} onClick={async () => { await logout(); navigate("/login"); }}>
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1 bg-[var(--bg)]">
        <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[#111110] px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button onClick={() => setMobileOpen(true)} aria-label="Open menu" className="rounded-lg p-1.5 text-[#C7D6DA] hover:bg-white/10 hover:text-white lg:hidden">
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold tracking-tight text-white sm:text-xl">{t(greetingKeyFor(today))}, {user?.name}</h1>
              <p className="text-xs text-[#C7D6DA]">{today.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher className="hidden sm:inline-flex" />
            <ThemeToggle />
            <div ref={appsRef} className="relative">
              <button onClick={() => setApps((a) => !a)} title={t("nav.quickAccess")} aria-label={t("nav.quickAccess")}
                className={clsx("flex h-9 w-9 items-center justify-center rounded-full border transition", apps ? "border-white/30 bg-white/20 text-white" : "border-white/20 bg-white/10 text-[#C7D6DA] hover:text-white")}>
                <LayoutGrid className="h-4 w-4" />
              </button>
              {apps && (
                <div className="absolute right-0 top-full z-50 mt-2 w-60 rounded-lg border border-[var(--border)] bg-[var(--card)] p-2 shadow-2xl">
                  <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">{t("nav.quickAccess")}</p>
                  <div className="grid grid-cols-3 gap-1">
                    {NAV.map((n) => (
                      <button key={n.to} onClick={() => { setApps(false); navigate(n.to); }} className="flex flex-col items-center gap-1.5 rounded-lg p-2.5 text-center hover:bg-[var(--card-2)]">
                        <n.icon className="h-5 w-5 text-[#c6ff34]" />
                        <span className="text-[11px] leading-tight text-[var(--muted)]">{t(n.labelKey)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <NotificationsBell />
          </div>
        </header>
        <main className="max-w-[1400px] px-4 py-6 [--app-header-h:69px] sm:px-6 sm:py-8">{children}</main>
      </div>
    </div>
  );
}
