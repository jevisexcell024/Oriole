import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck, Loader2, Mail, Lock, ArrowRight, Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { landingFor } from "@/lib/roles";
import { BrandMark } from "@/components/BrandMark";
import { useT } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

const PURPLE = "#c6ff34";

export function Login() {
  const { user, login, verify2fa } = useAuth();
  const t = useT();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [forgot, setForgot] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [twoFA, setTwoFA] = useState(false);
  const [code, setCode] = useState("");

  // Staff (admin/facilitator/proctor) land on the admin dashboard; students on theirs.
  useEffect(() => { if (user) navigate(landingFor(user.role), { replace: true }); }, [user, navigate]);

  // Surface any SSO callback error (the Microsoft sign-in button has been removed,
  // but a direct callback hit can still redirect back here with ?sso=…).
  useEffect(() => {
    const sso = new URLSearchParams(window.location.search).get("sso");
    if (sso === "nouser") setError(t("auth.ssoNoUser"));
    else if (sso === "error") setError(t("auth.ssoError"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await login(email.trim(), password);
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

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[440px_1fr]">
      {/* Left — form panel */}
      <div className="relative flex flex-col bg-[#0E0E0D] px-10 py-8">
        {/* Brand lockup + language */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/[0.04] p-1.5 ring-1 ring-white/10">
              <BrandMark className="h-full w-full object-contain" />
            </span>
            <span className="leading-tight">
              <span className="block text-[17px] font-extrabold tracking-tight text-white">Oriole</span>
              <span className="block text-[10px] font-semibold uppercase tracking-[0.22em] text-[#c6ff34]">{t("auth.examPlatform")}</span>
            </span>
          </div>
          <LanguageSwitcher />
        </div>

        {/* Sign-in form (vertically centered) */}
        <div className="flex flex-1 flex-col justify-center py-10">
          <div className="mx-auto w-full max-w-sm">
            {twoFA ? (
              <>
                <h1 className="text-2xl font-extrabold tracking-tight text-white">{t("auth.2faTitle")}</h1>
                <p className="mt-1.5 text-sm leading-relaxed text-[#AEBAC2]">{t("auth.2faSubtitle")}</p>
                <form onSubmit={verifyCode} className="mt-7 space-y-4">
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#8FA0AC]">{t("auth.authCode")}</label>
                    <input
                      className="w-full rounded-lg border border-white/15 bg-[#1A1A18] px-3 py-2.5 text-center text-lg tracking-[0.4em] text-white placeholder-[#7E8B96] outline-none transition focus:border-[#c6ff34] focus:ring-2 focus:ring-[#c6ff34]/30"
                      value={code} onChange={(e) => setCode(e.target.value)}
                      placeholder="123456" inputMode="numeric" autoComplete="one-time-code" autoFocus
                    />
                  </div>
                  {error && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>}
                  <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-bold text-[#111110] shadow-sm transition hover:brightness-95 disabled:opacity-70" style={{ background: PURPLE }}>
                    {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("auth.verifying")}</> : <>{t("auth.verify")} <ArrowRight className="h-4 w-4" /></>}
                  </button>
                  <div className="text-center">
                    <button type="button" onClick={() => { setTwoFA(false); setCode(""); setError(null); }} className="text-sm text-[#AEBAC2] underline-offset-2 transition hover:text-white hover:underline">{t("auth.backToSignIn")}</button>
                  </div>
                </form>
              </>
            ) : (
              <>
            <h1 className="text-2xl font-extrabold tracking-tight text-white">{t("auth.welcome")}</h1>
            <p className="mt-1.5 text-sm leading-relaxed text-[#AEBAC2]">{t("auth.subtitle")}</p>

            <form onSubmit={submit} className="mt-7 space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#8FA0AC]">{t("auth.email")}</label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7E8B96]" />
                  <input
                    className="w-full rounded-lg border border-white/15 bg-[#1A1A18] py-2.5 pl-9 pr-3 text-sm text-white placeholder-[#7E8B96] outline-none transition focus:border-[#c6ff34] focus:ring-2 focus:ring-[#c6ff34]/30"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@institution.edu"
                    autoComplete="username"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#8FA0AC]">{t("auth.password")}</label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7E8B96]" />
                  <input
                    className="w-full rounded-lg border border-white/15 bg-[#1A1A18] py-2.5 pl-9 pr-10 text-sm text-white placeholder-[#7E8B96] outline-none transition focus:border-[#c6ff34] focus:ring-2 focus:ring-[#c6ff34]/30"
                    type={showPw ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    aria-label={showPw ? "Hide password" : "Show password"}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-[#7E8B96] transition hover:text-white"
                  >
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {error && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>}
              {forgot && <div className="rounded-lg bg-white/5 px-3 py-2 text-xs text-[#AEBAC2]">Contact your administrator to reset your password.</div>}

              <button
                type="submit"
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-bold text-[#111110] shadow-sm transition hover:brightness-95 disabled:opacity-70"
                style={{ background: PURPLE }}
              >
                {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("auth.signingIn")}</> : <>{t("auth.signIn")} <ArrowRight className="h-4 w-4" /></>}
              </button>
              <div className="text-center">
                <button type="button" onClick={() => setForgot(true)} className="text-sm text-[#AEBAC2] underline-offset-2 transition hover:text-white hover:underline">
                  {t("auth.forgot")}
                </button>
              </div>

            </form>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-center gap-1.5 text-[11px] text-[#6E7C87]">
          <ShieldCheck className="h-3.5 w-3.5 text-[#c6ff34]" /> Secured by <span className="font-semibold text-[#AEBAC2]">JevisLab</span> · Oriole
        </div>
      </div>

      {/* Right — animated Oriole wordmark hero */}
      <LoginHero />
    </div>
  );
}

/**
 * Right-side login hero — the Oriole reveal video on a pure-black canvas.
 * Autoplays muted + looped (required for browser autoplay), plays inline on
 * mobile, and is decorative (aria-hidden). Honors prefers-reduced-motion by
 * not relying on the video for any meaning.
 */
function LoginHero() {
  return (
    <div className="relative hidden items-center justify-center overflow-hidden px-10 lg:flex" style={{ background: "#000000" }}>
      <div className="relative z-10 w-full">
        <video
          className="mx-auto block w-full max-h-[70vh] object-contain"
          src="/oriole-reveal.mp4"
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          aria-hidden="true"
        />
        <p className="mt-6 text-center text-[11px] font-semibold uppercase tracking-[0.35em] text-[#c6ff34]">Secure Online Examinations</p>
      </div>
    </div>
  );
}
