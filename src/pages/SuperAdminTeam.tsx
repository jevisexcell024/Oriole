import { useEffect, useState } from "react";
import { UserPlus, Loader2, Check, ShieldCheck, ShieldOff, Copy, CheckCircle2 } from "lucide-react";
import { SuperAdminShell } from "@/components/SuperAdminShell";
import { PageHeader } from "@/components/PageHeader";
import { TableSkeleton, Modal, ErrorBanner } from "@/components/ui";
import { useSuperAdminAuth } from "@/lib/superAdminAuth";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { initials } from "@/lib/format";
import { clsx } from "clsx";

interface Member { id: string; name: string; email: string; createdAt: string; mustChangePassword: boolean; disabled: boolean; }

export function SuperAdminTeam() {
  const t = useT();
  const { superAdmin } = useSuperAdminAuth();
  const [rows, setRows] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState(false);

  const load = () => api.get<{ team: Member[] }>("/super-admin/team").then((d) => setRows(d.team)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const activeCount = (rows ?? []).filter((r) => !r.disabled).length;

  async function toggleDisabled(m: Member) {
    setError(null);
    try { await api.patch(`/super-admin/team/${m.id}`, { disabled: !m.disabled }); load(); }
    catch (e) { setError((e as Error).message); }
  }

  return (
    <SuperAdminShell>
      <div className="fade-in max-w-3xl">
        <div className="flex items-center justify-between gap-3">
          <PageHeader eyebrow={t("sad.dashEyebrow")} title={t("sad.teamTitle")} subtitle={t("sad.teamSubtitle")} />
          <button onClick={() => setInvite(true)} className="btn btn-primary shrink-0"><UserPlus className="h-4 w-4" /> {t("sad.teamInvite")}</button>
        </div>

        {error && <ErrorBanner className="mt-4">{error}</ErrorBanner>}

        <div className="card mt-6 overflow-hidden">
          {!rows ? (
            <TableSkeleton rows={3} cells={3} />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
                  <th className="px-4 py-3 font-semibold">{t("sad.teamColMember")}</th>
                  <th className="px-3 py-3 font-semibold">{t("sad.teamColStatus")}</th>
                  <th className="px-3 py-3 text-right font-semibold">{t("sad.teamColActions")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => {
                  const isSelf = m.id === superAdmin?.id;
                  const lastActive = !m.disabled && activeCount <= 1;
                  const blocked = isSelf || lastActive;
                  return (
                    <tr key={m.id} className="border-b border-[var(--border)] last:border-0 hover:bg-white/[0.02]">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#111110] text-[11px] font-bold text-white">{initials(m.name)}</span>
                          <span>
                            <span className="block font-medium">{m.name}{isSelf && <span className="ml-1.5 text-xs text-[var(--muted)]">{t("ateam.you")}</span>}</span>
                            <span className="block text-xs text-[var(--muted)]">{m.email}</span>
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        {m.disabled ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-xs font-semibold text-rose-400"><ShieldOff className="h-3 w-3" /> {t("sad.teamDisabled")}</span>
                        ) : m.mustChangePassword ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-400">{t("sad.teamPendingSetup")}</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-400"><ShieldCheck className="h-3 w-3" /> {t("sad.teamActive")}</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <button
                          onClick={() => toggleDisabled(m)}
                          disabled={blocked}
                          title={isSelf ? t("sad.teamCantDisableSelf") : lastActive ? t("sad.teamCantDisableLast") : m.disabled ? t("sad.teamEnable") : t("sad.teamDisable")}
                          className={clsx(
                            "rounded-lg px-2.5 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40",
                            m.disabled ? "text-emerald-400 hover:bg-emerald-500/10" : "text-rose-400 hover:bg-rose-500/10",
                          )}
                        >
                          {m.disabled ? t("sad.teamEnable") : t("sad.teamDisable")}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {invite && <InviteModal onClose={() => setInvite(false)} onDone={() => { setInvite(false); load(); }} />}
    </SuperAdminShell>
  );
}

function InviteModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ email: string; oneTimePassword: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const valid = name.trim().length > 0 && emailOk;

  async function save() {
    if (!valid) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{ oneTimePassword: string }>("/super-admin/team", { name, email });
      setResult({ email, oneTimePassword: r.oneTimePassword });
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  if (result) {
    return (
      <Modal title={t("sad.teamInvitedTitle")} onClose={onDone}>
        <p className="mt-3 text-sm text-[var(--muted)]">{t("sad.teamInvitedBody", { email: result.email })}</p>
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card-2)] px-3 py-2.5">
          <code className="flex-1 truncate text-sm font-semibold">{result.oneTimePassword}</code>
          <button
            onClick={() => { navigator.clipboard.writeText(result.oneTimePassword); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
            className="shrink-0 rounded-lg p-1.5 text-[var(--muted)] hover:bg-white/[0.05] hover:text-[var(--fg)]"
            title={t("sad.teamCopy")}
          >
            {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
        <p className="mt-2 text-xs text-amber-400">{t("sad.teamInvitedWarn")}</p>
        <div className="mt-5 flex justify-end">
          <button onClick={onDone} className="btn btn-primary">{t("sad.teamDone")}</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={t("sad.teamInviteTitle")} onClose={onClose}>
      <div className="mt-4 space-y-3">
        <Field label={t("ateam.fullName")}><input className="input h-10" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" /></Field>
        <Field label={t("ateam.email")}>
          <input className="input h-10" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@orcalis.dev" />
          {email.trim() && !emailOk && <span className="mt-1 block text-xs text-rose-400">{t("ateam.invalidEmail")}</span>}
        </Field>
        <p className="text-xs text-[var(--muted)]">{t("sad.teamPasswordHint")}</p>
        {err && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">{err}</p>}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--fg)]">{t("ateam.cancel")}</button>
        <button onClick={save} disabled={busy || !valid} className="btn btn-primary disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {t("sad.teamInviteBtn")}</button>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-sm font-medium">{label}</span>{children}</label>;
}
