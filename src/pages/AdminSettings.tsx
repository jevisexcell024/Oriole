import { useEffect, useRef, useState } from "react";
import { Loader2, CheckCircle2, Mail, Send, MessageSquare, Gauge, Headphones } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { ErrorBanner } from "@/components/ui";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { useT } from "@/lib/i18n";
import { clsx } from "clsx";

interface Settings {
  id: string;
  defaultPassingScore: number; defaultProctored: boolean; autoConfirmEnrollment: boolean;
  digestFrequency?: "off" | "daily" | "weekly";
  auditRetentionDays?: number;
  smsReminders?: boolean;
  reliabilityAlertEmails?: string[];
  reliabilityAlertSmsNumbers?: string[];
  reliabilityNotifyOnDegraded?: boolean;
  mediaAssessmentEnabled?: boolean;
}
interface SmsStatus { mode: string; channel: string; live: boolean; from: string | null; }
type SaveStatus = "idle" | "saving" | "saved";

export function AdminSettings() {
  const t = useT();
  const [s, setS] = useState<Settings | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [digestBusy, setDigestBusy] = useState(false);
  const [digestMsg, setDigestMsg] = useState<string | null>(null);
  const [sms, setSms] = useState<SmsStatus | null>(null);
  const [smsTo, setSmsTo] = useState("");
  const [smsBusy, setSmsBusy] = useState(false);
  const [smsMsg, setSmsMsg] = useState<string | null>(null);
  const [alertEmailsText, setAlertEmailsText] = useState("");
  const [alertSmsText, setAlertSmsText] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const sendSmsTest = async () => {
    setSmsBusy(true); setSmsMsg(null);
    try { const r = await api.post<{ delivery: string; error: string | null }>("/admin/sms/test", { to: smsTo.trim() }); setSmsMsg(r.delivery === "sent" ? t("aset.smsSent") : r.delivery === "failed" ? t("aset.smsFailed", { error: r.error ?? t("aset.unknownError") }) : t("aset.smsLogged")); }
    catch (e) { setSmsMsg((e as Error).message); }
    finally { setSmsBusy(false); }
  };

  const sendDigestNow = async () => {
    setDigestBusy(true); setDigestMsg(null);
    try { const r = await api.post<{ sent: number }>("/admin/digest/send-now"); setDigestMsg(r.sent > 0 ? t("aset.digestSent", { n: r.sent }) : t("aset.digestNoActivity")); }
    catch (e) { setDigestMsg((e as Error).message); }
    finally { setDigestBusy(false); }
  };

  useEffect(() => {
    api.get<{ settings: Settings }>("/admin/settings").then((d) => {
      setS(d.settings);
      setAlertEmailsText((d.settings.reliabilityAlertEmails ?? []).join(", "));
      setAlertSmsText((d.settings.reliabilityAlertSmsNumbers ?? []).join(", "));
    }).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { api.get<SmsStatus>("/admin/sms/status").then(setSms).catch(() => {}); }, []);

  // Optimistic autosave — persist each change (debounced) with a subtle indicator.
  const update = (partial: Partial<Settings>) => {
    setS((cur) => (cur ? { ...cur, ...partial } : cur));
    setStatus("saving");
    setError(null);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try { await api.patch("/admin/settings", partial); setStatus("saved"); }
      catch (e) { setError((e as Error).message); setStatus("idle"); }
    }, 500);
  };

  return (
    <AdminShell wide>
      <div className="fade-in max-w-2xl">
        <PageHeader title={t("aset.title")} subtitle={t("aset.subtitle")} />

        {error && <ErrorBanner className="mt-6">{error}</ErrorBanner>}
        {!s && !error && <div className="mt-8 flex items-center gap-2 text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}</div>}

        {s && (
          <div className="card mt-6 p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">{t("aset.examDefaults")}</h2>
              <span className="text-xs text-[var(--muted)]">
                {status === "saving" ? <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("aset.saving")}</span>
                  : status === "saved" ? <span className="inline-flex items-center gap-1.5 text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> {t("aset.saved")}</span>
                  : ""}
              </span>
            </div>
            <p className="text-xs text-[var(--muted)]">{t("aset.appliedHint")}</p>
            <div className="mt-3 space-y-3">
              <label className="flex items-center justify-between gap-4 rounded-xl border border-[var(--border)] p-3">
                <span>
                  <span className="block text-sm font-medium">{t("aset.defaultPassMark")}</span>
                  <span className="block text-xs text-[var(--muted)]">{t("aset.defaultPassHint")}</span>
                </span>
                <span className="flex items-center gap-1">
                  <input type="number" min={0} max={100} className="input h-9 w-20 tabular-nums" value={s.defaultPassingScore}
                    onChange={(e) => update({ defaultPassingScore: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} />
                  <span className="text-sm text-[var(--muted)]">%</span>
                </span>
              </label>
              <Toggle label={t("aset.proctorDefault")} hint={t("aset.proctorDefaultHint")} on={s.defaultProctored} onChange={(v) => update({ defaultProctored: v })} />
            </div>

            <h2 className="mt-6 text-sm font-semibold">{t("aset.enrollment")}</h2>
            <div className="mt-3 space-y-3">
              <Toggle label={t("aset.autoConfirm")} hint={t("aset.autoConfirmHint")} on={s.autoConfirmEnrollment} onChange={(v) => update({ autoConfirmEnrollment: v })} />
            </div>

            <h2 className="mt-6 flex items-center gap-2 text-sm font-semibold"><Mail className="h-4 w-4 text-brand-400" /> {t("aset.emailDigests")}</h2>
            <p className="text-xs text-[var(--muted)]">{t("aset.emailDigestsHint")}</p>
            <div className="mt-3 space-y-3">
              <label className="flex items-center justify-between gap-4 rounded-xl border border-[var(--border)] p-3">
                <span>
                  <span className="block text-sm font-medium">{t("aset.digestFreq")}</span>
                  <span className="block text-xs text-[var(--muted)]">{t("aset.digestFreqHint")}</span>
                </span>
                <select className="input h-9 w-32" value={s.digestFrequency ?? "off"} onChange={(e) => update({ digestFrequency: e.target.value as Settings["digestFrequency"] })}>
                  <option value="off">{t("aset.off")}</option>
                  <option value="daily">{t("arep.daily")}</option>
                  <option value="weekly">{t("arep.weekly")}</option>
                </select>
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <button onClick={sendDigestNow} disabled={digestBusy} className="btn btn-outline h-9 disabled:opacity-50">{digestBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {t("aset.sendDigestNow")}</button>
                {digestMsg && <span className="text-xs text-[var(--muted)]">{digestMsg}</span>}
              </div>
            </div>

            <h2 className="mt-6 flex items-center gap-2 text-sm font-semibold"><MessageSquare className="h-4 w-4 text-brand-400" /> {t("aset.sms")}</h2>
            <p className="text-xs text-[var(--muted)]">
              {t("aset.smsHint")}
              {sms && (sms.live
                ? <span className="ml-1 inline-flex items-center gap-1 font-medium text-emerald-400"><CheckCircle2 className="inline h-3 w-3" /> {t("aset.providerLive", { detail: `${sms.channel}${sms.from ? ` · ${sms.from}` : ""}` })}</span>
                : <span className="ml-1 text-amber-400">{t("aset.noProvider1")}<code>SMS_PROVIDER=twilio</code>{t("aset.noProvider2")}</span>)}
            </p>
            <div className="mt-3 space-y-3">
              <Toggle label={t("aset.smsToggle")} hint={t("aset.smsToggleHint")} on={s.smsReminders ?? false} onChange={(v) => update({ smsReminders: v })} />
              <div className="flex flex-wrap items-center gap-2">
                <input className="input h-9 w-48" value={smsTo} onChange={(e) => setSmsTo(e.target.value)} placeholder="+14155550123" />
                <button onClick={sendSmsTest} disabled={smsBusy || !smsTo.trim()} className="btn btn-outline h-9 disabled:opacity-50">{smsBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {t("aset.sendTest")}</button>
                {smsMsg && <span className="text-xs text-[var(--muted)]">{smsMsg}</span>}
              </div>
            </div>

            <h2 className="mt-6 text-sm font-semibold">{t("aset.dataRetention")}</h2>
            <p className="text-xs text-[var(--muted)]">{t("aset.dataRetentionHint")}</p>
            <div className="mt-3 space-y-3">
              <label className="flex items-center justify-between gap-4 rounded-xl border border-[var(--border)] p-3">
                <span>
                  <span className="block text-sm font-medium">{t("aset.auditRetention")}</span>
                  <span className="block text-xs text-[var(--muted)]">{t("aset.auditRetentionHint")}</span>
                </span>
                <span className="flex items-center gap-1">
                  <input type="number" min={0} max={3650} className="input h-9 w-24 tabular-nums" value={s.auditRetentionDays ?? 0}
                    onChange={(e) => update({ auditRetentionDays: Math.max(0, Math.min(3650, Number(e.target.value) || 0)) })} />
                  <span className="text-sm text-[var(--muted)]">{t("aset.days")}</span>
                </span>
              </label>
            </div>

            <h2 className="mt-6 flex items-center gap-2 text-sm font-semibold"><Gauge className="h-4 w-4 text-brand-400" /> {t("aset.reliabilityAlerts")}</h2>
            <p className="text-xs text-[var(--muted)]">{t("aset.reliabilityAlertsHint")}</p>
            <div className="mt-3 space-y-3">
              <label className="block rounded-xl border border-[var(--border)] p-3">
                <span className="block text-sm font-medium">{t("aset.alertEmails")}</span>
                <span className="mb-2 block text-xs text-[var(--muted)]">{t("aset.alertEmailsHint")}</span>
                <input className="input h-9 w-full" value={alertEmailsText} placeholder="ops@example.com, oncall@example.com"
                  onChange={(e) => setAlertEmailsText(e.target.value)}
                  onBlur={() => update({ reliabilityAlertEmails: alertEmailsText.split(",").map((v) => v.trim()).filter(Boolean) })} />
              </label>
              <label className="block rounded-xl border border-[var(--border)] p-3">
                <span className="block text-sm font-medium">{t("aset.alertSms")}</span>
                <span className="mb-2 block text-xs text-[var(--muted)]">{t("aset.alertSmsHint")}</span>
                <input className="input h-9 w-full" value={alertSmsText} placeholder="+14155550123, +14155550124"
                  onChange={(e) => setAlertSmsText(e.target.value)}
                  onBlur={() => update({ reliabilityAlertSmsNumbers: alertSmsText.split(",").map((v) => v.trim()).filter(Boolean) })} />
              </label>
              <Toggle label={t("aset.notifyOnDegraded")} hint={t("aset.notifyOnDegradedHint")} on={s.reliabilityNotifyOnDegraded ?? false} onChange={(v) => update({ reliabilityNotifyOnDegraded: v })} />
            </div>

            <h2 className="mt-6 flex items-center gap-2 text-sm font-semibold"><Headphones className="h-4 w-4 text-brand-400" /> {t("aset.mediaModule")}</h2>
            <p className="text-xs text-[var(--muted)]">{t("aset.mediaModuleHint")}</p>
            <div className="mt-3 space-y-3">
              <Toggle label={t("aset.mediaModuleToggle")} hint={t("aset.mediaModuleToggleHint")} on={s.mediaAssessmentEnabled ?? false} onChange={(v) => update({ mediaAssessmentEnabled: v })} />
            </div>
          </div>
        )}
      </div>
    </AdminShell>
  );
}

function Toggle({ label, hint, on, onChange }: { label: string; hint: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} className="flex w-full items-center justify-between gap-4 rounded-xl border border-[var(--border)] p-3 text-left">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-[var(--muted)]">{hint}</span>
      </span>
      <span className={clsx("inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition", on ? "bg-brand-600" : "bg-[var(--border)]")}>
        <span className={clsx("h-4 w-4 rounded-full bg-[var(--card)] transition", on && "translate-x-4")} />
      </span>
    </button>
  );
}
