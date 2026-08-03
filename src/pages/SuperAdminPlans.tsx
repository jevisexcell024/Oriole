import { useEffect, useState } from "react";
import { Plus, Loader2, Check, Archive, ArchiveRestore, Pencil, Building2, Layers, DollarSign, TrendingUp, X } from "lucide-react";
import { SuperAdminShell } from "@/components/SuperAdminShell";
import { PageHeader } from "@/components/PageHeader";
import { TableSkeleton, Modal, ErrorBanner } from "@/components/ui";
import { api } from "@/lib/api";
import { useSuperAdminAuth } from "@/lib/superAdminAuth";
import type { Plan } from "@shared/types";
import { clsx } from "clsx";

type PlanRow = Plan & { institutions: number; mrr: number };
interface Summary { totalPlans: number; activePlans: number; totalInstitutions: number; mrr: number; arr: number; }

function limitText(n: number | null | undefined): string {
  return n == null ? "Unlimited" : n.toLocaleString();
}
function money(n: number, currency = "USD"): string {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(n); }
  catch { return `${currency} ${n.toFixed(2)}`; }
}

function StatCard({ icon: Icon, label, value, note }: { icon: typeof Building2; label: string; value: string; note?: string }) {
  return (
    <div className="card flex items-center gap-3 p-4">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#c6ff34]/10 text-[#c6ff34]"><Icon className="h-5 w-5" /></div>
      <div className="min-w-0">
        <p className="truncate text-xl font-bold tabular-nums">{value}</p>
        <p className="text-xs text-[var(--muted)]">{label}</p>
        {note && <p className="mt-0.5 text-[11px] text-[var(--muted)]">{note}</p>}
      </div>
    </div>
  );
}

export function SuperAdminPlans() {
  const { superAdmin } = useSuperAdminAuth();
  const isOwner = (superAdmin?.role ?? "owner") === "owner";
  const [plans, setPlans] = useState<PlanRow[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Plan | "new" | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "active" | "archived">("all");

  const load = () => api.get<{ plans: PlanRow[]; summary: Summary }>("/super-admin/plans")
    .then((d) => { setPlans(d.plans); setSummary(d.summary); })
    .catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function toggleArchive(plan: Plan) {
    setError(null);
    setBusyId(plan.id);
    try {
      await api.patch(`/super-admin/plans/${plan.id}/archive`, { archived: !plan.archived });
      load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusyId(null); }
  }

  const visible = (plans ?? []).filter((p) => filter === "all" || (filter === "active" ? !p.archived : p.archived));

  return (
    <SuperAdminShell>
      <div className="fade-in max-w-6xl">
        <div className="flex items-center justify-between gap-3">
          <PageHeader eyebrow="Licensing" title="Subscription Plans" subtitle="Billing tiers you define and assign to schools — no payment processor is wired in, so MRR/ARR below reflect the prices you set here, not a live payment feed." />
          {isOwner && <button onClick={() => setEditing("new")} className="btn btn-primary shrink-0"><Plus className="h-4 w-4" /> New plan</button>}
        </div>

        {error && <ErrorBanner className="mt-4">{error}</ErrorBanner>}

        {summary && (
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard icon={Layers} label="Total plans" value={String(summary.totalPlans)} />
            <StatCard icon={Check} label="Active plans" value={String(summary.activePlans)} />
            <StatCard icon={Building2} label="Institutions" value={String(summary.totalInstitutions)} note="Across all plans" />
            <StatCard icon={DollarSign} label="Monthly recurring" value={money(summary.mrr)} />
            <StatCard icon={TrendingUp} label="Annual recurring" value={money(summary.arr)} />
          </div>
        )}

        <div className="mt-6 flex gap-1 border-b border-[var(--border)]">
          {(["all", "active", "archived"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={clsx(
                "border-b-2 px-3 py-2 text-sm font-medium capitalize",
                filter === f ? "border-[#c6ff34] text-[var(--fg)]" : "border-transparent text-[var(--muted)] hover:text-[var(--fg)]",
              )}
            >
              {f === "all" ? "All plans" : f}
            </button>
          ))}
        </div>

        {!plans ? (
          <div className="mt-4"><TableSkeleton rows={3} cells={4} /></div>
        ) : visible.length === 0 ? (
          <p className="mt-8 px-4 py-8 text-center text-sm text-[var(--muted)]">{filter === "all" ? "No plans yet — create one to start licensing schools." : `No ${filter} plans.`}</p>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((p) => (
                <div key={p.id} className={clsx("card flex flex-col p-5", p.archived && "opacity-60")}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{p.name}</p>
                      <p className="text-[11px] uppercase tracking-wide text-[var(--muted)]">{p.code}</p>
                    </div>
                    <span className={clsx("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", p.archived ? "bg-white/10 text-[var(--muted)]" : "bg-emerald-500/15 text-emerald-400")}>
                      {p.archived ? "Archived" : "Active"}
                    </span>
                  </div>
                  {p.description && <p className="mt-1.5 text-xs text-[var(--muted)]">{p.description}</p>}

                  <p className="mt-4 text-2xl font-bold">
                    {p.priceMonthly != null ? money(p.priceMonthly, p.currency) : "—"}
                    {p.priceMonthly != null && <span className="text-sm font-normal text-[var(--muted)]"> /month</span>}
                  </p>
                  {p.priceYearly != null && <p className="text-xs text-[var(--muted)]">or {money(p.priceYearly, p.currency)} /year</p>}

                  <ul className="mt-4 space-y-1.5 text-sm">
                    <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 shrink-0 text-[#c6ff34]" /> Up to {limitText(p.limits.maxStudents)} students</li>
                    <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 shrink-0 text-[#c6ff34]" /> Up to {limitText(p.limits.maxStaff)} staff</li>
                    <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 shrink-0 text-[#c6ff34]" /> Up to {limitText(p.limits.maxActiveExams)} active exams</li>
                    {(p.features ?? []).map((f, i) => (
                      <li key={i} className="flex items-center gap-2"><Check className="h-3.5 w-3.5 shrink-0 text-[#c6ff34]" /> {f}</li>
                    ))}
                  </ul>

                  <div className="mt-auto pt-4 flex items-center justify-between border-t border-[var(--border)] mt-4">
                    <span className="text-xs text-[var(--muted)]">{p.institutions} institution{p.institutions === 1 ? "" : "s"}</span>
                    {isOwner && (
                      <div className="flex items-center gap-1">
                        <button onClick={() => setEditing(p)} title="Edit" className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-white/[0.05] hover:text-[var(--fg)]"><Pencil className="h-3.5 w-3.5" /></button>
                        <button
                          onClick={() => toggleArchive(p)}
                          disabled={busyId === p.id}
                          title={p.archived ? "Unarchive" : "Archive"}
                          className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-white/[0.05] hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          {busyId === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : p.archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="card mt-6 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
                      <th className="px-4 py-3 font-semibold">Plan</th>
                      <th className="px-3 py-3 font-semibold">Code</th>
                      <th className="px-3 py-3 text-right font-semibold">Price / mo</th>
                      <th className="px-3 py-3 text-right font-semibold">Price / yr</th>
                      <th className="px-3 py-3 text-right font-semibold">Institutions</th>
                      <th className="px-3 py-3 font-semibold">Status</th>
                      <th className="px-3 py-3 font-semibold">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((p) => (
                      <tr key={p.id} className="border-b border-[var(--border)] last:border-0 hover:bg-white/[0.02]">
                        <td className="px-4 py-3 font-medium">{p.name}</td>
                        <td className="px-3 py-3 text-[var(--muted)]">{p.code}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{p.priceMonthly != null ? money(p.priceMonthly, p.currency) : "—"}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{p.priceYearly != null ? money(p.priceYearly, p.currency) : "—"}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{p.institutions}</td>
                        <td className="px-3 py-3">
                          <span className={clsx("rounded-full px-2 py-0.5 text-xs font-semibold", p.archived ? "bg-white/10 text-[var(--muted)]" : "bg-emerald-500/15 text-emerald-400")}>{p.archived ? "Archived" : "Active"}</span>
                        </td>
                        <td className="px-3 py-3 text-[var(--muted)]">{new Date(p.createdAt).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      {editing && <PlanModal plan={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load(); }} />}
    </SuperAdminShell>
  );
}

function PlanModal({ plan, onClose, onDone }: { plan: Plan | null; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(plan?.name ?? "");
  const [description, setDescription] = useState(plan?.description ?? "");
  const [currency, setCurrency] = useState(plan?.currency ?? "USD");
  const [priceMonthly, setPriceMonthly] = useState(plan?.priceMonthly?.toString() ?? "");
  const [priceYearly, setPriceYearly] = useState(plan?.priceYearly?.toString() ?? "");
  const [maxStudents, setMaxStudents] = useState(plan?.limits.maxStudents?.toString() ?? "");
  const [maxStaff, setMaxStaff] = useState(plan?.limits.maxStaff?.toString() ?? "");
  const [maxActiveExams, setMaxActiveExams] = useState(plan?.limits.maxActiveExams?.toString() ?? "");
  const [features, setFeatures] = useState<string[]>(plan?.features ?? []);
  const [featureInput, setFeatureInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const valid = name.trim().length > 0;

  function toLimit(v: string): number | null {
    const trimmed = v.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  }
  function toPrice(v: string): number | null {
    const trimmed = v.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  function addFeature() {
    const f = featureInput.trim();
    if (f && !features.includes(f)) setFeatures([...features, f]);
    setFeatureInput("");
  }

  async function save() {
    if (!valid) return;
    setBusy(true); setErr(null);
    const body = {
      name: name.trim(),
      description: description.trim() || undefined,
      currency: currency.trim().toUpperCase() || "USD",
      priceMonthly: toPrice(priceMonthly),
      priceYearly: toPrice(priceYearly),
      features,
      limits: { maxStudents: toLimit(maxStudents), maxStaff: toLimit(maxStaff), maxActiveExams: toLimit(maxActiveExams) },
    };
    try {
      if (plan) await api.patch(`/super-admin/plans/${plan.id}`, body);
      else await api.post("/super-admin/plans", body);
      onDone();
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  return (
    <Modal title={plan ? `Edit ${plan.name}` : "New plan"} onClose={onClose}>
      <div className="mt-4 space-y-3">
        <Field label="Name"><input className="input h-10" value={name} onChange={(e) => setName(e.target.value)} placeholder="Pro" /></Field>
        <Field label="Description (optional)"><input className="input h-10" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="For mid-size schools" /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Price / month"><input className="input h-10" value={priceMonthly} onChange={(e) => setPriceMonthly(e.target.value)} placeholder="No price set" inputMode="decimal" /></Field>
          <Field label="Price / year"><input className="input h-10" value={priceYearly} onChange={(e) => setPriceYearly(e.target.value)} placeholder="No price set" inputMode="decimal" /></Field>
          <Field label="Currency"><input className="input h-10" value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={3} placeholder="USD" /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Max students"><input className="input h-10" value={maxStudents} onChange={(e) => setMaxStudents(e.target.value)} placeholder="Unlimited" inputMode="numeric" /></Field>
          <Field label="Max staff"><input className="input h-10" value={maxStaff} onChange={(e) => setMaxStaff(e.target.value)} placeholder="Unlimited" inputMode="numeric" /></Field>
          <Field label="Max active exams"><input className="input h-10" value={maxActiveExams} onChange={(e) => setMaxActiveExams(e.target.value)} placeholder="Unlimited" inputMode="numeric" /></Field>
        </div>
        <Field label="Feature highlights (optional, shown on the pricing card)">
          <div className="flex gap-2">
            <input className="input h-10 flex-1" value={featureInput} onChange={(e) => setFeatureInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addFeature(); } }} placeholder="Priority support" />
            <button type="button" onClick={addFeature} className="rounded-lg border border-[var(--border)] px-3 text-sm font-medium hover:bg-white/[0.05]">Add</button>
          </div>
          {features.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {features.map((f, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded-full bg-[var(--card-2)] px-2 py-1 text-xs">
                  {f}
                  <button type="button" onClick={() => setFeatures(features.filter((_, j) => j !== i))} className="text-[var(--muted)] hover:text-[var(--fg)]"><X className="h-3 w-3" /></button>
                </span>
              ))}
            </div>
          )}
        </Field>
        <p className="text-xs text-[var(--muted)]">Leave a limit or price blank for unlimited / not set.</p>
        {err && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">{err}</p>}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--fg)]">Cancel</button>
        <button onClick={save} disabled={busy || !valid} className="btn btn-primary disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save</button>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-sm font-medium">{label}</span>{children}</label>;
}
