import { useEffect, useState } from "react";
import { Loader2, Check, Copy, CheckCircle2, X, Inbox, Clock, ShieldCheck, ShieldX, Mail, Phone, MessageSquare } from "lucide-react";
import { SuperAdminShell } from "@/components/SuperAdminShell";
import { PageHeader } from "@/components/PageHeader";
import { TableSkeleton, Modal, ErrorBanner, SuperAdminStatCard } from "@/components/ui";
import { api } from "@/lib/api";
import { useSuperAdminAuth } from "@/lib/superAdminAuth";
import type { TenantRequest } from "@shared/types";
import { clsx } from "clsx";

type Filter = "pending" | "approved" | "rejected" | "all";

const STATUS_META: Record<TenantRequest["status"], { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-amber-500/15 text-amber-400" },
  approved: { label: "Approved", className: "bg-emerald-500/15 text-emerald-400" },
  rejected: { label: "Rejected", className: "bg-rose-500/15 text-rose-400" },
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function SuperAdminTenantRequests() {
  const { superAdmin } = useSuperAdminAuth();
  const isOwner = (superAdmin?.role ?? "owner") === "owner";
  const [requests, setRequests] = useState<TenantRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("pending");
  const [reviewing, setReviewing] = useState<TenantRequest | null>(null);
  const [rejecting, setRejecting] = useState<TenantRequest | null>(null);

  const load = () => api.get<{ requests: TenantRequest[] }>("/super-admin/tenant-requests").then((d) => setRequests(d.requests)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const counts = (requests ?? []).reduce((acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc; }, {} as Record<TenantRequest["status"], number>);
  const visible = (requests ?? []).filter((r) => filter === "all" || r.status === filter);

  return (
    <SuperAdminShell>
      <div className="fade-in max-w-5xl">
        <PageHeader eyebrow="Tenants" title="Tenant Requests" subtitle="Every self-serve signup from the public Request Access form — schools are created automatically on a trial the instant someone submits, no approval needed. This is the real record of who signed up and when." />

        {error && <ErrorBanner className="mt-4">{error}</ErrorBanner>}

        {requests && (
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SuperAdminStatCard icon={Inbox} label="Total requests" value={String(requests.length)} />
            <SuperAdminStatCard icon={Clock} label="Pending" value={String(counts.pending ?? 0)} />
            <SuperAdminStatCard icon={ShieldCheck} label="Approved" value={String(counts.approved ?? 0)} />
            <SuperAdminStatCard icon={ShieldX} label="Rejected" value={String(counts.rejected ?? 0)} />
          </div>
        )}

        <div className="mt-6 flex gap-1 border-b border-[var(--border)]">
          {([["pending", "Pending"], ["approved", "Approved"], ["rejected", "Rejected"], ["all", "All"]] as [Filter, string][]).map(([f, label]) => (
            <button key={f} onClick={() => setFilter(f)}
              className={clsx("border-b-2 px-3 py-2 text-sm font-medium", filter === f ? "border-[#c6ff34] text-[var(--fg)]" : "border-transparent text-[var(--muted)] hover:text-[var(--fg)]")}>
              {label}
            </button>
          ))}
        </div>

        <div className="card mt-4 overflow-hidden">
          {!requests ? (
            <TableSkeleton rows={3} cells={5} />
          ) : visible.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-[var(--muted)]">{filter === "pending" ? "No pending requests." : "No requests match this filter."}</p>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {visible.map((r) => {
                const meta = STATUS_META[r.status];
                return (
                  <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-semibold">{r.schoolName}</p>
                        <span className={clsx("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", meta.className)}>{meta.label}</span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-[var(--muted)]">{r.contactName} · {r.contactEmail} · {fmtDate(r.createdAt)}</p>
                      {r.status === "rejected" && r.rejectionReason && <p className="mt-1 text-xs text-rose-400">Reason: {r.rejectionReason}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button onClick={() => setReviewing(r)} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold hover:bg-white/[0.05]">View</button>
                      {isOwner && r.status === "pending" && (
                        <>
                          <button onClick={() => setRejecting(r)} className="rounded-lg border border-rose-500/30 px-3 py-1.5 text-xs font-semibold text-rose-400 hover:bg-rose-500/10">Reject</button>
                          <button onClick={() => setReviewing(r)} className="btn btn-primary h-8 px-3 text-xs">Approve</button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {reviewing && (
        <ReviewModal request={reviewing} isOwner={isOwner} onClose={() => setReviewing(null)} onDone={() => { setReviewing(null); load(); }} />
      )}
      {rejecting && (
        <RejectModal request={rejecting} onClose={() => setRejecting(null)} onDone={() => { setRejecting(null); load(); }} />
      )}
    </SuperAdminShell>
  );
}

function DetailRow({ icon: Icon, value }: { icon: typeof Mail; value: string }) {
  return <p className="mt-1.5 flex items-center gap-2 text-sm text-[var(--muted)]"><Icon className="h-3.5 w-3.5 shrink-0" /> {value}</p>;
}

function ReviewModal({ request, isOwner, onClose, onDone }: { request: TenantRequest; isOwner: boolean; onClose: () => void; onDone: () => void }) {
  const [tenantName, setTenantName] = useState(request.schoolName);
  const [adminName, setAdminName] = useState(request.contactName);
  const [adminEmail, setAdminEmail] = useState(request.contactEmail);
  const [licenseKeyCode, setLicenseKeyCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ email: string; oneTimePassword: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail.trim());
  const valid = tenantName.trim().length > 0 && adminName.trim().length > 0 && emailOk;

  async function approve() {
    if (!valid) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{ oneTimePassword: string }>(`/super-admin/tenant-requests/${request.id}/approve`, {
        tenantName: tenantName.trim(), adminName: adminName.trim(), adminEmail: adminEmail.trim(), licenseKeyCode: licenseKeyCode.trim() || undefined,
      });
      setResult({ email: adminEmail, oneTimePassword: r.oneTimePassword });
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  if (result) {
    return (
      <Modal title="School created" onClose={onDone}>
        <p className="mt-3 text-sm text-[var(--muted)]">{result.email} can sign in with this one-time password (they'll be asked to change it immediately):</p>
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card-2)] px-3 py-2.5">
          <code className="flex-1 truncate text-sm font-semibold">{result.oneTimePassword}</code>
          <button onClick={() => { navigator.clipboard.writeText(result.oneTimePassword); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
            className="shrink-0 rounded-lg p-1.5 text-[var(--muted)] hover:bg-white/[0.05] hover:text-[var(--fg)]">
            {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
        <p className="mt-2 text-xs text-amber-400">This is shown once — copy it now.</p>
        <div className="mt-5 flex justify-end"><button onClick={onDone} className="btn btn-primary">Done</button></div>
      </Modal>
    );
  }

  return (
    <Modal title={`Review request — ${request.schoolName}`} onClose={onClose}>
      <div className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--card-2)] p-3">
        <DetailRow icon={Mail} value={request.contactEmail} />
        {request.contactPhone && <DetailRow icon={Phone} value={request.contactPhone} />}
        {request.message && <DetailRow icon={MessageSquare} value={request.message} />}
      </div>

      {request.status !== "pending" ? (
        <p className="mt-4 text-sm text-[var(--muted)]">This request was already {request.status}{request.reviewedBySuperAdminName ? ` by ${request.reviewedBySuperAdminName}` : ""}.</p>
      ) : isOwner ? (
        <div className="mt-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Create as</p>
          <Field label="School name"><input className="input h-10" value={tenantName} onChange={(e) => setTenantName(e.target.value)} /></Field>
          <Field label="Admin name"><input className="input h-10" value={adminName} onChange={(e) => setAdminName(e.target.value)} /></Field>
          <Field label="Admin email"><input className="input h-10" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} /></Field>
          <Field label="License key (optional)">
            <input className="input h-10" value={licenseKeyCode} onChange={(e) => setLicenseKeyCode(e.target.value)} placeholder="ORCL-XXXX-XXXX-XXXX" />
            <p className="mt-1 text-xs text-[var(--muted)]">{licenseKeyCode.trim() ? "This key's plan is applied immediately." : "Leave blank to start this school on the automatic 7-day trial."}</p>
          </Field>
          {err && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--fg)]">Cancel</button>
            <button onClick={approve} disabled={busy || !valid} className="btn btn-primary disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Approve & create school
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-[var(--muted)]">Only an Owner can approve or reject requests.</p>
      )}
    </Modal>
  );
}

function RejectModal({ request, onClose, onDone }: { request: TenantRequest; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function reject() {
    if (reason.trim().length < 1) return;
    setBusy(true); setErr(null);
    try {
      await api.post(`/super-admin/tenant-requests/${request.id}/reject`, { reason: reason.trim() });
      onDone();
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  return (
    <Modal title={`Reject request — ${request.schoolName}`} onClose={onClose}>
      <label className="mt-3 block">
        <span className="mb-1 block text-sm font-medium">Reason</span>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="input w-full resize-y py-2" placeholder="Why is this request being rejected?" />
      </label>
      {err && <p className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">{err}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--fg)]">Cancel</button>
        <button onClick={reject} disabled={busy || !reason.trim()} className="btn btn-danger disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />} Reject
        </button>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-sm font-medium">{label}</span>{children}</label>;
}
