import { useEffect, useState } from "react";
import { Users, Loader2, UserPlus, Trash2, X, ShieldCheck, ClipboardCheck, Radio } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { PageHeader } from "@/components/PageHeader";
import { TableSkeleton } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { clsx } from "clsx";

interface Member { id: string; name: string; email: string; role: string; }

const ROLES = [
  { value: "admin", labelKey: "ateam.roleAdmin", descKey: "ateam.roleAdminDesc", icon: ShieldCheck },
  { value: "facilitator", labelKey: "ateam.roleFacilitator", descKey: "ateam.roleFacilitatorDesc", icon: ClipboardCheck },
  { value: "proctor", labelKey: "ateam.roleProctor", descKey: "ateam.roleProctorDesc", icon: Radio },
];
const initials = (n: string) => n.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const ROLE_PILL: Record<string, string> = {
  admin: "bg-[#c6ff34]/15 text-[#c6ff34]", facilitator: "bg-[#06B6D4]/15 text-[#06B6D4]", proctor: "bg-[#F59E0B]/15 text-[#F59E0B]",
};

export function AdminTeam() {
  const t = useT();
  const { user } = useAuth();
  const [rows, setRows] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState(false);
  const [del, setDel] = useState<Member | null>(null);

  const load = () => api.get<{ team: Member[] }>("/admin/team").then((d) => setRows(d.team)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const adminCount = (rows ?? []).filter((r) => r.role === "admin").length;

  async function changeRole(m: Member, role: string) {
    setError(null);
    if (m.role === "admin" && role !== "admin" && adminCount <= 1) {
      setError(t("ateam.errLastAdmin"));
      load(); // reset the select back
      return;
    }
    try { await api.patch(`/admin/team/${m.id}`, { role }); load(); }
    catch (e) { setError((e as Error).message); load(); }
  }

  return (
    <AdminShell wide>
      <div className="fade-in max-w-4xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <PageHeader title={t("ateam.title")} subtitle={t("ateam.subtitle")} />
          </div>
          <button onClick={() => setInvite(true)} className="btn btn-primary"><UserPlus className="h-4 w-4" /> {t("ateam.invite")}</button>
        </div>

        {error && <p className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</p>}

        {/* Role legend */}
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {ROLES.map((r) => (
            <div key={r.value} className="card flex items-start gap-2.5 p-3">
              <span className={clsx("flex h-8 w-8 items-center justify-center rounded-lg", ROLE_PILL[r.value])}><r.icon className="h-4 w-4" /></span>
              <div><p className="text-sm font-semibold">{t(r.labelKey)}</p><p className="text-xs text-[var(--muted)]">{t(r.descKey)}</p></div>
            </div>
          ))}
        </div>

        <div className="card mt-5 overflow-hidden">
          {!rows ? (
            <TableSkeleton rows={4} cells={2} />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
                  <th className="px-4 py-3 font-semibold">{t("ateam.colMember")}</th>
                  <th className="px-3 py-3 font-semibold">{t("ateam.colRole")}</th>
                  <th className="px-3 py-3 text-right font-semibold">{t("ateam.colActions")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id} className="border-b border-[var(--border)] last:border-0 hover:bg-white/[0.02]">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#111110] text-[11px] font-bold text-white">{initials(m.name)}</span>
                        <span>
                          <span className="block font-medium">{m.name}{m.id === user?.id && <span className="ml-1.5 text-xs text-[var(--muted)]">{t("ateam.you")}</span>}</span>
                          <span className="block text-xs text-[var(--muted)]">{m.email}</span>
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <select value={m.role} onChange={(e) => changeRole(m, e.target.value)}
                        className={clsx("rounded-lg border-0 px-2 py-1 text-xs font-semibold outline-none", ROLE_PILL[m.role])}>
                        {ROLES.map((r) => <option key={r.value} value={r.value} className="bg-[var(--card)] text-[var(--fg)]">{t(r.labelKey)}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-3 text-right">
                      {(() => {
                        const isSelf = m.id === user?.id;
                        const lastAdmin = m.role === "admin" && adminCount <= 1;
                        const blocked = isSelf || lastAdmin;
                        return (
                          <button onClick={() => setDel(m)} disabled={blocked}
                            title={isSelf ? t("ateam.cantRemoveSelf") : lastAdmin ? t("ateam.cantRemoveLastAdmin") : t("ateam.remove")}
                            className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-rose-500/10 hover:text-rose-400 disabled:cursor-not-allowed disabled:opacity-40">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        );
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {invite && <InviteModal onClose={() => setInvite(false)} onDone={() => { setInvite(false); load(); }} />}
      {del && <DeleteModal member={del} onClose={() => setDel(null)} onDone={() => { setDel(null); load(); }} />}
    </AdminShell>
  );
}

function InviteModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [role, setRole] = useState("facilitator");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const pwLongEnough = password.length >= 12;
  const pwVaried = password.length === 0 || new Set(password).size >= 5;
  const valid = name.trim().length > 0 && emailOk && pwLongEnough && pwVaried;
  async function save() {
    if (!valid) return;
    setBusy(true); setErr(null);
    try { await api.post("/admin/team", { name, email, password, role }); onDone(); } catch (e) { setErr((e as Error).message); setBusy(false); }
  }
  return (
    <Modal title={t("ateam.inviteTitle")} onClose={onClose}>
      <div className="mt-4 space-y-3">
        <Field label={t("ateam.fullName")}><input className="input h-10" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" /></Field>
        <Field label={t("ateam.email")}>
          <input className="input h-10" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@institution.edu" />
          {email.trim() && !emailOk && <span className="mt-1 block text-xs text-rose-400">{t("ateam.invalidEmail")}</span>}
        </Field>
        <Field label={t("ateam.tempPassword")}>
          <input type="password" className="input h-10" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("ateam.min6")} />
          {password.length > 0 && (!pwLongEnough || !pwVaried) && <span className="mt-1 block text-xs text-rose-400">{t("ateam.atLeast6")}</span>}
        </Field>
        <div>
          <span className="mb-1 block text-sm font-medium">{t("ateam.role")}</span>
          <div className="space-y-2">
            {ROLES.map((r) => (
              <label key={r.value} className={clsx("flex cursor-pointer items-center gap-2.5 rounded-xl border p-3", role === r.value ? "border-brand-500 bg-brand-600/10" : "border-[var(--border)]")}>
                <input type="radio" checked={role === r.value} onChange={() => setRole(r.value)} />
                <span className={clsx("flex h-7 w-7 items-center justify-center rounded-lg", ROLE_PILL[r.value])}><r.icon className="h-4 w-4" /></span>
                <span><span className="block text-sm font-medium">{t(r.labelKey)}</span><span className="block text-xs text-[var(--muted)]">{t(r.descKey)}</span></span>
              </label>
            ))}
          </div>
        </div>
        {err && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">{err}</p>}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--fg)]">{t("ateam.cancel")}</button>
        <button onClick={save} disabled={busy || !valid} className="btn btn-primary disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} {t("ateam.inviteBtn")}</button>
      </div>
    </Modal>
  );
}

function DeleteModal({ member, onClose, onDone }: { member: Member; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  async function del() { setBusy(true); setErr(null); try { await api.del(`/admin/team/${member.id}`); onDone(); } catch (e) { setErr((e as Error).message); setBusy(false); } }
  return (
    <Modal title={t("ateam.removeTitle")} onClose={onClose}>
      <p className="mt-3 text-sm text-[var(--muted)]">{t("ateam.removeWarn", { name: member.name })}</p>
      {err && <p className="mt-2 text-sm text-rose-500">{err}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} disabled={busy} className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--fg)]">{t("ateam.cancel")}</button>
        <button onClick={del} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} {t("ateam.remove")}</button>
      </div>
    </Modal>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h2 className="text-lg font-bold">{title}</h2><button onClick={onClose} className="rounded-lg p-1 text-[var(--muted)] hover:bg-white/[0.05]"><X className="h-5 w-5" /></button></div>
        {children}
      </div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-sm font-medium">{label}</span>{children}</label>;
}
