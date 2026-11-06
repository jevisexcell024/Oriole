import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, Loader2, LogOut, Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { landingFor } from "@/lib/roles";
import { useT } from "@/lib/i18n";
import { BrandMark } from "@/components/BrandMark";

/** Full-screen, non-dismissible gate shown right after signing in with a
 *  password the user didn't choose (an emailed invite, a resend, or an
 *  admin-driven reset — see User.mustChangePassword). Reuses the same
 *  current+new+confirm shape as the regular account-settings password form,
 *  but posts to the dedicated one-time endpoint instead of POST /me/password
 *  (which stays off-limits to candidates for every change after this one). */
export function ForcePasswordChange() {
  const t = useT();
  const { user, refresh, logout } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (user && !user.mustChangePassword) navigate(landingFor(user.role), { replace: true });
  }, [user, navigate]);

  if (!user) return null; // AuthProvider still resolving /auth/me, or genuinely signed out
  const role = user.role; // narrow once — TS doesn't retain the !user check inside the closure below

  const pwLongEnough = next.length >= 12;
  const pwVaried = next.length === 0 || new Set(next).size >= 5;
  const valid = current.length > 0 && pwLongEnough && pwVaried && next === confirm;

  async function submit() {
    setErr(null);
    if (!pwLongEnough) { setErr(t("fpc.errTooShort")); return; }
    if (!pwVaried) { setErr(t("fpc.errTooSimple")); return; }
    if (next !== confirm) { setErr(t("fpc.errMismatch")); return; }
    setBusy(true);
    try {
      await api.post("/me/complete-password-setup", { current, password: next });
      await refresh();
      navigate(landingFor(role), { replace: true });
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-[var(--bg)] p-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-xl sm:p-8">
        <div className="flex justify-center"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white p-1"><BrandMark className="h-full w-full object-contain" /></span></div>
        <div className="mt-5 flex justify-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-500/15 text-[#8fb31f]"><KeyRound className="h-6 w-6" /></span>
        </div>
        <h1 className="mt-4 text-center text-lg font-bold">{t("fpc.title")}</h1>
        <p className="mt-1.5 text-center text-sm text-[var(--muted)]">{t("fpc.body")}</p>

        <div className="mt-6 space-y-3">
          <Field label={t("fpc.currentPassword")}>
            <PasswordInput value={current} onChange={setCurrent} autoComplete="current-password" placeholder={t("fpc.currentPasswordHint")} />
          </Field>
          <Field label={t("fpc.newPassword")}>
            <PasswordInput value={next} onChange={setNext} autoComplete="new-password" />
            {next.length > 0 && (!pwLongEnough || !pwVaried) && <span className="mt-1 block text-xs text-rose-400">{t("fpc.reqHint")}</span>}
          </Field>
          <Field label={t("fpc.confirmPassword")}>
            <PasswordInput value={confirm} onChange={setConfirm} autoComplete="new-password" />
          </Field>
        </div>

        {err && <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">{err}</p>}

        <button onClick={submit} disabled={busy || !valid} className="btn btn-primary mt-5 h-11 w-full disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {t("fpc.submit")}
        </button>
        <button onClick={() => { const back = user?.role === "candidate" ? "/portal" : "/login"; void logout(); navigate(back); }} className="mt-3 flex w-full items-center justify-center gap-1.5 text-xs font-medium text-[var(--muted)] hover:text-[var(--fg)]">
          <LogOut className="h-3.5 w-3.5" /> {t("fpc.signOut")}
        </button>
      </div>
    </div>
  );
}

/** Password field with an eye button so people can check what they typed. */
function PasswordInput({ value, onChange, autoComplete, placeholder }: { value: string; onChange: (v: string) => void; autoComplete: string; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input type={show ? "text" : "password"} className="input h-11 pr-11" value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} placeholder={placeholder} />
      <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-[var(--muted)] hover:text-[var(--fg)]">
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-sm font-medium">{label}</span>{children}</label>;
}
