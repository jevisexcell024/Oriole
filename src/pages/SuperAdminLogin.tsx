import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck, Loader2, Mail, Lock, ArrowRight, Eye, EyeOff } from "lucide-react";
import { useSuperAdminAuth } from "@/lib/superAdminAuth";
import { BrandMark } from "@/components/BrandMark";
import { useT } from "@/lib/i18n";

const LIME = "#c6ff34";

/** Deliberately a simpler, more security-flavored layout than the tenant
 *  Login.tsx — no hero carousel or language switcher. This is an internal
 *  platform-operator tool, not a customer-facing page, and its visual
 *  distinctness is itself a signal to anyone landing here that they're in a
 *  different, higher-stakes system than the school login. */
export function SuperAdminLogin() {
  const { superAdmin, login } = useSuperAdminAuth();
  const t = useT();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);

  useEffect(() => {
    if (!superAdmin) return;
    navigate(superAdmin.mustChangePassword ? "/super-admin/force-password-change" : "/super-admin/dashboard", { replace: true });
  }, [superAdmin, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-black px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/[0.04] p-1.5 ring-1 ring-white/10">
            <BrandMark className="h-full w-full object-contain" />
          </span>
          <span className="leading-tight">
            <span className="block text-[17px] font-extrabold tracking-tight text-white">Oriole</span>
            <span className="block text-[10px] font-semibold uppercase tracking-[0.22em]" style={{ color: LIME }}>{t("sad.platformConsole")}</span>
          </span>
        </div>

        <div className="mt-8 rounded-2xl border border-white/10 bg-[#0E0E0D] px-7 py-8">
          <h1 className="text-2xl font-extrabold leading-tight tracking-tight text-white">{t("sad.loginTitle")}</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-[#AEBAC2]">{t("sad.loginSubtitle")}</p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#8FA0AC]">{t("auth.email")}</label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7E8B96]" />
                <input
                  className="w-full rounded-full border border-white/15 bg-[#1A1A18] py-3 pl-11 pr-4 text-sm text-white placeholder-[#7E8B96] outline-none transition focus:border-[--lime] focus:ring-2"
                  style={{ ["--lime" as string]: LIME }}
                  value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@platform.com" autoComplete="username" autoFocus
                />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#8FA0AC]">{t("auth.password")}</label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7E8B96]" />
                <input
                  className="w-full rounded-full border border-white/15 bg-[#1A1A18] py-3 pl-11 pr-11 text-sm text-white placeholder-[#7E8B96] outline-none transition"
                  type={showPw ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password"
                />
                <button type="button" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? "Hide password" : "Show password"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-[#7E8B96] transition hover:text-white">
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>}

            <button type="submit" disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-bold text-[#111110] shadow-sm transition hover:brightness-95 disabled:opacity-70"
              style={{ background: LIME }}>
              {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("auth.signingIn")}</> : <>{t("sad.loginSubmit")} <ArrowRight className="h-4 w-4" /></>}
            </button>
          </form>
        </div>

        <div className="mt-6 flex items-center justify-center gap-1.5 text-[11px] text-[#6E7C87]">
          <ShieldCheck className="h-3.5 w-3.5" style={{ color: LIME }} /> {t("sad.separateAuthNotice")}
        </div>
      </div>
    </div>
  );
}
