import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, ArrowRight, Eye, EyeOff, MailCheck } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { landingFor } from "@/lib/roles";
import { BrandMark } from "@/components/BrandMark";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useT } from "@/lib/i18n";

const ART = "/book.png";

/** Student portal sign-in — its own URL (/portal) and its own page, separate
 *  from the staff sign-in at /login. The server only accepts candidate accounts
 *  here (and only staff on /login), so the two audiences never share a door. */
export function StudentPortalLogin() {
  const { user, login, verify2fa } = useAuth();
  const t = useT();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // "forgot" = the reset step is showing; "sent" = the request has gone out.
  const [forgot, setForgot] = useState(false);
  const [sent, setSent] = useState(false);
  const [twoFA, setTwoFA] = useState(false);
  const [code, setCode] = useState("");

  // Already signed in (any role) — just send them to their own landing page.
  useEffect(() => {
    if (!user) return;
    navigate(user.mustChangePassword ? "/force-password-change" : landingFor(user.role), { replace: true });
  }, [user, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await login(email.trim(), password, undefined, "student");
      if (r.twoFactorRequired) setTwoFA(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed.");
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await verify2fa(code.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid code.");
    } finally {
      setBusy(false);
    }
  };

  const sendReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post("/auth/forgot-password", { email: email.trim() });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  // Soft grey filled fields on the cream card — no borders, no shadows.
  const field = "w-full rounded-lg bg-[#ECEAE3] text-sm text-[#1B1D12] outline-none placeholder:text-[#7a7c6e] focus:ring-2 focus:ring-brand-500";
  const pageText = "text-[#1B1D12]";
  const label = "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#565B47]";

  return (
    <div className="force-light relative flex min-h-screen items-center justify-center overflow-hidden p-4 sm:p-8">
      {/* Full-bleed artwork, blurred, behind the card */}
      <img src={ART} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full scale-125 object-cover blur-2xl" />
      <div className="absolute inset-0 bg-black/10" aria-hidden="true" />

      <div className="absolute right-4 top-4 z-10"><LanguageSwitcher themed /></div>

      <div className={`relative z-10 grid w-full max-w-[920px] grid-cols-1 overflow-hidden rounded-[28px] bg-[#F7F5F0] ${pageText} md:grid-cols-[1fr_1.05fr]`}>
        {/* Left — the illustration, on its own rounded panel (uncropped) */}
        <div className="hidden p-2.5 md:block">
          <div className="flex h-full min-h-[640px] w-full items-center justify-center rounded-[20px] bg-[#E9EADF] p-6">
            <img src="/student-portal.png" alt="" className="max-h-full w-full max-w-[400px] object-contain" />
          </div>
        </div>

        {/* Right — brand, then heading + form, then a quiet footer */}
        <div className="flex min-h-[640px] flex-col px-7 py-8 sm:px-12">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white p-1.5"><BrandMark className="h-full w-full object-contain" /></span>
            <span className="text-xl font-extrabold tracking-tight">oriole</span>
          </div>

          {/* Heading + form */}
          <div className="flex flex-1 flex-col justify-center py-10">
            {forgot ? (
              sent ? (
                <>
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-500/15 text-[#5f7d0a]"><MailCheck className="h-6 w-6" /></span>
                  <h1 className="mt-5 text-[32px] font-extrabold leading-[1.15] tracking-tight">Check your email</h1>
                  <p className="mt-2 text-sm leading-relaxed text-[#565B47]">If there is a student account for <span className="font-semibold text-[#1B1D12]">{email.trim()}</span>, we have sent a link to choose a new password. It works once and expires in 1 hour.</p>
                  <button type="button" onClick={() => { setForgot(false); setSent(false); setError(null); }}
                    className="btn btn-primary mt-8 h-12 w-full rounded-full shadow-none">Back to sign in</button>
                </>
              ) : (
                <>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#565B47]">Student portal</p>
                  <h1 className="mt-2 text-[32px] font-extrabold leading-[1.15] tracking-tight">Reset your password</h1>
                  <p className="mt-2 text-sm leading-relaxed text-[#565B47]">Enter the email for your student account and we will send you a link to choose a new password.</p>
                  <form onSubmit={sendReset} className="mt-8 space-y-5">
                    <div>
                      <label htmlFor="portal-reset-email" className={label}>{t("auth.email")}</label>
                      <input id="portal-reset-email" className={`${field} px-4 py-3`} type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@institution.edu" autoComplete="username" autoFocus required />
                    </div>
                    {error && <div role="alert" className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-700">{error}</div>}
                    <button type="submit" disabled={busy || !email.trim()} className="btn btn-primary h-12 w-full rounded-full shadow-none">
                      {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</> : <>Send reset link <ArrowRight className="h-4 w-4" /></>}
                    </button>
                    <button type="button" onClick={() => { setForgot(false); setError(null); }}
                      className="w-full text-center text-sm text-[#565B47] hover:text-[#1B1D12] hover:underline">{t("auth.backToSignIn")}</button>
                  </form>
                </>
              )
            ) : twoFA ? (
              <>
                <h1 className="text-[32px] font-extrabold leading-[1.15] tracking-tight">{t("auth.2faTitle")}</h1>
                <p className="mt-2 text-sm leading-relaxed text-[#565B47]">{t("auth.2faSubtitle")}</p>
                <form onSubmit={verifyCode} className="mt-8 space-y-5">
                  <div>
                    <label htmlFor="portal-code" className={label}>{t("auth.authCode")}</label>
                    <input id="portal-code" className={`${field} px-4 py-3 text-center text-lg tracking-[0.4em]`} value={code} onChange={(e) => setCode(e.target.value)}
                      placeholder="123456" inputMode="numeric" autoComplete="one-time-code" autoFocus />
                  </div>
                  {error && <div role="alert" className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-700">{error}</div>}
                  <button type="submit" disabled={busy} className="btn btn-primary h-12 w-full rounded-full shadow-none">
                    {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("auth.verifying")}</> : <>{t("auth.verify")} <ArrowRight className="h-4 w-4" /></>}
                  </button>
                  <button type="button" onClick={() => { setTwoFA(false); setCode(""); setError(null); }}
                    className="w-full text-center text-sm text-[#565B47] hover:text-[#1B1D12] hover:underline">{t("auth.backToSignIn")}</button>
                </form>
              </>
            ) : (
              <>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#565B47]">Student portal</p>
                <h1 className="mt-2 text-[32px] font-extrabold leading-[1.15] tracking-tight">Where your exams come together</h1>
                <p className="mt-2 text-sm leading-relaxed text-[#565B47]">Sign in to see your exams, results and certificates.</p>

                <form onSubmit={submit} className="mt-8 space-y-5">
                  <div>
                    <label htmlFor="portal-email" className={label}>{t("auth.email")}</label>
                    <input id="portal-email" className={`${field} px-4 py-3`} value={email} onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@institution.edu" autoComplete="username" autoFocus />
                  </div>
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <label htmlFor="portal-password" className="text-xs font-semibold uppercase tracking-wide text-[#565B47]">{t("auth.password")}</label>
                      <button type="button" onClick={() => { setForgot(true); setError(null); }} className="text-xs font-semibold text-[#565B47] hover:text-[#1B1D12] hover:underline">{t("auth.forgot")}</button>
                    </div>
                    <div className="relative">
                      <input id="portal-password" className={`${field} py-3 pl-4 pr-11`} type={showPw ? "text" : "password"} value={password}
                        onChange={(e) => setPassword(e.target.value)} placeholder="Enter password" autoComplete="current-password" />
                      <button type="button" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? "Hide password" : "Show password"}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-[#565B47] hover:text-[#1B1D12]">
                        {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  {error && <div role="alert" className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-700">{error}</div>}

                  <button type="submit" disabled={busy} className="btn btn-primary h-12 w-full rounded-full shadow-none">
                    {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("auth.signingIn")}</> : <>{t("auth.signIn")} <ArrowRight className="h-4 w-4" /></>}
                  </button>
                </form>
              </>
            )}
          </div>

          {/* Footer */}
          <p className="text-xs text-[#565B47]">Secure online examinations · Secured by <span className="font-semibold text-[#1B1D12]">JevisLab</span></p>
        </div>      </div>
    </div>
  );
}
