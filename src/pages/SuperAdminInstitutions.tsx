import { useEffect, useState } from "react";
import { Plus, Loader2, Check, ShieldCheck, PauseCircle, Copy, CheckCircle2 } from "lucide-react";
import { SuperAdminShell } from "@/components/SuperAdminShell";
import { PageHeader } from "@/components/PageHeader";
import { TableSkeleton, Modal, ErrorBanner } from "@/components/ui";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { clsx } from "clsx";

interface TenantRow {
  id: string; name: string; status: "active" | "suspended"; createdAt: string;
  admins: number; staff: number; students: number; exams: number;
}

export function SuperAdminInstitutions() {
  const t = useT();
  const [rows, setRows] = useState<TenantRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmSuspend, setConfirmSuspend] = useState<TenantRow | null>(null);

  const load = () => api.get<{ tenants: TenantRow[] }>("/super-admin/tenants").then((d) => setRows(d.tenants)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function toggleStatus(row: TenantRow) {
    setError(null);
    setBusyId(row.id);
    try {
      await api.patch(`/super-admin/tenants/${row.id}`, { status: row.status === "active" ? "suspended" : "active" });
      setConfirmSuspend(null);
      load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusyId(null); }
  }

  return (
    <SuperAdminShell>
      <div className="fade-in max-w-5xl">
        <div className="flex items-center justify-between gap-3">
          <PageHeader eyebrow={t("sad.dashEyebrow")} title={t("sad.instTitle")} subtitle={t("sad.instSubtitle")} />
          <button onClick={() => setCreating(true)} className="btn btn-primary shrink-0"><Plus className="h-4 w-4" /> {t("sad.instNew")}</button>
        </div>

        {error && <ErrorBanner className="mt-4">{error}</ErrorBanner>}

        <div className="card mt-6 overflow-hidden">
          {!rows ? (
            <TableSkeleton rows={3} cells={6} />
          ) : rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-[var(--muted)]">{t("sad.instEmpty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
                    <th className="px-4 py-3 font-semibold">{t("sad.instColName")}</th>
                    <th className="px-3 py-3 font-semibold">{t("sad.instColStatus")}</th>
                    <th className="px-3 py-3 text-right font-semibold">{t("sad.instColAdmins")}</th>
                    <th className="px-3 py-3 text-right font-semibold">{t("sad.instColStaff")}</th>
                    <th className="px-3 py-3 text-right font-semibold">{t("sad.instColStudents")}</th>
                    <th className="px-3 py-3 text-right font-semibold">{t("sad.instColExams")}</th>
                    <th className="px-3 py-3 font-semibold">{t("sad.instColCreated")}</th>
                    <th className="px-3 py-3 text-right font-semibold">{t("sad.instColActions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-[var(--border)] last:border-0 hover:bg-white/[0.02]">
                      <td className="px-4 py-3 font-medium">{row.name}</td>
                      <td className="px-3 py-3">
                        {row.status === "active" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-400"><ShieldCheck className="h-3 w-3" /> {t("sad.instActive")}</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-xs font-semibold text-rose-400"><PauseCircle className="h-3 w-3" /> {t("sad.instSuspended")}</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{row.admins}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{row.staff}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{row.students}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{row.exams}</td>
                      <td className="px-3 py-3 text-[var(--muted)]">{new Date(row.createdAt).toLocaleDateString()}</td>
                      <td className="px-3 py-3 text-right">
                        <button
                          onClick={() => (row.status === "active" ? setConfirmSuspend(row) : toggleStatus(row))}
                          disabled={busyId === row.id}
                          className={clsx(
                            "rounded-lg px-2.5 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40",
                            row.status === "active" ? "text-rose-400 hover:bg-rose-500/10" : "text-emerald-400 hover:bg-emerald-500/10",
                          )}
                        >
                          {busyId === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : row.status === "active" ? t("sad.instSuspend") : t("sad.instReactivate")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {creating && <CreateModal onClose={() => setCreating(false)} onDone={() => { setCreating(false); load(); }} />}

      {confirmSuspend && (
        <Modal title={t("sad.instSuspend")} onClose={() => setConfirmSuspend(null)}>
          <p className="mt-3 text-sm text-[var(--muted)]">{t("sad.instSuspendConfirm", { name: confirmSuspend.name })}</p>
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={() => setConfirmSuspend(null)} className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--fg)]">{t("ateam.cancel")}</button>
            <button onClick={() => toggleStatus(confirmSuspend)} disabled={busyId === confirmSuspend.id} className="btn btn-danger disabled:opacity-50">
              {busyId === confirmSuspend.id ? <Loader2 className="h-4 w-4 animate-spin" /> : t("sad.instSuspend")}
            </button>
          </div>
        </Modal>
      )}
    </SuperAdminShell>
  );
}

function CreateModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [tenantName, setTenantName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ email: string; oneTimePassword: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail.trim());
  const valid = tenantName.trim().length > 0 && adminName.trim().length > 0 && emailOk;

  async function save() {
    if (!valid) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{ oneTimePassword: string }>("/super-admin/tenants", { tenantName, adminName, adminEmail });
      setResult({ email: adminEmail, oneTimePassword: r.oneTimePassword });
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  if (result) {
    return (
      <Modal title={t("sad.instCreatedTitle")} onClose={onDone}>
        <p className="mt-3 text-sm text-[var(--muted)]">{t("sad.instCreatedBody", { email: result.email })}</p>
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card-2)] px-3 py-2.5">
          <code className="flex-1 truncate text-sm font-semibold">{result.oneTimePassword}</code>
          <button
            onClick={() => { navigator.clipboard.writeText(result.oneTimePassword); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
            className="shrink-0 rounded-lg p-1.5 text-[var(--muted)] hover:bg-white/[0.05] hover:text-[var(--fg)]"
            title={t("sad.instCopy")}
          >
            {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
        <p className="mt-2 text-xs text-amber-400">{t("sad.instCreatedWarn")}</p>
        <div className="mt-5 flex justify-end">
          <button onClick={onDone} className="btn btn-primary">{t("sad.instDone")}</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={t("sad.instNewTitle")} onClose={onClose}>
      <div className="mt-4 space-y-3">
        <Field label={t("sad.instNameLabel")}><input className="input h-10" value={tenantName} onChange={(e) => setTenantName(e.target.value)} placeholder="Greenwood High School" /></Field>
        <Field label={t("sad.instAdminNameLabel")}><input className="input h-10" value={adminName} onChange={(e) => setAdminName(e.target.value)} placeholder="Jane Doe" /></Field>
        <Field label={t("sad.instAdminEmailLabel")}>
          <input className="input h-10" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="jane@greenwood.edu" />
          {adminEmail.trim() && !emailOk && <span className="mt-1 block text-xs text-rose-400">{t("ateam.invalidEmail")}</span>}
        </Field>
        <p className="text-xs text-[var(--muted)]">{t("sad.instPasswordHint")}</p>
        {err && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">{err}</p>}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--fg)]">{t("ateam.cancel")}</button>
        <button onClick={save} disabled={busy || !valid} className="btn btn-primary disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {t("sad.instCreateBtn")}</button>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-sm font-medium">{label}</span>{children}</label>;
}
