import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ShieldCheck, CheckCircle2, XCircle, Search, Loader2, Award } from "lucide-react";
import { api } from "@/lib/api";

interface VerifyResp {
  valid: boolean;
  certificate?: { certNumber: string; score: number; issuedAt: string; examTitle: string; holderName: string };
}

export function Verify() {
  const { certNumber } = useParams();
  const [query, setQuery] = useState(certNumber ?? "");
  const [result, setResult] = useState<VerifyResp | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async (cert: string) => {
    if (!cert.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const r = await api.get<VerifyResp>(`/verify/${encodeURIComponent(cert.trim())}`);
      setResult(r);
    } catch {
      setResult({ valid: false });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (certNumber) run(certNumber); }, [certNumber]);

  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--border)] bg-[var(--card)]">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-2.5 px-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white"><ShieldCheck className="h-5 w-5" /></div>
          <div>
            <p className="text-sm font-bold leading-tight">Oriole</p>
            <p className="text-xs text-[var(--muted)]">Credential Verification</p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-5 py-12 text-center fade-in">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-white"><Award className="h-7 w-7" /></div>
        <h1 className="mt-4 text-2xl font-bold tracking-tight">Verify a certificate</h1>
        <p className="mt-1.5 text-sm text-[var(--muted)]">Confirm the authenticity of any Oriole certificate instantly.</p>

        <div className="card mt-6 p-5 text-left">
          <label className="mb-1.5 block text-sm font-medium">Certificate number</label>
          <div className="flex gap-2">
            <input className="input" placeholder="e.g. CERT-AB12CD34" value={query} onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && run(query)} />
            <button className="btn btn-primary shrink-0" onClick={() => run(query)} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Verify
            </button>
          </div>

          {result && (
            <div className="mt-5">
              {result.valid && result.certificate ? (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/15 p-5">
                  <div className="flex items-center gap-2 text-emerald-400">
                    <CheckCircle2 className="h-5 w-5" /> <span className="font-semibold">Valid certificate</span>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div><dt className="text-xs text-[var(--muted)]">Holder</dt><dd className="font-medium">{result.certificate.holderName}</dd></div>
                    <div><dt className="text-xs text-[var(--muted)]">Examination</dt><dd className="font-medium">{result.certificate.examTitle}</dd></div>
                    <div><dt className="text-xs text-[var(--muted)]">Score</dt><dd className="font-medium">{result.certificate.score}%</dd></div>
                    <div><dt className="text-xs text-[var(--muted)]">Issued</dt><dd className="font-medium">{new Date(result.certificate.issuedAt).toLocaleDateString()}</dd></div>
                    <div className="col-span-2"><dt className="text-xs text-[var(--muted)]">Certificate no.</dt><dd className="font-mono text-xs font-medium">{result.certificate.certNumber}</dd></div>
                  </dl>
                </div>
              ) : (
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/15 p-5">
                  <div className="flex items-center gap-2 text-rose-400">
                    <XCircle className="h-5 w-5" /> <span className="font-semibold">No matching certificate found</span>
                  </div>
                  <p className="mt-1 text-xs text-rose-400">Check the certificate number and try again.</p>
                </div>
              )}
            </div>
          )}
        </div>
        <p className="mt-4 text-xs text-[var(--muted)]">Each certificate carries a unique number held in the issuing institution's register.</p>
      </div>
    </div>
  );
}
