import { type ReactNode, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LogOut, LayoutDashboard, BarChart3, HeartPulse, Activity, Building2, ClipboardList, PauseCircle, Archive,
  CreditCard, KeyRound, Key, Gauge, ShieldCheck, Users, ScrollText, Radio, UserCheck, BookOpen, Monitor,
  CalendarClock, History, Database, HardDrive, Zap, Mail, FileSearch, LogIn, ShieldAlert, Palette, Settings,
  Flag, FileText, Bell, LifeBuoy, MessageSquare, MessageCircle, DollarSign, TrendingUp, PieChart, Download,
  Code2, Braces, Info, UserCircle, Menu, X, ChevronsLeft, ChevronDown, Lock,
} from "lucide-react";
import { useSuperAdminAuth } from "@/lib/superAdminAuth";
import { useT } from "@/lib/i18n";
import { BrandMark } from "@/components/BrandMark";
import { clsx } from "clsx";

// Clones AdminShell.tsx's structural pattern (collapsible groups, mobile
// drawer, brand mark) but is otherwise unconnected to it — separate
// localStorage keys below so collapse/expand state never collides if an
// operator has both consoles open, and no `can()`/Cap gating since Super
// Admin has no permission tiers in v1 (every account is equally privileged).
//
// Renders the FULL ~15-section shape from the v2.0.0 spec so the overall
// platform IA is visible now, but only "Dashboard" is a real route this
// workstream — every other item has no `to` and renders disabled (grayed,
// non-navigating, "Soon" badge). Deliberately NOT stub pages: a disabled list
// item can't 404 or go stale the way an abandoned placeholder route can. Only
// add a real `to` here in the same batch that builds that section for real.
type NavItem = { labelKey: string; icon: typeof BookOpen; to?: string; external?: boolean };
type NavGroup = { key: string; labelKey: string; items: NavItem[] };

const TOP_ITEM: NavItem = { to: "/super-admin/dashboard", labelKey: "sanav.dashboard", icon: LayoutDashboard };

const GROUPS: NavGroup[] = [
  { key: "platform", labelKey: "sanav.secPlatform", items: [
    { labelKey: "sanav.platformAnalytics", icon: BarChart3, to: "/super-admin/analytics" },
    // Deliberately NOT built as its own page — see the CHANGELOG's own note
    // on this decision: a Super Admin System Health page would ~100%
    // duplicate the tenant-side /admin/system-health and the public status
    // page (same reliability engine, just behind a different login). Left
    // disabled rather than reversing that call.
    { labelKey: "sanav.systemHealth", icon: HeartPulse },
    // The public status page needs no tenant session, so it's a real link
    // out (new tab) rather than a rebuilt duplicate.
    { labelKey: "sanav.statusOverview", icon: Activity, to: "/status", external: true },
  ] },
  { key: "tenants", labelKey: "sanav.secTenants", items: [
    { labelKey: "sanav.institutions", icon: Building2, to: "/super-admin/institutions" },
    { labelKey: "sanav.tenantRequests", icon: ClipboardList },
    { labelKey: "sanav.tenantSuspension", icon: PauseCircle },
    { labelKey: "sanav.tenantArchive", icon: Archive },
  ] },
  { key: "licensing", labelKey: "sanav.secLicensing", items: [
    { labelKey: "sanav.subscriptionPlans", icon: CreditCard, to: "/super-admin/plans" },
    { labelKey: "sanav.activeLicenses", icon: KeyRound, to: "/super-admin/licenses" },
    { labelKey: "sanav.licenseKeys", icon: Key, to: "/super-admin/license-keys" },
    // Usage Limits isn't a separate page — it's exactly what Active Licenses
    // already shows (usage vs. each tenant's plan limits), so both nav items
    // deliberately point at the same real page rather than building a
    // duplicate. Matches this shell's own "no stub pages" rule.
    { labelKey: "sanav.usageLimits", icon: Gauge, to: "/super-admin/licenses" },
  ] },
  { key: "users", labelKey: "sanav.secUsers", items: [
    { labelKey: "sanav.superAdmins", icon: ShieldCheck, to: "/super-admin/team" },
    // Real now: Owner/Support tiers on the same Team page (an Owner-only
    // toggle per member) — same page as Super Admins, not a separate list,
    // since it's the same accounts with the same table, just a tier on each.
    { labelKey: "sanav.platformSupportStaff", icon: Users, to: "/super-admin/team" },
    // Security Center already IS the platform activity/audit log — same page.
    { labelKey: "sanav.activityLogs", icon: ScrollText, to: "/super-admin/security" },
  ] },
  { key: "monitoring", labelKey: "sanav.secMonitoring", items: [
    // All 4 are facets of one real fact — who's mid-exam right now — so all
    // 4 point at the one real page rather than 4 near-identical builds.
    { labelKey: "sanav.livePlatform", icon: Radio, to: "/super-admin/monitoring" },
    { labelKey: "sanav.activeUsers", icon: UserCheck, to: "/super-admin/monitoring" },
    { labelKey: "sanav.activeExams", icon: BookOpen, to: "/super-admin/monitoring" },
    { labelKey: "sanav.activeSessions", icon: Monitor, to: "/super-admin/monitoring" },
  ] },
  { key: "maintenance", labelKey: "sanav.secMaintenance", items: [
    { labelKey: "sanav.maintenanceMode", icon: CalendarClock, to: "/super-admin/maintenance" },
    // Both now real sections ON that same page (History = a filtered slice
    // of the audit trail; Queue = the new scheduled-windows feature) rather
    // than separate pages for what's really one workflow.
    { labelKey: "sanav.maintenanceHistory", icon: History, to: "/super-admin/maintenance" },
    { labelKey: "sanav.maintenanceQueue", icon: ClipboardList, to: "/super-admin/maintenance" },
  ] },
  { key: "infrastructure", labelKey: "sanav.secInfrastructure", items: [
    { labelKey: "sanav.database", icon: Database },
    { labelKey: "sanav.storage", icon: HardDrive },
    { labelKey: "sanav.cache", icon: Zap },
    { labelKey: "sanav.queues", icon: ClipboardList },
    { labelKey: "sanav.emailServices", icon: Mail },
  ] },
  { key: "security", labelKey: "sanav.secSecurity", items: [
    { labelKey: "sanav.securityCenter", icon: FileSearch, to: "/super-admin/security" },
    // Both of these are already IN Security Center's own audit trail
    // (login/login_failed events, security-relevant actions) — same page,
    // not a second view of the same data.
    { labelKey: "sanav.loginLogs", icon: LogIn, to: "/super-admin/security" },
    { labelKey: "sanav.securityEvents", icon: ShieldAlert, to: "/super-admin/security" },
    // A Super Admin API key system was fully built once and then reverted —
    // see CHANGELOG.md "Not shipped — API Keys (duplicate of an existing
    // feature)". The tenant-side system (AdminIntegrations.tsx) already
    // covers this; a second, parallel key system would be exactly the
    // confusing duplicate that entry describes. Left disabled on purpose.
    { labelKey: "sanav.apiKeys", icon: Lock },
  ] },
  { key: "configuration", labelKey: "sanav.secConfiguration", items: [
    { labelKey: "sanav.brandingDefaults", icon: Palette },
    { labelKey: "sanav.platformSettings", icon: Settings, to: "/super-admin/settings" },
    { labelKey: "sanav.featureFlags", icon: Flag },
    { labelKey: "sanav.emailTemplates", icon: FileText, to: "/super-admin/email-templates" },
    { labelKey: "sanav.notificationTemplates", icon: Bell },
  ] },
  { key: "support", labelKey: "sanav.secSupport", items: [
    { labelKey: "sanav.tickets", icon: LifeBuoy, to: "/super-admin/tickets" },
    { labelKey: "sanav.feedback", icon: MessageSquare },
    { labelKey: "sanav.contactMessages", icon: MessageCircle },
  ] },
  { key: "reports", labelKey: "sanav.secReports", items: [
    { labelKey: "sanav.revenue", icon: DollarSign },
    { labelKey: "sanav.growth", icon: TrendingUp },
    { labelKey: "sanav.usage", icon: PieChart },
    { labelKey: "sanav.exports", icon: Download },
  ] },
  { key: "developer", labelKey: "sanav.secDeveloper", items: [
    { labelKey: "sanav.environment", icon: Code2 },
    { labelKey: "sanav.apiExplorer", icon: Braces },
    { labelKey: "sanav.systemInformation", icon: Info, to: "/super-admin/system-info" },
  ] },
  { key: "profile", labelKey: "sanav.secProfile", items: [
    { labelKey: "sanav.profile", icon: UserCircle, to: "/super-admin/profile" },
  ] },
];

export function SuperAdminShell({ children }: { children: ReactNode }) {
  const t = useT();
  const { superAdmin, logout } = useSuperAdminAuth();
  const navigate = useNavigate();
  const loc = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem("orcalis-superadmin-nav-collapsed") === "1"; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem("orcalis-superadmin-nav-collapsed", collapsed ? "1" : "0"); } catch { /* ignore */ } }, [collapsed]);

  useEffect(() => { setMobileOpen(false); }, [loc.pathname]);

  const isActive = (to: string) => loc.pathname === to || loc.pathname.startsWith(to + "/");

  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem("orcalis-superadmin-nav-expanded") || "{}"); } catch { return {}; }
  });
  useEffect(() => { try { localStorage.setItem("orcalis-superadmin-nav-expanded", JSON.stringify(expanded)); } catch { /* ignore */ } }, [expanded]);
  const isGroupExpanded = (key: string) => expanded[key] ?? false;
  const toggleGroup = (key: string) => setExpanded((e) => ({ ...e, [key]: !isGroupExpanded(key) }));

  const renderItem = (item: NavItem) => {
    if (!item.to) {
      return (
        <span
          key={item.labelKey}
          title={t("sanav.comingSoon")}
          className={clsx(
            "group relative flex cursor-not-allowed items-center gap-2.5 rounded-[3px] px-3 py-2 text-[13px] font-medium text-[#5A6870]",
            collapsed && "lg:justify-center lg:px-0",
          )}
        >
          <item.icon className="h-4 w-4 shrink-0 text-[#5A6870]" />
          <span className={clsx("flex-1", collapsed && "lg:hidden")}>{t(item.labelKey)}</span>
          <span className={clsx("shrink-0 rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#8A97A0]", collapsed && "lg:hidden")}>
            {t("sanav.soon")}
          </span>
        </span>
      );
    }
    if (item.external) {
      return (
        <a
          key={item.to}
          href={item.to}
          target="_blank"
          rel="noopener noreferrer"
          title={collapsed ? t(item.labelKey) : undefined}
          className={clsx(
            "group relative flex items-center gap-2.5 rounded-[3px] px-3 py-2 text-[13px] font-medium text-[#D7E3E6] transition hover:bg-[#c6ff34] hover:text-[#111110]",
            collapsed && "lg:justify-center lg:px-0",
          )}
        >
          <item.icon className="h-4 w-4 shrink-0 text-[#9FBCC2] transition-colors group-hover:text-[#111110]" />
          <span className={clsx("flex-1", collapsed && "lg:hidden")}>{t(item.labelKey)}</span>
        </a>
      );
    }
    const active = isActive(item.to);
    return (
      <Link
        key={item.to}
        to={item.to}
        title={collapsed ? t(item.labelKey) : undefined}
        className={clsx(
          "group relative flex items-center gap-2.5 rounded-[3px] px-3 py-2 text-[13px] font-medium transition",
          collapsed && "lg:justify-center lg:px-0",
          active ? "bg-[#c6ff34] text-[#111110]" : "text-[#D7E3E6] hover:bg-[#c6ff34] hover:text-[#111110]",
        )}
      >
        {active && <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-[#111110]" />}
        <item.icon className={clsx("h-4 w-4 shrink-0 transition-colors", active ? "text-[#111110]" : "text-[#9FBCC2] group-hover:text-[#111110]")} />
        <span className={clsx("flex-1", collapsed && "lg:hidden")}>{t(item.labelKey)}</span>
      </Link>
    );
  };

  return (
    <div className="flex min-h-screen">
      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-3 border-b border-[var(--border)] bg-[var(--card)] px-4 print:hidden lg:hidden">
        <button onClick={() => setMobileOpen(true)} aria-label={t("sanav.openMenu")} className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-white/[0.05] hover:text-[var(--fg)]">
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white p-1"><BrandMark className="h-full w-full object-contain" /></span>
          <span className="text-[15px] font-bold tracking-tight">Oriole</span>
        </div>
      </header>

      {mobileOpen && <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setMobileOpen(false)} />}

      <aside className={clsx(
        "fixed inset-y-0 left-0 z-50 flex h-screen w-60 shrink-0 flex-col border-r border-[var(--border)] bg-[#111110] text-[#DCE8EA] transition-[transform,width] duration-200 print:hidden",
        "lg:sticky lg:top-0 lg:z-auto lg:translate-x-0",
        collapsed ? "lg:w-[74px]" : "lg:w-60",
        mobileOpen ? "translate-x-0" : "-translate-x-full",
      )}>
        <div className={clsx("flex h-16 items-center gap-2.5 border-b border-[var(--border)] px-5", collapsed && "lg:justify-center lg:px-2")}>
          <button onClick={() => collapsed && setCollapsed(false)} title={collapsed ? t("sanav.expand") : undefined}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white p-1">
            <BrandMark className="h-full w-full object-contain" />
          </button>
          <div className={clsx("leading-tight", collapsed && "lg:hidden")}>
            <span className="block text-[15px] font-bold tracking-tight text-white">Oriole</span>
            <span className="block text-[11px] font-medium text-[#9FBCC2]">{t("sanav.platformConsole")}</span>
          </div>
          <button onClick={() => setCollapsed(true)} aria-label={t("sanav.collapse")} title={t("sanav.collapse")}
            className={clsx("ml-auto hidden rounded-lg p-1.5 text-[#9FBCC2] hover:bg-[#c6ff34] hover:text-[#111110]", !collapsed && "lg:inline-flex")}>
            <ChevronsLeft className="h-4 w-4" />
          </button>
          <button onClick={() => setMobileOpen(false)} aria-label={t("sanav.closeMenu")} className="ml-auto rounded-lg p-1.5 text-[#9FBCC2] hover:bg-[#c6ff34] hover:text-[#111110] lg:hidden">
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-5">
          <div className="mb-4">{renderItem(TOP_ITEM)}</div>
          {GROUPS.map((group) => {
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
                {groupExpanded && <div className="space-y-0.5">{group.items.map(renderItem)}</div>}
              </div>
            );
          })}
        </nav>

        <div className={clsx("flex items-center gap-2.5 border-t border-[var(--border)] px-4 py-3", collapsed && "lg:flex-col lg:gap-2 lg:px-2")}>
          <div className={clsx("flex min-w-0 flex-1 items-center gap-2.5 p-1", collapsed && "lg:flex-none")}>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#c6ff34] text-sm font-bold text-[#111110]">
              {superAdmin?.name?.split(" ").map((w) => w[0]).slice(0, 2).join("")}
            </div>
            <div className={clsx("min-w-0 flex-1", collapsed && "lg:hidden")}>
              <p className="truncate text-sm font-semibold leading-tight text-white">{superAdmin?.name}</p>
              <p className="truncate text-xs text-[#9FBCC2]">{superAdmin?.email}</p>
            </div>
          </div>
          <button
            className="rounded-lg p-2 text-[#9FBCC2] hover:bg-[#c6ff34] hover:text-[#111110]"
            title={t("sanav.signOut")}
            onClick={async () => { await logout(); navigate("/super-admin/login"); }}
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1 bg-[var(--bg)] pt-14 print:pt-0 lg:pt-0">
        <main className="max-w-[1560px] px-4 py-5 [--app-header-h:56px] print:max-w-none print:p-0 sm:px-6 sm:py-6 lg:[--app-header-h:0px]">{children}</main>
      </div>
    </div>
  );
}
