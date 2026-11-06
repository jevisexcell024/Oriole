import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { KeyRound, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { BrandMark } from "@/components/BrandMark";

/** Public — reached only via the signed, single-use link in the password-reset
 *  email (see POST /api/auth/forgot-password). The token is the authorization;
 *  after a successful reset the student signs in again from the portal. */
export function ResetPassword() {
  const t = useT();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const pwLongEnough = next.length >= 12;
  const pwVaried = next.length === 0 || new Set(next).size >= 5;
  const valid = !!token && pwLongEnough && pwVaried && next === confirm;

  async function submit() {
    setErr(null);
    if (!pwLongEnough || !pwVaried) { setErr(t("fpc.errTooSimple")); return; }
    if (next !== confirm) { setErr(t("fpc.errMismatch")); return; }
    setBusy(true);
    try {
      await api.post("/auth/reset-password", { token, password: next });
      setDone(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const Frame = ({ children }: { children: React.ReactNode }) => (
    <div className="force-light fixed inset-0 z-[110] flex items-center justify-center bg-[var(--bg)] p-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 text-[var(--fg)] sm:p-8">
        <div className="flex justify-center"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white p-1"><BrandMark className="h-full w-full object-contain" /></span></div>
        {children}
      </div>
    </div>
  );

  if (!token) {
    return (
      <Frame>
        <div className="mt-5 flex justify-center"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500/15 text-rose-500"><AlertTriangle className="h-6 w-6" /></span></div>
        <h1 className="mt-4 text-center text-lg font-bold">This reset link isn't valid</h1>
        <p className="mt-1.5 text-center text-sm text-[var(--muted)]">Request a new one from the student sign-in page.</p>
        <Link to="/portal" className="btn btn-primary mt-5 inline-flex h-11 w-full rounded-full shadow-none">Back to sign in</Link>
      </Frame>
    );
  }

  if (done) {
    return (
      <Frame>
        <div className="mt-5 flex justify-center"><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-600"><CheckCircle2 className="h-6 w-6" /></span></div>
        <h1 className="mt-4 text-center text-lg font-bold">Password updated</h1>
        <p className="mt-1.5 text-center text-sm text-[var(--muted)]">You can now sign in with your new password.</p>
        <Link to="/portal" className="btn btn-primary mt-5 inline-flex h-11 w-full rounded-full shadow-none">Go to sign in</Link>
      </Frame>
    );
  }

  return (
    <Frame>
      <div className="mt-5 flex justify-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-500/15 text-[#8fb31f]"><KeyRound className="h-6 w-6" /></span>
      </div>
      <h1 className="mt-4 text-center text-lg font-bold">Choose a new password</h1>
      <p className="mt-1.5 text-center text-sm text-[var(--muted)]">Pick something you haven't used before, at least 12 characters.</p>

      <div className="mt-6 space-y-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">{t("fpc.newPassword")}</span>
          <input type="password" className="input h-11" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" autoFocus />
          {next.length > 0 && (!pwLongEnough || !pwVaried) && <span className="mt-1 block text-xs text-rose-500">{t("fpc.reqHint")}</span>}
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">{t("fpc.confirmPassword")}</span>
          <input type="password" className="input h-11" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </label>
      </div>

      {err && <p role="alert" className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-600">{err}</p>}

      <button onClick={submit} disabled={busy || !valid} className="btn btn-primary mt-5 h-11 w-full rounded-full shadow-none disabled:opacity-50">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Update password
      </button>
    </Frame>
  );
}
