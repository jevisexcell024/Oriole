import { useEffect, useState } from "react";
import { Users, Loader2, UserPlus, Trash2, X, ShieldCheck, ClipboardCheck, Radio, Check, CheckCircle2, Lock, Shield, Clock } from "lucide-react";
import { Link } from "react-router-dom";
import { AdminShell } from "@/components/AdminShell";
import { PageHeader } from "@/components/PageHeader";
import { TableSkeleton, Modal, ErrorBanner } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { useT, type TFn } from "@/lib/i18n";
import { initials } from "@/lib/format";
import { clsx } from "clsx";

interface Member { id: string; name: string; email: string; role: string; customRoleId?: string | null; roleExpiresAt?: string | null; }
interface CustomRoleOption { id: string; name: string; }

// Each role's responsibility list is one pipe-separated i18n string (rather than
// N separate keys) so the localized copy stays easy to maintain per language.
const ROLES = [
  { value: "admin", labelKey: "ateam.roleAdmin", descKey: "ateam.roleAdminDesc", respKey: "ateam.roleAdminResp", accessKey: "ateam.accessFull", icon: ShieldCheck },
  { value: "facilitator", labelKey: "ateam.roleFacilitator", descKey: "ateam.roleFacilitatorDesc", respKey: "ateam.roleFacilitatorResp", accessKey: "ateam.accessAcademic", icon: ClipboardCheck },
  { value: "proctor", labelKey: "ateam.roleProctor", descKey: "ateam.roleProctorDesc", respKey: "ateam.roleProctorResp", accessKey: "ateam.accessMonitoring", icon: Radio },
];
const ROLE_PILL: Record<string, string> = {
  admin: "bg-[#c6ff34]/15 text-[#c6ff34]", facilitator: "bg-[#06B6D4]/15 text-[#06B6D4]", proctor: "bg-[#F59E0B]/15 text-[#F59E0B]",
};
const PREVIEW_COUNT = 4;

/**
 * A role's full card: icon, description, a short responsibility preview with
 * an expandable "+N more", permission count, and access-level badge. Used both
 * as a read-only legend (no onSelect) and as the interactive picker in the
 * invite form (onSelect + selected).
 */
function RoleCard({ role, t, selected, onSelect }: {
  role: (typeof ROLES)[number]; t: TFn; selected?: boolean; onSelect?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const resp = t(role.respKey).split("|");
  const shown = expanded ? resp : resp.slice(0, PREVIEW_COUNT);
  const hiddenCount = resp.length - PREVIEW_COUNT;
  return (
    <div
      onClick={onSelect}
      className={clsx(
        "group relative rounded-2xl border p-4 transition-all duration-150",
        onSelect && "cursor-pointer hover:-translate-y-0.5 hover:shadow-lg",
        selected ? "border-[#c6ff34] bg-[#c6ff34]/[0.06] ring-1 ring-[#c6ff34]/40" : "border-[var(--border)] hover:border-[var(--border-strong)]",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className={clsx("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", ROLE_PILL[role.value])}><role.icon className="h-5 w-5" /></span>
          <div>
            <p className="text-sm font-bold">{t(role.labelKey)}</p>
            <p className="text-xs text-[var(--muted)]">{t(role.descKey)}</p>
          </div>
        </div>
        {selected ? (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#c6ff34] text-[#111110]"><Check className="h-3.5 w-3.5" /></span>
        ) : (
          <span title={t("ateam.systemRoleTitle")} className="flex shrink-0 items-center gap-1 rounded-full bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]"><Lock className="h-2.5 w-2.5" /> {t("ateam.systemRole")}</span>
        )}
      </div>
      <ul className="mt-3 space-y-1">
        {shown.map((r, i) => <li key={i} className="flex items-start gap-1.5 text-xs text-[var(--muted)]"><CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-[#c6ff34]" /> {r}</li>)}
      </ul>
      <div className="mt-3 flex items-center justify-between border-t border-[var(--border)] pt-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">{t("ateam.permissionsN", { n: resp.length })}</span>
        {hiddenCount > 0 && (
          <button type="button" onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }} className="text-[11px] font-medium text-[#c6ff34] hover:underline">
            {expanded ? t("ateam.showLess") : t("ateam.showMoreN", { n: hiddenCount })}
          </button>
        )}
      </div>
      <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">{t(role.accessKey)}</p>
    </div>
  );
}

export function AdminTeam() {
  const t = useT();
  const { user } = useAuth();
  const [rows, setRows] = useState<Member[] | null>(null);
  const [customRoles, setCustomRoles] = useState<CustomRoleOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState(false);
  const [del, setDel] = useState<Member | null>(null);
  const [assign, setAssign] = useState<Member | null>(null);

  const load = () => api.get<{ team: Member[] }>("/admin/team").then((d) => setRows(d.team)).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    api.get<{ roles: CustomRoleOption[] }>("/admin/roles").then((d) => setCustomRoles(d.roles)).catch(() => { /* optional layer — team page still works without it */ });
  }, []);

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
          <div className="flex items-center gap-2">
            <Link to="/admin/roles" className="btn btn-outline"><Shield className="h-4 w-4" /> {t("anav.roles")}</Link>
            <button onClick={() => setInvite(true)} className="btn btn-primary"><UserPlus className="h-4 w-4" /> {t("ateam.invite")}</button>
          </div>
        </div>

        {error && <ErrorBanner className="mt-4">{error}</ErrorBanner>}

        {/* System roles */}
        <div className="mt-6 flex items-center gap-2">
          <h2 className="text-sm font-semibold">{t("ateam.systemRoles")}</h2>
          <span className="text-xs text-[var(--muted)]">{t("ateam.systemRolesDesc")}</span>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {ROLES.map((r) => <RoleCard key={r.value} role={r} t={t} />)}
        </div>

        <div className="card mt-5 overflow-hidden">
          {!rows ? (
            <TableSkeleton rows={4} cells={3} />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
                  <th className="px-4 py-3 font-semibold">{t("ateam.colMember")}</th>
                  <th className="px-3 py-3 font-semibold">{t("ateam.colRole")}</th>
                  <th className="px-3 py-3 font-semibold">{t("ateam.colCustomRole")}</th>
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
                    <td className="px-3 py-3">
                      <button onClick={() => setAssign(m)} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-[var(--muted)] hover:bg-white/[0.05] hover:text-[var(--fg)]">
                        <Shield className="h-3.5 w-3.5" />
                        {m.customRoleId ? (customRoles.find((r) => r.id === m.customRoleId)?.name ?? t("ateam.customRoleUnknown")) : t("ateam.customRoleNone")}
                        {m.customRoleId && m.roleExpiresAt && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-400"><Clock className="h-2.5 w-2.5" /> {new Date(m.roleExpiresAt).toLocaleDateString()}</span>
                        )}
                      </button>
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
      {assign && <AssignRoleModal member={assign} customRoles={customRoles} onClose={() => setAssign(null)} onDone={() => { setAssign(null); load(); }} />}
    </AdminShell>
  );
}

function AssignRoleModal({ member, customRoles, onClose, onDone }: { member: Member; customRoles: CustomRoleOption[]; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [customRoleId, setCustomRoleId] = useState<string>(member.customRoleId ?? "");
  const [expiresAt, setExpiresAt] = useState<string>(member.roleExpiresAt ? member.roleExpiresAt.slice(0, 10) : "");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  async function save() {
    setBusy(true); setErr(null);
    try {
      await api.patch(`/admin/team/${member.id}/custom-role`, {
        customRoleId: customRoleId || null,
        expiresAt: customRoleId && expiresAt ? new Date(expiresAt).toISOString() : null,
      });
      onDone();
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }
  return (
    <Modal title={t("ateam.assignRoleTitle")} onClose={onClose}>
      <div className="mt-4 space-y-3">
        <p className="text-sm text-[var(--muted)]">{t("ateam.assignRoleDesc", { name: member.name })}</p>
        <Field label={t("arole.title")}>
          <select className="input h-10" value={customRoleId} onChange={(e) => setCustomRoleId(e.target.value)}>
            <option value="">{t("ateam.customRoleNone")}</option>
            {customRoles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
        {customRoleId && (
          <Field label={t("ateam.expiresOn")}>
            <input type="date" className="input h-10" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </Field>
        )}
        {err && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">{err}</p>}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--fg)]">{t("ateam.cancel")}</button>
        <button onClick={save} disabled={busy} className="btn btn-primary disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {t("ateam.save")}</button>
      </div>
    </Modal>
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
          <span className="mb-1.5 block text-sm font-medium">{t("ateam.role")}</span>
          <div className="space-y-2.5">
            {ROLES.map((r) => <RoleCard key={r.value} role={r} t={t} selected={role === r.value} onSelect={() => setRole(r.value)} />)}
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
        <button onClick={del} disabled={busy} className="btn btn-danger">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} {t("ateam.remove")}</button>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-sm font-medium">{label}</span>{children}</label>;
}
