import { useEffect, useMemo, useState } from "react";
import { Megaphone, AlertTriangle, Info, Bell, BellOff, Check, Pin } from "lucide-react";
import { Shell } from "@/components/Shell";
import { Skeleton, EmptyState } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/PageHeader";
import { useT } from "@/lib/i18n";
import { clsx } from "clsx";

interface Ann {
  id: string;
  title: string;
  message: string;
  priority: "urgent" | "high" | "normal";
  sentAt: string;
  pinned: boolean;
  department: string | null;
  author: string;
  read: boolean;
}

type Filter = "all" | "unread" | "urgent";
type TFn = ReturnType<typeof useT>;

// Visual language matches the admin Library Dashboard tab, per the redesign spec.
const CARD = "#141414";
const LIME = "#c8f000";
const BORDER = "rgba(255,255,255,0.08)";
const BARLOW = "'Barlow Condensed', sans-serif";
const MONO = "'DM Mono', monospace";

const PRIORITY_META: Record<Ann["priority"], { color: string; bg: string; icon: typeof AlertTriangle; labelKey: string }> = {
  urgent: { color: "#ef4444", bg: "rgba(239,68,68,0.14)", icon: AlertTriangle, labelKey: "ann.urgent" },
  normal: { color: LIME, bg: "rgba(200,240,0,0.14)", icon: Megaphone, labelKey: "ann.normal" },
  high: { color: "#3b82f6", bg: "rgba(59,130,246,0.14)", icon: Info, labelKey: "ann.high" },
};

function fmtFull(s: string) {
  return new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtRel(s: string, t: TFn) {
  const diffMs = Date.now() - new Date(s).getTime();
  const min = Math.round(diffMs / 60_000);
  if (min < 1) return t("ann.justNow");
  if (min < 60) return t("ann.minutesAgo", { m: min });
  const hr = Math.round(min / 60);
  if (hr < 24) return t("ann.hoursAgo", { h: hr });
  const day = Math.round(hr / 24);
  if (day < 7) return t("ann.daysAgo", { d: day });
  return fmtFull(s).split(",")[0];
}

export function StudentAnnouncements() {
  const t = useT();
  const { user, refresh } = useAuth();
  const [anns, setAnns] = useState<Ann[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [muteBusy, setMuteBusy] = useState(false);
  const [markAllBusy, setMarkAllBusy] = useState(false);

  useEffect(() => {
    api.get<{ announcements: Ann[] }>("/announcements").then((d) => setAnns(d.announcements)).catch((e) => setError(e.message));
  }, []);

  const unreadCount = useMemo(() => anns?.filter((a) => !a.read).length ?? 0, [anns]);
  const urgentCount = useMemo(() => anns?.filter((a) => a.priority === "urgent").length ?? 0, [anns]);

  const filtered = useMemo(() => {
    if (!anns) return [];
    if (filter === "unread") return anns.filter((a) => !a.read);
    if (filter === "urgent") return anns.filter((a) => a.priority === "urgent");
    return anns;
  }, [anns, filter]);

  const pinned = filtered.filter((a) => a.pinned);
  const recent = filtered.filter((a) => !a.pinned);
  const muted = user?.notificationPrefs?.announcements === false;

  const toggleMute = async () => {
    setMuteBusy(true);
    try {
      await api.patch("/me/profile", { notificationPrefs: { ...(user?.notificationPrefs ?? {}), announcements: muted } });
      await refresh();
    } finally {
      setMuteBusy(false);
    }
  };

  const markAllRead = async () => {
    setMarkAllBusy(true);
    try {
      await api.post("/announcements/read-all");
      setAnns((prev) => prev?.map((a) => ({ ...a, read: true })) ?? prev);
    } finally {
      setMarkAllBusy(false);
    }
  };

  const markRead = (id: string) => {
    setAnns((prev) => prev?.map((a) => (a.id === id ? { ...a, read: true } : a)) ?? prev);
    api.post(`/announcements/${id}/read`).catch(() => {});
  };

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const TABS: { key: Filter; labelKey: string; count: number }[] = [
    { key: "all", labelKey: "ann.tabAll", count: anns?.length ?? 0 },
    { key: "unread", labelKey: "ann.tabUnread", count: unreadCount },
    { key: "urgent", labelKey: "ann.tabUrgent", count: urgentCount },
  ];

  return (
    <Shell>
      <div className="fade-in mx-auto max-w-4xl">
        <PageHeader
          title={t("ann.title")}
          subtitle={t("ann.subtitle")}
          actions={
            anns && anns.length > 0 ? (
              <>
                {unreadCount > 0 && (
                  <button
                    onClick={markAllRead}
                    disabled={markAllBusy}
                    className="rounded-full px-3 py-1.5 text-xs font-semibold text-[#08090a] disabled:opacity-60"
                    style={{ background: LIME }}
                  >
                    {t("ann.markAllRead")}
                  </button>
                )}
                <button
                  onClick={toggleMute}
                  disabled={muteBusy}
                  title={t(muted ? "ann.unmuteTooltip" : "ann.muteTooltip")}
                  className={clsx(
                    "flex h-8 w-8 items-center justify-center rounded-full border transition disabled:opacity-60",
                    muted ? "border-rose-500/40 text-rose-400" : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)]"
                  )}
                >
                  {muted ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
                </button>
              </>
            ) : undefined
          }
        />

        {error && <p className="mt-6 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</p>}

        {!anns && !error && (
          <div className="mt-6 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-xl border p-5" style={{ background: CARD, borderColor: BORDER }}>
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="mt-3 h-3 w-full" />
                <Skeleton className="mt-2 h-3 w-2/3" />
              </div>
            ))}
          </div>
        )}

        {anns && anns.length > 0 && (
          <div className="mt-5 flex items-center gap-6 border-b" style={{ borderColor: BORDER }}>
            {TABS.map((tb) => (
              <button
                key={tb.key}
                onClick={() => setFilter(tb.key)}
                className="-mb-px flex items-center gap-1.5 border-b-2 pb-2.5 text-sm font-medium transition"
                style={filter === tb.key ? { borderColor: LIME, color: LIME } : { borderColor: "transparent", color: "var(--muted)" }}
              >
                {t(tb.labelKey)}
                <span className="text-[11px]" style={{ fontFamily: MONO }}>
                  {tb.count}
                </span>
              </button>
            ))}
          </div>
        )}

        {anns && anns.length === 0 && <EmptyState className="mt-6" icon={Megaphone} title={t("ann.none")} hint={t("ann.noneHint")} />}

        {anns && anns.length > 0 && filtered.length === 0 && (
          <EmptyState className="mt-6" icon={Megaphone} title={filter === "unread" ? t("ann.noUnread") : t("ann.noUrgent")} />
        )}

        {pinned.length > 0 && (
          <div className="mt-5">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: LIME, fontFamily: MONO }}>
              <Pin className="h-3 w-3" /> {t("ann.pinned")}
            </div>
            <div className="space-y-3">
              {pinned.map((a) => (
                <AnnCard key={a.id} a={a} t={t} expanded={expanded.has(a.id)} onToggle={() => toggleExpand(a.id)} onMarkRead={() => markRead(a.id)} />
              ))}
            </div>
          </div>
        )}

        {pinned.length > 0 && recent.length > 0 && (
          <div className="my-5 flex items-center gap-3">
            <span className="h-px flex-1" style={{ background: BORDER }} />
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--muted)", fontFamily: MONO }}>
              {t("ann.recent")}
            </span>
            <span className="h-px flex-1" style={{ background: BORDER }} />
          </div>
        )}

        {recent.length > 0 && (
          <div className={clsx("space-y-3", pinned.length === 0 && "mt-5")}>
            {recent.map((a) => (
              <AnnCard key={a.id} a={a} t={t} expanded={expanded.has(a.id)} onToggle={() => toggleExpand(a.id)} onMarkRead={() => markRead(a.id)} />
            ))}
          </div>
        )}
      </div>
    </Shell>
  );
}

function AnnCard({ a, t, expanded, onToggle, onMarkRead }: { a: Ann; t: TFn; expanded: boolean; onToggle: () => void; onMarkRead: () => void }) {
  const meta = PRIORITY_META[a.priority];
  const Icon = meta.icon;
  const long = a.message.length > 180 || a.message.split("\n").length > 3;

  return (
    <div className="relative rounded-xl border p-5 transition" style={{ background: a.read ? CARD : "#171d09", borderColor: a.read ? BORDER : "rgba(200,240,0,0.28)" }}>
      {!a.read && <span className="absolute right-4 top-4 h-2 w-2 rounded-full" style={{ background: LIME }} />}
      <div className="flex items-start gap-2.5 pr-6">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={{ background: meta.bg, color: meta.color }}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <p className="text-base font-semibold text-white" style={{ fontFamily: BARLOW, letterSpacing: "0.01em" }}>
            {a.title}
          </p>
          <span className="mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ background: meta.bg, color: meta.color }}>
            {t(meta.labelKey)}
          </span>
        </div>
      </div>

      <p className={clsx("mt-3 whitespace-pre-line text-sm text-[var(--fg)]", !expanded && "line-clamp-2")}>{a.message}</p>
      {long && (
        <button onClick={onToggle} className="mt-1 text-xs font-medium" style={{ color: LIME }}>
          {expanded ? t("ann.showLess") : t("ann.readMore")}
        </button>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t pt-3 text-[11px]" style={{ borderColor: BORDER, color: "var(--muted)", fontFamily: MONO }}>
        <span title={fmtFull(a.sentAt)}>{fmtRel(a.sentAt, t)}</span>
        {a.department && (
          <span className="rounded border px-1.5 py-0.5" style={{ borderColor: BORDER }}>
            {a.department}
          </span>
        )}
        <span>{a.author}</span>
        <span className="ml-auto">
          {a.read ? (
            <span className="inline-flex items-center gap-1">
              <Check className="h-3 w-3" /> {t("ann.markAsRead")}
            </span>
          ) : (
            <button onClick={onMarkRead} className="inline-flex items-center gap-1 transition hover:text-white" style={{ color: LIME }}>
              <Check className="h-3 w-3" /> {t("ann.markAsRead")}
            </button>
          )}
        </span>
      </div>
    </div>
  );
}
