import { useState } from "react";
import { ShieldCheck, ShieldAlert, Loader2, Copy, Check, KeyRound } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";

/** Account security: enable/disable TOTP two-factor authentication. Works for any
 *  signed-in user (staff or student). The QR is rendered client-side from the
 *  otpauth URL with the lazily-loaded `qrcode` package. */
export function TwoFactorSettings() {
  const t = useT();
  const { user, refresh } = useAuth();
  const enabled = !!user?.twoFactorEnabled;

  const [step, setStep] = useState<"idle" | "setup" | "backup" | "disable">("idle");
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [backup, setBackup] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const startSetup = async () => {
    setBusy(true); setError(null);
    try {
      const d = await api.post<{ secret: string; otpauthUrl: string }>("/auth/2fa/setup");
      setSecret(d.secret);
      const mod = await import("qrcode");
      const toDataURL = ((mod as { default?: { toDataURL: (s: string) => Promise<string> } }).default ?? (mod as unknown as { toDataURL: (s: string) => Promise<string> })).toDataURL;
      setQr(await toDataURL(d.otpauthUrl));
      setStep("setup");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const enable = async () => {
    setBusy(true); setError(null);
    try {
      const d = await api.post<{ backupCodes: string[] }>("/auth/2fa/enable", { code: code.trim() });
      setBackup(d.backupCodes);
      setCode("");
      setStep("backup");
      await refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const disable = async () => {
    setBusy(true); setError(null);
    try {
      await api.post("/auth/2fa/disable", { password });
      setPassword("");
      setStep("idle");
      await refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const copyBackup = async () => {
    try { await navigator.clipboard.writeText(backup.join("\n")); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  return (
    <div className="card mt-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><KeyRound className="h-4 w-4 text-brand-400" /> {t("tfa.title")}</h2>
        {enabled
          ? <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400"><ShieldCheck className="h-3.5 w-3.5" /> {t("tfa.on")}</span>
          : <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-400"><ShieldAlert className="h-3.5 w-3.5" /> {t("tfa.off")}</span>}
      </div>
      <p className="mt-1 text-xs text-[var(--muted)]">{t("tfa.desc")}</p>

      {error && <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">{error}</p>}

      {/* Off → offer to enable */}
      {!enabled && step === "idle" && (
        <button onClick={startSetup} disabled={busy} className="btn btn-primary mt-4 h-9 disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} {t("tfa.enable")}</button>
      )}

      {/* Setup: scan QR + confirm a code */}
      {step === "setup" && (
        <div className="mt-4 flex flex-col gap-4 sm:flex-row">
          {qr && <img src={qr} alt={t("tfa.qrAlt")} className="h-40 w-40 shrink-0 rounded-lg bg-white p-2" />}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{t("tfa.step1")}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">{t("tfa.manualKey")}</p>
            <code className="mt-1 block break-all rounded-md bg-[var(--card-2)] px-2 py-1 text-xs">{secret}</code>
            <p className="mt-3 text-sm font-medium">{t("tfa.step2")}</p>
            <div className="mt-2 flex items-center gap-2">
              <input className="input h-9 w-32 text-center tracking-[0.3em]" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" inputMode="numeric" autoComplete="one-time-code" />
              <button onClick={enable} disabled={busy || code.trim().length < 6} className="btn btn-primary h-9 disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {t("tfa.verifyEnable")}</button>
              <button onClick={() => { setStep("idle"); setError(null); setCode(""); }} className="btn btn-ghost h-9">{t("tfa.cancel")}</button>
            </div>
          </div>
        </div>
      )}

      {/* Backup codes shown once */}
      {step === "backup" && (
        <div className="mt-4">
          <p className="text-sm font-medium text-emerald-400">{t("tfa.nowOn")}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">{t("tfa.backupHint")}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-[var(--border)] bg-[var(--card-2)] p-3 font-mono text-xs sm:grid-cols-2">
            {backup.map((c) => <span key={c}>{c}</span>)}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button onClick={copyBackup} className="btn btn-outline h-9">{copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />} {copied ? t("tfa.copied") : t("tfa.copyCodes")}</button>
            <button onClick={() => setStep("idle")} className="btn btn-primary h-9">{t("tfa.done")}</button>
          </div>
        </div>
      )}

      {/* On → offer to disable (password required) */}
      {enabled && step === "idle" && (
        <button onClick={() => { setStep("disable"); setError(null); }} className="btn btn-outline mt-4 h-9">{t("tfa.disable")}</button>
      )}
      {step === "disable" && (
        <div className="mt-4">
          <p className="text-sm">{t("tfa.disablePrompt")}</p>
          <div className="mt-2 flex items-center gap-2">
            <input type="password" className="input h-9 w-56" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("tfa.yourPassword")} autoComplete="current-password" />
            <button onClick={disable} disabled={busy || !password} className="btn h-9 bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {t("tfa.disableBtn")}</button>
            <button onClick={() => { setStep("idle"); setPassword(""); setError(null); }} className="btn btn-ghost h-9">{t("tfa.cancel")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
