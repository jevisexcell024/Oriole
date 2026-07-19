import { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { KeyRound, Loader2, AlertTriangle } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { landingFor } from "@/lib/roles";
import { useT } from "@/lib/i18n";
import { BrandMark } from "@/components/BrandMark";

/** Public — reached only via the signed, single-purpose link in the
 *  account-setup email (see setupLinkEmail() in server/index.ts). No password
 *  ever travels through that email; the student picks their own here, using
 *  the token as proof of authorization instead of a "current password" field. */
export function SetupPassword() {
  const t = useT();
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pwLongEnough = next.length >= 12;
  const pwVaried = next.length === 0 || new Set(next).size >= 5;
  const valid = !!token && pwLongEnough && pwVaried && next === confirm;

  async function submit() {
    setErr(null);
    if (!pwLongEnough || !pwVaried) { setErr(t("fpc.errTooSimple")); return; }
    if (next !== confirm) { setErr(t("fpc.errMismatch")); return; }
    setBusy(true);
    try {
      await api.post("/auth/setup-password", { token, password: next });
      await refresh();
      navigate(landingFor("candidate"), { replace: true });
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  if (!token) {
    return (
      <div className="fixed inset-0 z-[110] flex items-center justify-center bg-[var(--bg)] p-4">
        <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 text-center shadow-xl sm:p-8">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500/15 text-rose-400"><AlertTriangle className="h-6 w-6" /></span>
          <h1 className="mt-4 text-lg font-bold">{t("spw.invalidLink")}</h1>
          <p className="mt-1.5 text-sm text-[var(--muted)]">{t("spw.invalidLinkHint")}</p>
          <Link to="/login" className="btn btn-primary mt-5 inline-flex h-11 w-full">{t("spw.goToLogin")}</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-[var(--bg)] p-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-xl sm:p-8">
        <div className="flex justify-center"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white p-1"><BrandMark className="h-full w-full object-contain" /></span></div>
        <div className="mt-5 flex justify-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#c6ff34]/15 text-[#8fb31f]"><KeyRound className="h-6 w-6" /></span>
        </div>
        <h1 className="mt-4 text-center text-lg font-bold">{t("spw.title")}</h1>
        <p className="mt-1.5 text-center text-sm text-[var(--muted)]">{t("spw.body")}</p>

        <div className="mt-6 space-y-3">
          <Field label={t("fpc.newPassword")}>
            <input type="password" className="input h-11" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" autoFocus />
            {next.length > 0 && (!pwLongEnough || !pwVaried) && <span className="mt-1 block text-xs text-rose-400">{t("fpc.reqHint")}</span>}
          </Field>
          <Field label={t("fpc.confirmPassword")}>
            <input type="password" className="input h-11" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </Field>
        </div>

        {err && <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">{err}</p>}

        <button onClick={submit} disabled={busy || !valid} className="btn btn-primary mt-5 h-11 w-full disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {t("spw.submit")}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-sm font-medium">{label}</span>{children}</label>;
}
