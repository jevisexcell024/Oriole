import { useEffect, useState } from "react";
import { Plus, Loader2, Check, Copy, CheckCircle2, Ban, KeyRound, ShieldCheck, Users, ShieldOff } from "lucide-react";
import { SuperAdminShell } from "@/components/SuperAdminShell";
import { PageHeader } from "@/components/PageHeader";
import { TableSkeleton, Modal, ErrorBanner } from "@/components/ui";
import { api } from "@/lib/api";
import { useSuperAdminAuth } from "@/lib/superAdminAuth";
import type { Plan, LicenseKey } from "@shared/types";
import { clsx } from "clsx";

type KeyStatus = "active" | "redeemed" | "revoked" | "expired";
type KeyFilter = "all" | KeyStatus;

function statusOf(key: LicenseKey): { status: KeyStatus; label: string; className: string } {
  if (key.revokedAt) return { status: "revoked", label: "Revoked", className: "bg-rose-500/15 text-rose-400" };
  if (key.expiresAt && key.expiresAt < new Date().toISOString()) return { status: "expired", label: "Expired", className: "bg-white/10 text-[var(--muted)]" };
  if (key.redeemedByTenantIds.length >= key.maxRedemptions) return { status: "redeemed", label: "Fully redeemed", className: "bg-white/10 text-[var(--muted)]" };
  return { status: "active", label: "Active", className: "bg-emerald-500/15 text-emerald-400" };
}

function StatCard({ icon: Icon, label, value }: { icon: typeof KeyRound; label: string; value: string }) {
  return (
    <div className="card flex items-center gap-3 p-4">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#c6ff34]/10 text-[#c6ff34]"><Icon className="h-5 w-5" /></div>
      <div>
        <p className="text-xl font-bold tabular-nums">{value}</p>
        <p className="text-xs text-[var(--muted)]">{label}</p>
      </div>
    </div>
  );
}

export function SuperAdminLicenseKeys() {
  const { superAdmin } = useSuperAdminAuth();
  const isOwner = (superAdmin?.role ?? "owner") === "owner";
  const [keys, setKeys] = useState<LicenseKey[] | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<LicenseKey | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<KeyFilter>("all");

  const load = () => {
    api.get<{ keys: LicenseKey[] }>("/super-admin/license-keys").then((d) => setKeys(d.keys)).catch((e) => setError(e.message));
    api.get<{ plans: Plan[] }>("/super-admin/plans").then((d) => setPlans(d.plans)).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const planName = (id: string) => plans.find((p) => p.id === id)?.name ?? "(deleted plan)";
  const statusCounts = (keys ?? []).reduce((acc, k) => { const s = statusOf(k).status; acc[s] = (acc[s] ?? 0) + 1; return acc; }, {} as Record<KeyStatus, number>);
  const totalRedemptions = (keys ?? []).reduce((sum, k) => sum + k.redeemedByTenantIds.length, 0);
  const visible = (keys ?? []).filter((k) => filter === "all" || statusOf(k).status === filter);

  async function revoke(key: LicenseKey) {
    setError(null);
    setBusyId(key.id);
    try {
      await api.post(`/super-admin/license-keys/${key.id}/revoke`, {});
      setConfirmRevoke(null);
      load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusyId(null); }
  }

  function copy(key: LicenseKey) {
    navigator.clipboard.writeText(key.code);
    setCopiedId(key.id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  return (
    <SuperAdminShell>
      <div className="fade-in max-w-5xl">
        <div className="flex items-center justify-between gap-3">
          <PageHeader eyebrow="Licensing" title="License Keys" subtitle="Redeemable codes that activate a plan on a school — hand one to a new customer to redeem during signup, or apply it to an existing school to upgrade." />
          {isOwner && <button onClick={() => setCreating(true)} className="btn btn-primary shrink-0"><Plus className="h-4 w-4" /> Generate key</button>}
        </div>

        {error && <ErrorBanner className="mt-4">{error}</ErrorBanner>}

        {keys && (
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <StatCard icon={KeyRound} label="Total keys" value={String(keys.length)} />
            <StatCard icon={ShieldCheck} label="Active" value={String(statusCounts.active ?? 0)} />
            <StatCard icon={Users} label="Redemptions" value={String(totalRedemptions)} />
            <StatCard icon={ShieldOff} label="Revoked" value={String(statusCounts.revoked ?? 0)} />
            <StatCard icon={Ban} label="Expired" value={String(statusCounts.expired ?? 0)} />
          </div>
        )}

        <div className="mt-6 flex gap-1 border-b border-[var(--border)]">
          {([["all", "All keys"], ["active", "Active"], ["redeemed", "Fully redeemed"], ["revoked", "Revoked"], ["expired", "Expired"]] as [KeyFilter, string][]).map(([f, label]) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={clsx(
                "border-b-2 px-3 py-2 text-sm font-medium",
                filter === f ? "border-[#c6ff34] text-[var(--fg)]" : "border-transparent text-[var(--muted)] hover:text-[var(--fg)]",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="card mt-4 overflow-hidden">
          {!keys ? (
            <TableSkeleton rows={3} cells={6} />
          ) : visible.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-[var(--muted)]">{filter === "all" ? "No license keys generated yet." : "No keys match this filter."}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
                    <th className="px-4 py-3 font-semibold">Code</th>
                    <th className="px-3 py-3 font-semibold">Plan</th>
                    <th className="px-3 py-3 font-semibold">Status</th>
                    <th className="px-3 py-3 text-right font-semibold">Redeemed</th>
                    <th className="px-3 py-3 font-semibold">Note</th>
                    <th className="px-3 py-3 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((k) => {
                    const status = statusOf(k);
                    return (
                      <tr key={k.id} className="border-b border-[var(--border)] last:border-0 hover:bg-white/[0.02]">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <code className="text-xs font-semibold">{k.code}</code>
                            <button onClick={() => copy(k)} title="Copy" className="rounded p-1 text-[var(--muted)] hover:bg-white/[0.05] hover:text-[var(--fg)]">
                              {copiedId === k.id ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                            </button>
                          </div>
                        </td>
                        <td className="px-3 py-3">{planName(k.planId)}</td>
                        <td className="px-3 py-3">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${status.className}`}>{status.label}</span>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">{k.redeemedByTenantIds.length} / {k.maxRedemptions}</td>
                        <td className="px-3 py-3 text-[var(--muted)]">{k.note ?? "—"}</td>
                        <td className="px-3 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {isOwner && !k.revokedAt && (
                              <button
                                onClick={() => setConfirmRevoke(k)}
                                disabled={busyId === k.id}
                                title="Revoke"
                                className="rounded-lg p-1.5 text-rose-400 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-30"
                              >
                                <Ban className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {creating && <CreateKeyModal plans={plans} onClose={() => setCreating(false)} onDone={() => { setCreating(false); load(); }} />}

      {confirmRevoke && (
        <Modal title="Revoke license key" onClose={() => setConfirmRevoke(null)}>
          <p className="mt-3 text-sm text-[var(--muted)]">Revoking <code className="font-semibold">{confirmRevoke.code}</code> stops it from being redeemed again. Any school that already redeemed it keeps its plan — this doesn't undo a past redemption.</p>
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={() => setConfirmRevoke(null)} className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--fg)]">Cancel</button>
            <button onClick={() => revoke(confirmRevoke)} disabled={busyId === confirmRevoke.id} className="btn btn-danger disabled:opacity-50">
              {busyId === confirmRevoke.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Revoke"}
            </button>
          </div>
        </Modal>
      )}
    </SuperAdminShell>
  );
}

function CreateKeyModal({ plans, onClose, onDone }: { plans: Plan[]; onClose: () => void; onDone: () => void }) {
  const [planId, setPlanId] = useState(plans.find((p) => !p.archived)?.id ?? "");
  const [note, setNote] = useState("");
  const [maxRedemptions, setMaxRedemptions] = useState("1");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<LicenseKey | null>(null);
  const [copied, setCopied] = useState(false);
  const valid = planId.length > 0 && Number(maxRedemptions) >= 1;
  const activePlans = plans.filter((p) => !p.archived);

  async function save() {
    if (!valid) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{ key: LicenseKey }>("/super-admin/license-keys", { planId, note: note.trim() || undefined, maxRedemptions: Number(maxRedemptions) });
      setResult(r.key);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  if (result) {
    return (
      <Modal title="License key generated" onClose={onDone}>
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card-2)] px-3 py-2.5">
          <code className="flex-1 truncate text-sm font-semibold">{result.code}</code>
          <button
            onClick={() => { navigator.clipboard.writeText(result.code); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
            className="shrink-0 rounded-lg p-1.5 text-[var(--muted)] hover:bg-white/[0.05] hover:text-[var(--fg)]"
          >
            {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
        <p className="mt-2 text-xs text-[var(--muted)]">Give this to the school to redeem during signup, or apply it to an existing school from Active Licenses.</p>
        <div className="mt-5 flex justify-end">
          <button onClick={onDone} className="btn btn-primary">Done</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Generate license key" onClose={onClose}>
      <div className="mt-4 space-y-3">
        <Field label="Plan">
          <select className="input h-10" value={planId} onChange={(e) => setPlanId(e.target.value)}>
            {activePlans.length === 0 && <option value="">No plans available — create one first</option>}
            {activePlans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Redemptions allowed"><input className="input h-10" value={maxRedemptions} onChange={(e) => setMaxRedemptions(e.target.value)} inputMode="numeric" /></Field>
        <Field label="Note (optional)"><input className="input h-10" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. reseller batch, renewal for Greenwood" /></Field>
        {err && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">{err}</p>}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--fg)]">Cancel</button>
        <button onClick={save} disabled={busy || !valid} className="btn btn-primary disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Generate</button>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-sm font-medium">{label}</span>{children}</label>;
}
