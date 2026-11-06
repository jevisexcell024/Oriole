import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Loader2, CheckCircle2, Copy, Check } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { api } from "@/lib/api";

const LIME = "var(--color-brand-500)";

interface CreatedAccount {
  tenantName: string;
  adminEmail: string;
  oneTimePassword: string;
}

export function RequestAccess() {
  const [schoolName, setSchoolName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedAccount | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // Instant self-serve — this creates a real trial school and admin
      // account right away, same as a Super Admin creating one directly,
      // just with no human review gate. See createTenantWithAdmin() on the
      // server: no license key means a real 7-day trial plan.
      const r = await api.post<{ tenant: { name: string }; admin: { email: string }; oneTimePassword: string }>("/tenant-requests", {
        schoolName: schoolName.trim(),
        contactName: contactName.trim(),
        contactEmail: contactEmail.trim(),
        contactPhone: contactPhone.trim() || undefined,
        message: message.trim() || undefined,
      });
      setCreated({ tenantName: r.tenant.name, adminEmail: r.admin.email, oneTimePassword: r.oneTimePassword });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const copyPassword = () => {
    if (!created) return;
    navigator.clipboard?.writeText(created.oneTimePassword).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  };

  return (
    <div className="force-light flex min-h-screen items-center justify-center px-4 py-10" style={{ background: "var(--bg)" }}>
      <div className="w-full max-w-md">
        {created ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 text-center shadow-sm">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full" style={{ background: "color-mix(in oklch, var(--color-brand-500) 15%, transparent)", color: LIME }}>
              <CheckCircle2 className="h-6 w-6" />
            </span>
            <h1 className="mt-4 text-xl font-bold text-[var(--fg)]">Your school is ready</h1>
            <p className="mt-2 text-sm text-[var(--muted)]">
              <span className="font-semibold text-[var(--fg)]">{created.tenantName}</span> is live on a 7-day free trial. Sign in with <span className="font-semibold text-[var(--fg)]">{created.adminEmail}</span> and this one-time password:
            </p>
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card-2)] px-3 py-2.5 text-left">
              <code className="flex-1 truncate text-sm font-semibold text-[var(--fg)]">{created.oneTimePassword}</code>
              <button onClick={copyPassword} className="shrink-0 rounded-lg p-1.5 text-[var(--muted)] hover:bg-white/[0.05] hover:text-[var(--fg)]">
                {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
            <p className="mt-2 text-xs text-amber-500">This is shown once — copy it now. You'll be asked to set your own password on first sign-in.</p>
            <Link to="/login" className="btn btn-primary mt-6 inline-flex items-center gap-1.5">
              Sign in now <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        ) : (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm">
            <div className="flex items-center gap-2.5">
              <BrandMark className="h-9 w-9 shrink-0 rounded-xl" />
              <div>
                <h1 className="text-lg font-bold text-[var(--fg)]">Start your free trial</h1>
                <p className="text-xs text-[var(--muted)]">Your school is created instantly — 7 days free, no card needed.</p>
              </div>
            </div>

            <form onSubmit={submit} className="mt-6 space-y-4">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-[var(--fg)]">School / institution name</span>
                <input required value={schoolName} onChange={(e) => setSchoolName(e.target.value)} className="input h-10 w-full" placeholder="e.g. Northgate Academy" />
              </label>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-[var(--fg)]">Your name</span>
                  <input required value={contactName} onChange={(e) => setContactName(e.target.value)} className="input h-10 w-full" placeholder="Full name" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-[var(--fg)]">Email</span>
                  <input required type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className="input h-10 w-full" placeholder="you@school.edu" />
                </label>
              </div>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-[var(--fg)]">Phone <span className="font-normal text-[var(--muted)]">(optional)</span></span>
                <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className="input h-10 w-full" placeholder="+1 555 000 0000" />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-[var(--fg)]">Tell us a bit more <span className="font-normal text-[var(--muted)]">(optional)</span></span>
                <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} className="input w-full resize-y py-2" placeholder="Roughly how many students, what you're currently using, timeline…" />
              </label>

              {error && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-500">{error}</p>}

              <button type="submit" disabled={busy} className="btn btn-primary flex w-full items-center justify-center gap-2 disabled:opacity-60">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Create my school <ArrowRight className="h-4 w-4" /></>}
              </button>
            </form>

            <Link to="/login" className="mt-5 flex items-center justify-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--fg)]">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
