import { useEffect, useMemo, useState } from "react";
import { LifeBuoy, Loader2, Send } from "lucide-react";
import { SuperAdminShell } from "@/components/SuperAdminShell";
import { PageHeader } from "@/components/PageHeader";
import { TableSkeleton, Modal, ErrorBanner } from "@/components/ui";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { clsx } from "clsx";

interface TicketMessage { id: string; authorType: "tenant" | "superadmin"; authorName: string; body: string; at: string; }
type Status = "open" | "in_progress" | "resolved" | "closed";
interface Ticket { id: string; subject: string; status: Status; createdBy: { id: string; name: string; email: string }; createdAt: string; updatedAt: string; messages: TicketMessage[]; }

const STATUS_TONE: Record<Status, string> = {
  open: "bg-blue-500/15 text-blue-400",
  in_progress: "bg-amber-500/15 text-amber-400",
  resolved: "bg-emerald-500/15 text-emerald-400",
  closed: "bg-[var(--card-2)] text-[var(--muted)]",
};
const STATUSES: Status[] = ["open", "in_progress", "resolved", "closed"];
const fmt = (s: string) => new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function SuperAdminTickets() {
  const t = useT();
  const [rows, setRows] = useState<Ticket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Status | "all">("all");
  const [open, setOpen] = useState<Ticket | null>(null);

  const load = () => api.get<{ tickets: Ticket[] }>("/super-admin/tickets").then((d) => setRows(d.tickets)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => (rows ?? []).filter((tk) => filter === "all" || tk.status === filter), [rows, filter]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows?.length ?? 0 };
    for (const s of STATUSES) c[s] = (rows ?? []).filter((tk) => tk.status === s).length;
    return c;
  }, [rows]);

  return (
    <SuperAdminShell>
      <div className="fade-in max-w-4xl">
        <PageHeader eyebrow={t("sad.dashEyebrow")} title={t("sad.ticketsTitle")} subtitle={t("sad.ticketsSubtitle")} />

        {error && <ErrorBanner className="mt-4">{error}</ErrorBanner>}

        <div className="mt-5 flex flex-wrap gap-1.5">
          {(["all", ...STATUSES] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={clsx(
                "rounded-full px-3 py-1.5 text-xs font-semibold transition",
                filter === s ? "bg-[#c6ff34] text-[#111110]" : "bg-[var(--card-2)] text-[var(--muted)] hover:text-[var(--fg)]",
              )}
            >
              {s === "all" ? t("sad.ticketsAll") : t(`asup.status.${s}`)} · {counts[s] ?? 0}
            </button>
          ))}
        </div>

        <div className="card mt-4 overflow-hidden">
          {!rows ? (
            <TableSkeleton rows={3} cells={4} />
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-10 text-sm text-[var(--muted)]"><LifeBuoy className="h-8 w-8" /> {t("asup.none")}</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
                  <th className="px-4 py-3 font-semibold">{t("asup.colSubject")}</th>
                  <th className="px-3 py-3 font-semibold">{t("sad.ticketsFrom")}</th>
                  <th className="px-3 py-3 font-semibold">{t("asup.colStatus")}</th>
                  <th className="px-3 py-3 font-semibold">{t("asup.colUpdated")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((tk) => (
                  <tr key={tk.id} className="cursor-pointer border-b border-[var(--border)] last:border-0 hover:bg-white/[0.02]" onClick={() => setOpen(tk)}>
                    <td className="px-4 py-3 font-medium">{tk.subject}</td>
                    <td className="px-3 py-3 text-xs text-[var(--muted)]">{tk.createdBy.name}</td>
                    <td className="px-3 py-3"><span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS_TONE[tk.status])}>{t(`asup.status.${tk.status}`)}</span></td>
                    <td className="px-3 py-3 text-xs text-[var(--muted)]">{fmt(tk.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {open && <ThreadModal ticket={open} onClose={() => setOpen(null)} onChanged={(tk) => { setOpen(tk); load(); }} />}
    </SuperAdminShell>
  );
}

function ThreadModal({ ticket, onClose, onChanged }: { ticket: Ticket; onClose: () => void; onChanged: (t: Ticket) => void }) {
  const t = useT();
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function send() {
    if (!reply.trim()) return;
    setBusy(true); setErr(null);
    try { const r = await api.post<{ ticket: Ticket }>(`/super-admin/tickets/${ticket.id}/messages`, { body: reply }); setReply(""); onChanged(r.ticket); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  async function setStatus(status: Status) {
    setBusy(true); setErr(null);
    try { const r = await api.patch<{ ticket: Ticket }>(`/super-admin/tickets/${ticket.id}`, { status }); onChanged(r.ticket); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Modal title={ticket.subject} onClose={onClose}>
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-xs text-[var(--muted)]">{t("sad.ticketsFrom")}: <span className="font-medium text-[var(--fg)]">{ticket.createdBy.name}</span> ({ticket.createdBy.email})</p>
        <select
          value={ticket.status}
          onChange={(e) => setStatus(e.target.value as Status)}
          disabled={busy}
          className={clsx("rounded-full border-0 px-2.5 py-1 text-xs font-semibold outline-none", STATUS_TONE[ticket.status])}
        >
          {STATUSES.map((s) => <option key={s} value={s} className="bg-[var(--card)] text-[var(--fg)]">{t(`asup.status.${s}`)}</option>)}
        </select>
      </div>

      <div className="mt-3 max-h-80 space-y-3 overflow-y-auto pr-1">
        {ticket.messages.map((m) => (
          <div key={m.id} className={clsx("rounded-xl border p-3 text-sm", m.authorType === "superadmin" ? "border-[#c6ff34]/25 bg-[#c6ff34]/[0.06]" : "border-[var(--border)] bg-[var(--card-2)]")}>
            <div className="mb-1 flex items-center justify-between text-xs text-[var(--muted)]">
              <span className="font-semibold text-[var(--fg)]">{m.authorType === "superadmin" ? t("asup.platformSupport") : m.authorName}</span>
              <span>{fmt(m.at)}</span>
            </div>
            <p className="whitespace-pre-wrap">{m.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <textarea className="input min-h-20 py-2" value={reply} onChange={(e) => setReply(e.target.value)} maxLength={5000} placeholder={t("asup.replyPlaceholder")} />
        {err && <p className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">{err}</p>}
        <div className="mt-3 flex justify-end">
          <button onClick={send} disabled={busy || !reply.trim()} className="btn btn-primary disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {t("asup.reply")}</button>
        </div>
      </div>
    </Modal>
  );
}
