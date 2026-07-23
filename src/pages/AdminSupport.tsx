import { useEffect, useState } from "react";
import { LifeBuoy, Loader2, Plus, Send, Check } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { PageHeader } from "@/components/PageHeader";
import { TableSkeleton, Modal, ErrorBanner } from "@/components/ui";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { clsx } from "clsx";

interface TicketMessage { id: string; authorType: "tenant" | "superadmin"; authorName: string; body: string; at: string; }
interface Ticket { id: string; subject: string; status: "open" | "in_progress" | "resolved" | "closed"; createdBy: { id: string; name: string; email: string }; createdAt: string; updatedAt: string; messages: TicketMessage[]; }

const STATUS_TONE: Record<Ticket["status"], string> = {
  open: "bg-blue-500/15 text-blue-400",
  in_progress: "bg-amber-500/15 text-amber-400",
  resolved: "bg-emerald-500/15 text-emerald-400",
  closed: "bg-[var(--card-2)] text-[var(--muted)]",
};

const fmt = (s: string) => new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function AdminSupport() {
  const t = useT();
  const [rows, setRows] = useState<Ticket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<Ticket | null>(null);

  const load = () => api.get<{ tickets: Ticket[] }>("/support/tickets").then((d) => setRows(d.tickets)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  return (
    <AdminShell wide>
      <div className="fade-in max-w-3xl">
        <div className="flex items-center justify-between gap-3">
          <PageHeader title={t("asup.title")} subtitle={t("asup.subtitle")} />
          <button onClick={() => setCreating(true)} className="btn btn-primary shrink-0"><Plus className="h-4 w-4" /> {t("asup.newTicket")}</button>
        </div>

        {error && <ErrorBanner className="mt-4">{error}</ErrorBanner>}

        <div className="card mt-6 overflow-hidden">
          {!rows ? (
            <TableSkeleton rows={3} cells={3} />
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-10 text-sm text-[var(--muted)]"><LifeBuoy className="h-8 w-8" /> {t("asup.none")}</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
                  <th className="px-4 py-3 font-semibold">{t("asup.colSubject")}</th>
                  <th className="px-3 py-3 font-semibold">{t("asup.colStatus")}</th>
                  <th className="px-3 py-3 font-semibold">{t("asup.colUpdated")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((tk) => (
                  <tr key={tk.id} className="cursor-pointer border-b border-[var(--border)] last:border-0 hover:bg-white/[0.02]" onClick={() => setOpen(tk)}>
                    <td className="px-4 py-3 font-medium">{tk.subject}</td>
                    <td className="px-3 py-3"><span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS_TONE[tk.status])}>{t(`asup.status.${tk.status}`)}</span></td>
                    <td className="px-3 py-3 text-xs text-[var(--muted)]">{fmt(tk.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {creating && <NewTicketModal onClose={() => setCreating(false)} onDone={(tk) => { setCreating(false); load(); setOpen(tk); }} />}
      {open && <ThreadModal ticket={open} onClose={() => setOpen(null)} onChanged={(tk) => { setOpen(tk); load(); }} />}
    </AdminShell>
  );
}

function NewTicketModal({ onClose, onDone }: { onClose: () => void; onDone: (t: Ticket) => void }) {
  const t = useT();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const valid = subject.trim().length > 0 && body.trim().length > 0;

  async function save() {
    if (!valid) return;
    setBusy(true); setErr(null);
    try { const r = await api.post<{ ticket: Ticket }>("/support/tickets", { subject, body }); onDone(r.ticket); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  return (
    <Modal title={t("asup.newTicketTitle")} onClose={onClose}>
      <div className="mt-4 space-y-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">{t("asup.colSubject")}</span>
          <input className="input h-10" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} placeholder={t("asup.subjectPlaceholder")} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">{t("asup.message")}</span>
          <textarea className="input min-h-28 py-2" value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} placeholder={t("asup.messagePlaceholder")} />
        </label>
        {err && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">{err}</p>}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--fg)]">{t("ateam.cancel")}</button>
        <button onClick={save} disabled={busy || !valid} className="btn btn-primary disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {t("asup.submit")}</button>
      </div>
    </Modal>
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
    try { const r = await api.post<{ ticket: Ticket }>(`/support/tickets/${ticket.id}/messages`, { body: reply }); setReply(""); onChanged(r.ticket); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Modal title={ticket.subject} onClose={onClose}>
      <div className="mt-2 flex items-center gap-2">
        <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS_TONE[ticket.status])}>{t(`asup.status.${ticket.status}`)}</span>
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
      {ticket.status !== "closed" ? (
        <div className="mt-4">
          <textarea className="input min-h-20 py-2" value={reply} onChange={(e) => setReply(e.target.value)} maxLength={5000} placeholder={t("asup.replyPlaceholder")} />
          {err && <p className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">{err}</p>}
          <div className="mt-3 flex justify-end">
            <button onClick={send} disabled={busy || !reply.trim()} className="btn btn-primary disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {t("asup.reply")}</button>
          </div>
        </div>
      ) : (
        <p className="mt-4 flex items-center gap-1.5 text-xs text-[var(--muted)]"><Check className="h-3.5 w-3.5" /> {t("asup.closedHint")}</p>
      )}
    </Modal>
  );
}
