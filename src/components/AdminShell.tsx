import { type ReactNode, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { LogOut, BookOpen, BarChart3, Radio, CalendarClock, CalendarDays, LineChart, Award, Users, ClipboardCheck, GraduationCap, CalendarCheck, Bell, ShieldAlert, AlertTriangle, FileText, HeartPulse, Building2, ScrollText, Settings, LayoutDashboard, Users2, Menu, X, ChevronsLeft, ChevronDown, MessageSquareWarning, Webhook, Library, ShieldCheck, Gauge, UserCog, Megaphone, Layers, LifeBuoy } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { can, type Cap } from "@/lib/roles";
import { BrandMark } from "@/components/BrandMark";
import { clsx } from "clsx";

type NavItem = { to: string; labelKey: string; icon: typeof BookOpen; cap: Cap; badge?: boolean };
type NavGroup = { key: string; labelKey: string; items: NavItem[] };

const TOP_ITEM: NavItem = { to: "/admin/dashboard", labelKey: "anav.dashboard", icon: LayoutDashboard, cap: "dashboard" };

const GROUPS: NavGroup[] = [
  {
    key: "examinations",
    labelKey: "anav.secExamination",
    items: [
      { to: "/admin/exams", labelKey: "anav.examsLibrary", icon: BookOpen, cap: "exams" },
      { to: "/admin/exams-library", labelKey: "anav.questionBank", icon: Layers, cap: "exams" },
      { to: "/admin/scheduler", labelKey: "anav.scheduler", icon: CalendarClock, cap: "exams" },
      { to: "/admin/calendar", labelKey: "anav.calendar", icon: CalendarDays, cap: "exams" },
      { to: "/admin/results", labelKey: "anav.results", icon: BarChart3, cap: "results" },
      { to: "/admin/certificates", labelKey: "anav.certificates", icon: Award, cap: "results" },
    ],
  },
  {
    key: "grading",
    labelKey: "anav.secGrading",
    items: [
      { to: "/admin/grading", labelKey: "anav.grading", icon: ClipboardCheck, cap: "grading" },
      { to: "/admin/regrades", labelKey: "anav.regrades", icon: MessageSquareWarning, cap: "grading" },
    ],
  },
  {
    key: "monitoring",
    labelKey: "anav.secMonitoring",
    items: [
      { to: "/admin/live", labelKey: "anav.liveMonitor", icon: Radio, cap: "monitor", badge: true },
      { to: "/admin/violations", labelKey: "anav.violations", icon: AlertTriangle, cap: "monitor", badge: true },
      { to: "/admin/integrity", labelKey: "anav.integrity", icon: ShieldAlert, cap: "results" },
      { to: "/admin/system-health", labelKey: "anav.systemHealth", icon: HeartPulse, cap: "system" },
      { to: "/admin/reliability", labelKey: "anav.reliability", icon: Gauge, cap: "system" },
    ],
  },
  {
    key: "students",
    labelKey: "anav.secStudents",
    items: [
      { to: "/admin/candidates", labelKey: "anav.students", icon: Users, cap: "students" },
      { to: "/admin/classes", labelKey: "anav.classes", icon: Users2, cap: "exams" },
      { to: "/admin/attendance", labelKey: "anav.attendance", icon: CalendarCheck, cap: "students" },
      { to: "/admin/students", labelKey: "anav.studentRecords", icon: GraduationCap, cap: "students" },
    ],
  },
  {
    key: "library",
    labelKey: "anav.secLibrary",
    items: [
      { to: "/admin/library", labelKey: "anav.library", icon: Library, cap: "org" },
    ],
  },
  {
    key: "communication",
    labelKey: "anav.secCommunication",
    items: [
      { to: "/admin/inbox", labelKey: "anav.inbox", icon: Bell, cap: "dashboard" },
      { to: "/admin/communication", labelKey: "anav.communication", icon: Megaphone, cap: "communication" },
    ],
  },
  {
    key: "reports",
    labelKey: "anav.secReportsAnalytics",
    items: [
      { to: "/admin/analytics", labelKey: "anav.analytics", icon: LineChart, cap: "results" },
      { to: "/admin/reports", labelKey: "anav.reports", icon: FileText, cap: "results" },
    ],
  },
  {
    key: "administration",
    labelKey: "anav.secAdministration",
    items: [
      { to: "/admin/organization", labelKey: "anav.organization", icon: Building2, cap: "org" },
      { to: "/admin/team", labelKey: "anav.team", icon: UserCog, cap: "org" },
      { to: "/admin/roles", labelKey: "anav.roles", icon: ShieldCheck, cap: "org" },
      { to: "/admin/integrations", labelKey: "anav.integrations", icon: Webhook, cap: "org" },
      { to: "/admin/audit-logs", labelKey: "anav.auditLogs", icon: ScrollText, cap: "org" },
      { to: "/admin/support", labelKey: "anav.support", icon: LifeBuoy, cap: "org" },
      { to: "/admin/settings", labelKey: "anav.settings", icon: Settings, cap: "org" },
    ],
  },
];

export function AdminShell({ children }: { children: ReactNode; wide?: boolean }) {
  const t = useT();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const loc = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  // Desktop collapse — icon-only rail, persisted across sessions.
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem("orcalis-nav-collapsed") === "1"; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem("orcalis-nav-collapsed", collapsed ? "1" : "0"); } catch { /* ignore */ } }, [collapsed]);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => { setMobileOpen(false); }, [loc.pathname]);

  const isActive = (to: string) => loc.pathname === to || loc.pathname.startsWith(to + "/");
  const activeGroupKey = GROUPS.find((g) => g.items.some((i) => isActive(i.to)))?.key;

  // Collapsible groups — persisted, and the group holding the active route auto-expands
  // the first time it becomes active without collapsing groups the user opened manually.
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem("orcalis-nav-expanded") || "{}"); } catch { return {}; }
  });
  useEffect(() => { try { localStorage.setItem("orcalis-nav-expanded", JSON.stringify(expanded)); } catch { /* ignore */ } }, [expanded]);
  useEffect(() => {
    if (activeGroupKey && expanded[activeGroupKey] === undefined) {
      setExpanded((e) => ({ ...e, [activeGroupKey]: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroupKey]);
  const isGroupExpanded = (key: string) => expanded[key] ?? key === activeGroupKey;
  const toggleGroup = (key: string) => setExpanded((e) => ({ ...e, [key]: !isGroupExpanded(key) }));

  const renderItem = (item: NavItem) => {
    const active = isActive(item.to);
    return (
      <Link
        key={item.to}
        to={item.to}
        title={collapsed ? t(item.labelKey) : undefined}
        className={clsx(
          "group relative flex items-center gap-2.5 rounded-[3px] px-3 py-2 text-[13px] font-medium transition",
          collapsed && "lg:justify-center lg:px-0",
          active
            ? "bg-[#c6ff34] text-[#111110]"
            : "text-[#D7E3E6] hover:bg-[#c6ff34] hover:text-[#111110]",
        )}
      >
        {active && <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-[#111110]" />}
        <item.icon className={clsx("h-4 w-4 shrink-0 transition-colors", active ? "text-[#111110]" : "text-[#9FBCC2] group-hover:text-[#111110]")} />
        <span className={clsx("flex-1", collapsed && "lg:hidden")}>{t(item.labelKey)}</span>
        {item.badge && (
          <span className={clsx("inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-400 ring-1 ring-inset ring-rose-500/25", collapsed && "lg:hidden")}>
            {t("anav.live")}
          </span>
        )}
      </Link>
    );
  };

  return (
    <div className="flex min-h-screen">
      {/* Mobile top bar */}
      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-3 border-b border-[var(--border)] bg-[var(--card)] px-4 print:hidden lg:hidden">
        <button onClick={() => setMobileOpen(true)} aria-label={t("anav.openMenu")} className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-white/[0.05] hover:text-[var(--fg)]">
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white p-1"><BrandMark className="h-full w-full object-contain" /></span>
          <span className="text-[15px] font-bold tracking-tight">Oriole</span>
        </div>
      </header>

      {/* Backdrop (mobile) */}
      {mobileOpen && <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setMobileOpen(false)} />}

      {/* Sidebar — static on desktop, slide-in drawer on mobile */}
      <aside className={clsx(
        "fixed inset-y-0 left-0 z-50 flex h-screen w-60 shrink-0 flex-col border-r border-[var(--border)] bg-[#111110] text-[#DCE8EA] transition-[transform,width] duration-200 print:hidden",
        "lg:sticky lg:top-0 lg:z-auto lg:translate-x-0",
        collapsed ? "lg:w-[74px]" : "lg:w-60",
        mobileOpen ? "translate-x-0" : "-translate-x-full",
      )}>
        <div className={clsx("flex h-16 items-center gap-2.5 border-b border-[var(--border)] px-5", collapsed && "lg:justify-center lg:px-2")}>
          <button onClick={() => collapsed && setCollapsed(false)} title={collapsed ? t("anav.expand") : undefined}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white p-1">
            <BrandMark className="h-full w-full object-contain" />
          </button>
          <div className={clsx("leading-tight", collapsed && "lg:hidden")}>
            <span className="block text-[15px] font-bold tracking-tight text-white">Oriole</span>
            <span className="block text-[11px] font-medium text-[#9FBCC2]">{t("anav.adminConsole")}</span>
          </div>
          <button onClick={() => setCollapsed(true)} aria-label={t("anav.collapse")} title={t("anav.collapse")}
            className={clsx("ml-auto hidden rounded-lg p-1.5 text-[#9FBCC2] hover:bg-[#c6ff34] hover:text-[#111110]", !collapsed && "lg:inline-flex")}>
            <ChevronsLeft className="h-4 w-4" />
          </button>
          <button onClick={() => setMobileOpen(false)} aria-label={t("anav.closeMenu")} className="ml-auto rounded-lg p-1.5 text-[#9FBCC2] hover:bg-[#c6ff34] hover:text-[#111110] lg:hidden">
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-5">
          {can(user?.role, TOP_ITEM.cap) && <div className="mb-4">{renderItem(TOP_ITEM)}</div>}
          {GROUPS.map((group) => {
            const items = group.items.filter((i) => can(user?.role, i.cap));
            if (items.length === 0) return null;
            const groupExpanded = collapsed || isGroupExpanded(group.key);
            return (
              <div key={group.key} className="pb-1">
                <button
                  type="button"
                  onClick={() => toggleGroup(group.key)}
                  aria-expanded={groupExpanded}
                  className={clsx(
                    "flex w-full items-center justify-between rounded-[3px] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#9FBCC2] hover:text-white",
                    collapsed && "lg:hidden",
                  )}
                >
                  <span>{t(group.labelKey)}</span>
                  <ChevronDown className={clsx("h-3.5 w-3.5 shrink-0 transition-transform", groupExpanded && "rotate-180")} />
                </button>
                {groupExpanded && <div className="space-y-0.5">{items.map(renderItem)}</div>}
              </div>
            );
          })}
        </nav>

        {/* User (→ account settings) + sign out */}
        <div className={clsx("flex items-center gap-2.5 border-t border-[var(--border)] px-4 py-3", collapsed && "lg:flex-col lg:gap-2 lg:px-2")}>
          <Link to="/admin/account" className={clsx("group flex min-w-0 flex-1 items-center gap-2.5 rounded-[3px] p-1 hover:bg-[#c6ff34]", collapsed && "lg:flex-none")} title={t("acct.title")}>
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
          <button
            className="rounded-lg p-2 text-[#9FBCC2] hover:bg-[#c6ff34] hover:text-[#111110]"
            title={t("anav.signOut")}
            onClick={async () => { await logout(); navigate("/login"); }}
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </aside>

      {/* Content */}
      <div className="min-w-0 flex-1 bg-[var(--bg)] pt-14 print:pt-0 lg:pt-0">
        <main className="max-w-[1560px] px-4 py-5 [--app-header-h:56px] print:max-w-none print:p-0 sm:px-6 sm:py-6 lg:[--app-header-h:0px]">{children}</main>
      </div>
    </div>
  );
}
