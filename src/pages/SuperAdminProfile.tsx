import { useState } from "react";
import { Loader2, Check, KeyRound, UserCircle } from "lucide-react";
import { SuperAdminShell } from "@/components/SuperAdminShell";
import { PageHeader } from "@/components/PageHeader";
import { useSuperAdminAuth } from "@/lib/superAdminAuth";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { initials } from "@/lib/format";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-sm font-medium">{label}</span>{children}</label>;
}

export function SuperAdminProfile() {
  const t = useT();
  const { superAdmin, refresh } = useSuperAdminAuth();

  const [name, setName] = useState(superAdmin?.name ?? "");
  const [savingName, setSavingName] = useState(false);
  const [nameErr, setNameErr] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(false);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [savingPw, setSavingPw] = useState(false);
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [pwSaved, setPwSaved] = useState(false);

  if (!superAdmin) return null;

  async function saveName() {
    if (!name.trim()) return;
    setSavingName(true); setNameErr(null); setNameSaved(false);
    try { await api.patch("/super-admin/profile", { name: name.trim() }); await refresh(); setNameSaved(true); setTimeout(() => setNameSaved(false), 2000); }
    catch (e) { setNameErr((e as Error).message); }
    finally { setSavingName(false); }
  }

  const pwLongEnough = next.length >= 12;
  const pwVaried = next.length === 0 || new Set(next).size >= 5;
  const pwValid = current.length > 0 && pwLongEnough && pwVaried && next === confirm;

  async function savePassword() {
    setPwErr(null); setPwSaved(false);
    if (!pwLongEnough) { setPwErr(t("fpc.errTooShort")); return; }
    if (!pwVaried) { setPwErr(t("fpc.errTooSimple")); return; }
    if (next !== confirm) { setPwErr(t("fpc.errMismatch")); return; }
    setSavingPw(true);
    try {
      await api.post("/super-admin/auth/password", { current, password: next });
      setCurrent(""); setNext(""); setConfirm("");
      setPwSaved(true); setTimeout(() => setPwSaved(false), 2000);
    } catch (e) { setPwErr((e as Error).message); }
    finally { setSavingPw(false); }
  }

  return (
    <SuperAdminShell>
      <div className="fade-in max-w-2xl">
        <PageHeader eyebrow={t("sad.dashEyebrow")} title={t("sad.profileTitle")} subtitle={t("sad.profileSubtitle")} />

        <div className="card mt-6 p-5">
          <div className="flex items-center gap-2 text-[var(--muted)]"><UserCircle className="h-4 w-4" /><span className="text-[11px] font-semibold uppercase tracking-wider">{t("sanav.secProfile")}</span></div>
          <div className="mt-4 flex items-center gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#c6ff34] text-base font-bold text-[#111110]">{initials(superAdmin.name)}</span>
            <div className="min-w-0 flex-1 space-y-3">
              <Field label={t("sad.profileName")}>
                <input className="input h-10" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
              </Field>
              <Field label={t("sad.profileEmail")}>
                <input className="input h-10 opacity-60" value={superAdmin.email} disabled />
              </Field>
            </div>
          </div>
          {nameErr && <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">{nameErr}</p>}
          <div className="mt-4 flex items-center justify-end gap-2">
            {nameSaved && <span className="flex items-center gap-1 text-xs font-medium text-emerald-400"><Check className="h-3.5 w-3.5" /> {t("acct.saved")}</span>}
            <button onClick={saveName} disabled={savingName || !name.trim() || name.trim() === superAdmin.name} className="btn btn-primary disabled:opacity-50">
              {savingName ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {t("sad.profileSaveName")}
            </button>
          </div>
        </div>

        <div className="card mt-4 p-5">
          <div className="flex items-center gap-2 text-[var(--muted)]"><KeyRound className="h-4 w-4" /><span className="text-[11px] font-semibold uppercase tracking-wider">{t("sad.profileChangePassword")}</span></div>
          <div className="mt-4 space-y-3">
            <Field label={t("acct.currentPassword")}>
              <input type="password" className="input h-10" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
            </Field>
            <Field label={t("fpc.newPassword")}>
              <input type="password" className="input h-10" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
              {next.length > 0 && (!pwLongEnough || !pwVaried) && <span className="mt-1 block text-xs text-rose-400">{t("fpc.reqHint")}</span>}
            </Field>
            <Field label={t("fpc.confirmPassword")}>
              <input type="password" className="input h-10" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
            </Field>
          </div>
          {pwErr && <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">{pwErr}</p>}
          <div className="mt-4 flex items-center justify-end gap-2">
            {pwSaved && <span className="flex items-center gap-1 text-xs font-medium text-emerald-400"><Check className="h-3.5 w-3.5" /> {t("acct.saved")}</span>}
            <button onClick={savePassword} disabled={savingPw || !pwValid} className="btn btn-primary disabled:opacity-50">
              {savingPw ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} {t("sad.profileChangePasswordBtn")}
            </button>
          </div>
        </div>
      </div>
    </SuperAdminShell>
  );
}
