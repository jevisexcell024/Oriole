import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Bell, CheckCircle2, Megaphone, ClipboardCheck, Clock, FileText, Inbox as InboxIcon, CheckCheck } from "lucide-react";
import { Shell } from "@/components/Shell";
import { AdminShell } from "@/components/AdminShell";
import { PageHeader } from "@/components/PageHeader";
import { api } from "@/lib/api";
import { useT, type TFn } from "@/lib/i18n";
import { clsx } from "clsx";

interface Notif { id: string; type: string; title: string; body: string; at: string; link: string; }

const ICONS: Record<string, typeof Bell> = { result: CheckCircle2, reminder: Clock, announcement: Megaphone, grading: ClipboardCheck, submission: FileText };
const TINT: Record<string, string> = { result: "#16A34A", reminder: "#c6ff34", announcement: "#0EA5E9", grading: "#E9B949", submission: "#c6ff34" };
const SEEN_KEY = "orcalis-inbox-seen";

function ago(iso: string, t: TFn) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return t("inbox.justNow");
  const m = s / 60; if (m < 60) return t("inbox.mAgo", { n: Math.floor(m) });
  const h = m / 60; if (h < 24) return t("inbox.hAgo", { n: Math.floor(h) });
  const d = h / 24; if (d < 7) return t("inbox.dAgo", { n: Math.floor(d) });
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function InboxView() {
  const t = useT();
  const navigate = useNavigate();
  const [items, setItems] = useState<Notif[] | null>(null);
  const [seen, setSeen] = useState<string>(() => { try { return localStorage.getItem(SEEN_KEY) ?? ""; } catch { return ""; } });

  useEffect(() => { api.get<{ notifications: Notif[] }>("/notifications").then((d) => setItems(d.notifications)).catch(() => setItems([])); }, []);

  const isUnread = (n: Notif) => !seen || (!!n.at && n.at > seen);
  const unreadCount = (items ?? []).filter(isUnread).length;
  const markAll = () => { const t = new Date().toISOString(); try { localStorage.setItem(SEEN_KEY, t); } catch { /* ignore */ } setSeen(t); };

  return (
    <div className="fade-in max-w-[860px]">
      <PageHeader
        title={<span className="inline-flex items-center gap-2"><InboxIcon className="h-6 w-6" /> {t("inbox.title")}{unreadCount > 0 ? <span className="rounded-full bg-[#c6ff34] px-2 py-0.5 text-xs font-bold text-[#111110]">{unreadCount}</span> : null}</span>}
        subtitle={t("inbox.subtitle")}
        actions={unreadCount > 0 ? <button onClick={markAll} className="btn btn-ghost-teal"><CheckCheck className="h-4 w-4" /> {t("inbox.markAll")}</button> : undefined}
      />

      {!items ? (
        <div className="mt-8 flex items-center gap-2 text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}</div>
      ) : items.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-2 rounded-2xl border border-dashed border-[var(--border)] py-16 text-center">
          <Bell className="h-8 w-8 text-[var(--muted)]" />
          <p className="text-sm font-semibold">{t("inbox.caughtUp")}</p>
          <p className="text-sm text-[var(--muted)]">{t("inbox.caughtUpHint")}</p>
        </div>
      ) : (
        <div className="card mt-6 overflow-hidden rounded-2xl divide-y divide-[var(--border)]">
          {items.map((n) => {
            const Icon = ICONS[n.type] ?? Bell;
            const tint = TINT[n.type] ?? "#c6ff34";
            const unread = isUnread(n);
            return (
              <button key={n.id} onClick={() => { markAll(); navigate(n.link); }}
                className={clsx("flex w-full items-start gap-3 px-4 py-3.5 text-left transition hover:bg-[var(--card-2)]", unread && "bg-[rgba(198,255,52,0.05)]")}>
                <span className="relative mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: `${tint}22`, color: tint }}>
                  <Icon className="h-4 w-4" />
                  {unread && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-[#c6ff34] ring-2 ring-[var(--card)]" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className={clsx("truncate text-sm", unread ? "font-semibold" : "font-medium")}>{n.title}</p>
                    <span className="shrink-0 text-[11px] text-[var(--muted)]">{ago(n.at, t)}</span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs text-[var(--muted)]">{n.body}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function StudentInbox() { return <Shell><InboxView /></Shell>; }
export function AdminInbox() { return <AdminShell wide><InboxView /></AdminShell>; }
