import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Loader2, CheckCircle2, Building2 } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { api } from "@/lib/api";

const LIME = "var(--color-brand-500)";

export function RequestAccess() {
  const [schoolName, setSchoolName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post("/tenant-requests", {
        schoolName: schoolName.trim(),
        contactName: contactName.trim(),
        contactEmail: contactEmail.trim(),
        contactPhone: contactPhone.trim() || undefined,
        message: message.trim() || undefined,
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="force-light flex min-h-screen items-center justify-center px-4 py-10" style={{ background: "var(--bg)" }}>
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center"><BrandMark /></div>

        {sent ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 text-center shadow-sm">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full" style={{ background: "color-mix(in oklch, var(--color-brand-500) 15%, transparent)", color: LIME }}>
              <CheckCircle2 className="h-6 w-6" />
            </span>
            <h1 className="mt-4 text-xl font-bold text-[var(--fg)]">Request received</h1>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Thanks — we've got your request for <span className="font-semibold text-[var(--fg)]">{schoolName}</span>. Our team will review it and reach out at <span className="font-semibold text-[var(--fg)]">{contactEmail}</span>.
            </p>
            <Link to="/login" className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-500 hover:underline">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
            </Link>
          </div>
        ) : (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: "color-mix(in oklch, var(--color-brand-500) 15%, transparent)", color: LIME }}>
                <Building2 className="h-4.5 w-4.5" />
              </span>
              <div>
                <h1 className="text-lg font-bold text-[var(--fg)]">Request access for your school</h1>
                <p className="text-xs text-[var(--muted)]">Tell us about your institution and we'll be in touch.</p>
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
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Send request <ArrowRight className="h-4 w-4" /></>}
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
