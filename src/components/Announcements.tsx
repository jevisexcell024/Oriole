import { useEffect, useState } from "react";
import { Bell, Megaphone, AlertTriangle, X } from "lucide-react";
import { api } from "@/lib/api";
import { clsx } from "clsx";

export interface PortalAnnouncement {
  id: string; title: string; message: string; priority: string; sentAt: string;
}

const SEEN_KEY = "orcalis:announcements:lastSeen";
const fmt = (s: string) => new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

const PRIORITY: Record<string, { dot: string; chip: string; label: string }> = {
  urgent: { dot: "bg-rose-500", chip: "bg-rose-500/20 text-rose-400", label: "Urgent" },
  high: { dot: "bg-amber-500", chip: "bg-amber-500/20 text-amber-400", label: "High" },
  normal: { dot: "bg-brand-500", chip: "bg-[var(--card-2)] text-[var(--muted)]", label: "Normal" },
};

function useAnnouncements() {
  const [items, setItems] = useState<PortalAnnouncement[]>([]);
  useEffect(() => {
    api.get<{ announcements: PortalAnnouncement[] }>("/announcements")
      .then((d) => setItems(d.announcements)).catch(() => {});
  }, []);
  return items;
}

/** Header bell with an unread badge (tracked client-side via last-seen timestamp). */
export function NotificationsBell() {
  const items = useAnnouncements();
  const [open, setOpen] = useState(false);
  const [lastSeen, setLastSeen] = useState<string>(() => localStorage.getItem(SEEN_KEY) ?? "");
  const unread = items.filter((a) => !lastSeen || a.sentAt > lastSeen).length;

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && items.length) {
      const now = new Date().toISOString();
      localStorage.setItem(SEEN_KEY, now);
      setLastSeen(now);
    }
  }

  return (
    <div className="relative">
      <button onClick={toggle} title="Announcements"
        className="relative rounded-lg p-2 text-[var(--muted)] hover:bg-white/[0.04] hover:text-[var(--fg)]">
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">{unread}</span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 w-80 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5">
              <span className="text-sm font-semibold">Announcements</span>
              <button onClick={() => setOpen(false)} className="rounded p-1 text-[var(--muted)] hover:bg-white/[0.05]"><X className="h-4 w-4" /></button>
            </div>
            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-[var(--muted)]">No announcements.</p>
            ) : (
              <div className="max-h-96 divide-y divide-[var(--border)] overflow-y-auto">
                {items.map((a) => {
                  const p = PRIORITY[a.priority] ?? PRIORITY.normal;
                  return (
                    <div key={a.id} className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={clsx("h-2 w-2 shrink-0 rounded-full", p.dot)} />
                        <p className="text-sm font-semibold">{a.title}</p>
                      </div>
                      <p className="mt-1 line-clamp-3 whitespace-pre-line text-xs text-[var(--muted)]">{a.message}</p>
                      <p className="mt-1 text-[11px] text-[var(--muted)]">{fmt(a.sentAt)}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Inline banner of active announcements for the candidate landing page. */
export function AnnouncementsBanner() {
  const items = useAnnouncements();
  if (items.length === 0) return null;
  return (
    <div className="mb-6 space-y-2">
      {items.slice(0, 3).map((a) => {
        const p = PRIORITY[a.priority] ?? PRIORITY.normal;
        const urgent = a.priority === "urgent" || a.priority === "high";
        return (
          <div key={a.id} className={clsx("flex items-start gap-3 rounded-xl border p-4",
            urgent ? "border-amber-500/30 bg-amber-500/15" : "border-[var(--border)] bg-[var(--card)]")}>
            {urgent ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" /> : <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold">{a.title}</p>
                <span className={clsx("rounded-full px-2 py-0.5 text-[10px] font-semibold", p.chip)}>{p.label}</span>
              </div>
              <p className="mt-1 whitespace-pre-line text-sm text-[var(--muted)]">{a.message}</p>
              <p className="mt-1 text-[11px] text-[var(--muted)]">{fmt(a.sentAt)}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
