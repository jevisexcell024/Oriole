import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Printer, Loader2, Award, ShieldCheck, ArrowLeft } from "lucide-react";
import { api } from "@/lib/api";

interface VerifyResp {
  valid: boolean;
  certificate?: { certNumber: string; score: number; issuedAt: string; examTitle: string; holderName: string };
}

/** Public, printable, branded certificate with a verification QR code. */
export function CertificateView() {
  const { certNumber } = useParams();
  const [data, setData] = useState<VerifyResp | null>(null);
  const [qr, setQr] = useState<string>("");

  const verifyUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/verify/${certNumber ?? ""}`;

  useEffect(() => {
    api.get<VerifyResp>(`/verify/${encodeURIComponent(certNumber ?? "")}`).then(setData).catch(() => setData({ valid: false }));
  }, [certNumber]);

  useEffect(() => {
    let alive = true;
    import("qrcode").then((m) => {
      const QR = (m as { default?: typeof import("qrcode") }).default ?? m;
      QR.toDataURL(verifyUrl, { margin: 1, width: 180 }).then((u: string) => { if (alive) setQr(u); }).catch(() => {});
    }).catch(() => {});
    return () => { alive = false; };
  }, [verifyUrl]);

  if (!data) return <div className="flex min-h-screen items-center justify-center gap-2 text-[var(--muted)]"><Loader2 className="h-5 w-5 animate-spin" /> Loading certificate…</div>;
  if (!data.valid || !data.certificate) return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <Award className="h-9 w-9 text-[var(--muted)]" />
      <p className="text-sm text-rose-400">No matching certificate found for “{certNumber}”.</p>
      <Link to="/verify" className="btn btn-outline h-9"><ShieldCheck className="h-4 w-4" /> Verify a certificate</Link>
    </div>
  );

  const c = data.certificate;
  const issued = new Date(c.issuedAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="min-h-screen bg-[var(--bg)] print:bg-white">
      <div className="mx-auto max-w-3xl p-6 print:max-w-none print:p-0">
        <div className="mb-4 flex items-center justify-between print:hidden">
          <Link to="/certificates" className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--fg)]"><ArrowLeft className="h-4 w-4" /> Back</Link>
          <button onClick={() => window.print()} className="btn btn-primary"><Printer className="h-4 w-4" /> Print / Save as PDF</button>
        </div>

        {/* Certificate sheet — always white so it prints cleanly */}
        <div className="relative overflow-hidden rounded-lg bg-white p-10 text-center text-[#111110] shadow-sm ring-1 ring-black/5 print:rounded-none print:shadow-none print:ring-0">
          <div className="pointer-events-none absolute inset-3 rounded-md border-2 border-[#c6ff34]/40" />
          <div className="relative">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#111110] text-white"><Award className="h-7 w-7" /></div>
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.3em] text-[#c6ff34]">Certificate of Achievement</p>
            <p className="mt-6 text-sm text-[#5A7280]">This is to certify that</p>
            <h1 className="mt-1 text-3xl font-extrabold tracking-tight">{c.holderName}</h1>
            <p className="mt-4 text-sm text-[#5A7280]">has successfully completed</p>
            <h2 className="mt-1 text-xl font-bold">{c.examTitle}</h2>
            <p className="mt-4 text-sm">with a score of <span className="font-bold">{c.score}%</span></p>

            <div className="mt-8 flex items-end justify-between gap-6 text-left">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-[#94A3AB]">Issued</p>
                <p className="text-sm font-medium">{issued}</p>
                <p className="mt-3 text-[11px] uppercase tracking-wide text-[#94A3AB]">Certificate no.</p>
                <p className="font-mono text-sm font-medium">{c.certNumber}</p>
                <p className="mt-3 text-[11px] text-[#94A3AB]">Issued by Oriole</p>
              </div>
              <div className="text-center">
                {qr ? <img src={qr} alt="Verification QR" className="h-28 w-28" /> : <div className="h-28 w-28 rounded bg-[#F4F7F8]" />}
                <p className="mt-1 text-[10px] text-[#94A3AB]">Scan to verify</p>
              </div>
            </div>
          </div>
        </div>
        <p className="mt-3 text-center text-[11px] text-[var(--muted)] print:hidden">Verify online at {verifyUrl}</p>
      </div>
    </div>
  );
}
