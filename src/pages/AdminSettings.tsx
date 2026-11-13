import { useEffect, useRef, useState } from "react";
import { Loader2, CheckCircle2, Mail, Send, MessageSquare, Gauge, Headphones, Palette, KeyRound, Upload, X, Users } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { ErrorBanner } from "@/components/ui";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { useT } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { clsx } from "clsx";
import { ContentSkeleton } from "@/components/Skeletons";

interface Settings {
  id: string;
  defaultPassingScore: number; defaultProctored: boolean; autoConfirmEnrollment: boolean;
  digestFrequency?: "off" | "daily" | "weekly";
  auditRetentionDays?: number;
  scoreBandEdges?: number[];
  smsReminders?: boolean;
  reliabilityAlertEmails?: string[];
  reliabilityAlertSmsNumbers?: string[];
  reliabilityNotifyOnDegraded?: boolean;
  mediaAssessmentEnabled?: boolean;
  brandColor?: string | null;
  ssoAutoProvision?: boolean;
  ssoAllowedDomains?: string[];
  ssoRosterEnabled?: boolean;
  ssoRoster?: string[];
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const BRAND_PRESETS = ["#c6ff34", "#22d3ee", "#c084fc", "#fb923c", "#4ade80", "#f43f5e", "#60a5fa", "#f59e0b"];

interface RosterEntry {
  email: string;
  studentId?: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  gender?: string;
  studentClass?: string;
}
interface SmsStatus { mode: string; channel: string; live: boolean; from: string | null; }
type SaveStatus = "idle" | "saving" | "saved";

export function AdminSettings() {
  const t = useT();
  const { brandColor: effectiveBrandColor, refresh: refreshAuth } = useAuth();
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
  const [scoreBandsText, setScoreBandsText] = useState("");
  const [scoreBandsErr, setScoreBandsErr] = useState(false);
  const [brandColorText, setBrandColorText] = useState("");
  const [ssoDomainsText, setSsoDomainsText] = useState("");
  const [ssoAvailable, setSsoAvailable] = useState(false);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [rosterUploading, setRosterUploading] = useState(false);
  const [rosterMsg, setRosterMsg] = useState<string | null>(null);
  const [newRosterEmail, setNewRosterEmail] = useState("");
  const [rosterSearch, setRosterSearch] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
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
      setScoreBandsText((d.settings.scoreBandEdges ?? [20, 40, 60, 80]).join(", "));
      setBrandColorText(d.settings.brandColor ?? "");
      setSsoDomainsText((d.settings.ssoAllowedDomains ?? []).join(", "));
    }).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { api.get<SmsStatus>("/admin/sms/status").then(setSms).catch(() => {}); }, []);
  useEffect(() => { api.get<{ microsoft: boolean }>("/auth/sso/config").then((d) => setSsoAvailable(d.microsoft)).catch(() => {}); }, []);
  useEffect(() => { api.get<{ roster: RosterEntry[] }>("/admin/sso-roster").then((d) => setRoster(d.roster)).catch(() => {}); }, []);

  const uploadRosterCsv = async (file: File) => {
    setRosterUploading(true); setRosterMsg(null);
    try {
      const csv = await file.text();
      const r = await api.post<{ count: number; errors?: string[] }>("/admin/sso-roster/upload", { csv });
      setRosterMsg(`Uploaded ${r.count} students${r.errors?.length ? ` (${r.errors.length} errors)` : ""}`);
      setRoster((await api.get<{ roster: RosterEntry[] }>("/admin/sso-roster")).roster);
    } catch (e) { setRosterMsg((e as Error).message); }
    finally { setRosterUploading(false); if (fileInputRef.current) fileInputRef.current.value = ""; }
  };

  const addRosterEntry = async () => {
    if (!newRosterEmail.trim()) return;
    try {
      await api.post("/admin/sso-roster/add", { email: newRosterEmail.trim() });
      setRoster((await api.get<{ roster: RosterEntry[] }>("/admin/sso-roster")).roster);
      setNewRosterEmail("");
    } catch (e) { setRosterMsg((e as Error).message); }
  };

  const removeRosterEntry = async (email: string) => {
    try {
      await api.del(`/admin/sso-roster/${encodeURIComponent(email)}`);
      setRoster((prev) => prev.filter((e) => e.email !== email));
    } catch (e) { setRosterMsg((e as Error).message); }
  };

  const clearRoster = async () => {
    if (!confirm("Remove all students from the roster?")) return;
    try {
      await api.del("/admin/sso-roster");
      setRoster([]);
      setRosterMsg("Roster cleared");
    } catch (e) { setRosterMsg((e as Error).message); }
  };

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

  // Brand color skips the debounce (color-picker drags fire many events) and
  // re-fetches /auth/me afterward so the console re-themes immediately.
  const saveBrandColor = async (value: string | null) => {
    setS((cur) => (cur ? { ...cur, brandColor: value } : cur));
    setStatus("saving");
    setError(null);
    try {
      await api.patch("/admin/settings", { brandColor: value });
      setStatus("saved");
      await refreshAuth();
    } catch (e) { setError((e as Error).message); setStatus("idle"); }
  };

  return (
    <AdminShell wide>
      <div className="fade-in max-w-2xl">
        <PageHeader title={t("aset.title")} subtitle={t("aset.subtitle")} />

        {error && <ErrorBanner className="mt-6">{error}</ErrorBanner>}
        {!s && !error && <ContentSkeleton variant="form" />}

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
              <label className="block rounded-xl border border-[var(--border)] p-3">
                <span className="block text-sm font-medium">{t("aset.scoreBands")}</span>
                <span className="mb-2 block text-xs text-[var(--muted)]">{t("aset.scoreBandsHint")}</span>
                <input
                  className={clsx("input h-9 w-full", scoreBandsErr && "border-rose-500")}
                  value={scoreBandsText}
                  placeholder="20, 40, 60, 80"
                  onChange={(e) => { setScoreBandsText(e.target.value); setScoreBandsErr(false); }}
                  onBlur={() => {
                    const edges = scoreBandsText.split(",").map((v) => Number(v.trim())).filter((v) => !Number.isNaN(v));
                    const ascending = edges.every((v, i) => (i === 0 || v > edges[i - 1]) && v > 0 && v < 100);
                    if (edges.length === 0 || !ascending) { setScoreBandsErr(true); return; }
                    update({ scoreBandEdges: edges });
                  }}
                />
                {scoreBandsErr && <span className="mt-1 block text-xs text-rose-400">{t("aset.scoreBandsErr")}</span>}
              </label>
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

            <h2 className="mt-6 flex items-center gap-2 text-sm font-semibold"><Palette className="h-4 w-4 text-brand-400" /> Branding</h2>
            <p className="text-xs text-[var(--muted)]">Pick your own accent color for this console, or leave it on the platform default.</p>
            <div className="mt-3 space-y-3">
              <div className="rounded-xl border border-[var(--border)] p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="color"
                    value={HEX_RE.test(brandColorText) ? brandColorText : effectiveBrandColor}
                    onChange={(e) => { setBrandColorText(e.target.value); saveBrandColor(e.target.value); }}
                    className="h-9 w-12 shrink-0 cursor-pointer rounded-lg border border-[var(--border)] bg-transparent p-1"
                  />
                  <input
                    className="input h-9 w-32 font-mono uppercase"
                    value={brandColorText}
                    placeholder={effectiveBrandColor.toUpperCase()}
                    maxLength={7}
                    onChange={(e) => setBrandColorText(e.target.value)}
                    onBlur={() => { if (HEX_RE.test(brandColorText)) saveBrandColor(brandColorText); }}
                  />
                  <button
                    className="btn btn-outline h-9 disabled:opacity-50"
                    disabled={!s.brandColor}
                    onClick={() => { setBrandColorText(""); saveBrandColor(null); }}
                  >
                    Use platform default
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {BRAND_PRESETS.map((p) => (
                    <button
                      key={p}
                      onClick={() => { setBrandColorText(p); saveBrandColor(p); }}
                      title={p}
                      className="h-6 w-6 rounded-full border-2 transition"
                      style={{ background: p, borderColor: brandColorText.toLowerCase() === p.toLowerCase() ? "var(--fg)" : "transparent" }}
                    />
                  ))}
                </div>
                <p className="mt-2 text-xs text-[var(--muted)]">
                  {s.brandColor ? "Using your own color — it overrides the platform default." : "Currently using the platform default."}
                </p>
              </div>
            </div>

            <h2 className="mt-6 flex items-center gap-2 text-sm font-semibold"><KeyRound className="h-4 w-4 text-brand-400" /> Microsoft SSO</h2>
            <p className="text-xs text-[var(--muted)]">
              {ssoAvailable
                ? <span className="inline-flex items-center gap-1"><CheckCircle2 className="inline h-3 w-3 text-emerald-400" /> Microsoft SSO is configured for the student portal.</span>
                : <span className="text-amber-400">Microsoft SSO is not configured. Set <code>MS_CLIENT_ID</code>, <code>MS_TENANT</code>, and credentials in env.</span>}
            </p>
            <div className="mt-3 space-y-3">
              <Toggle
                label="Auto-provision new users"
                hint="Automatically create a student account when someone signs in with Microsoft for the first time."
                on={s.ssoAutoProvision ?? false}
                onChange={(v) => update({ ssoAutoProvision: v })}
              />
              <label className="block rounded-xl border border-[var(--border)] p-3">
                <span className="block text-sm font-medium">Allowed email domains</span>
                <span className="mb-2 block text-xs text-[var(--muted)]">Only auto-provision users from these domains (comma-separated). Leave empty to allow any domain.</span>
                <input
                  className="input h-9 w-full"
                  value={ssoDomainsText}
                  placeholder="university.edu, school.org"
                  onChange={(e) => setSsoDomainsText(e.target.value)}
                  onBlur={() => update({ ssoAllowedDomains: ssoDomainsText.split(",").map((v) => v.trim().toLowerCase()).filter(Boolean) })}
                />
              </label>
              <Toggle
                label="Require student roster"
                hint="Only allow SSO sign-in for emails in the uploaded roster. Upload a CSV of allowed student emails below."
                on={s.ssoRosterEnabled ?? false}
                onChange={(v) => update({ ssoRosterEnabled: v })}
              />
            </div>

            {/* Student Roster Management */}
            <div className="mt-4 rounded-xl border border-[var(--border)] p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-brand-400" />
                  <span className="text-sm font-semibold">Student Roster</span>
                  <span className="rounded-full bg-[var(--bg)] px-2 py-0.5 text-xs text-[var(--muted)]">{roster.length} students</span>
                </div>
                {roster.length > 0 && (
                  <button onClick={clearRoster} className="text-xs text-rose-400 hover:underline">Clear all</button>
                )}
              </div>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Upload a CSV with columns: <code className="text-[10px]">StudentID, First Name, Middle Name, Last Name, Gender, Class, Email</code>
              </p>

              {/* CSV Upload */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && uploadRosterCsv(e.target.files[0])}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={rosterUploading}
                  className="btn btn-outline h-9 disabled:opacity-50"
                >
                  {rosterUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  Upload CSV
                </button>
                <a
                  href="data:text/csv;charset=utf-8,StudentID,First Name,Middle Name,Last Name,Gender,Class,Email%0A12345,John,Michael,Doe,Male,Class A,john.doe@school.edu"
                  download="roster_template.csv"
                  className="text-xs text-brand-400 hover:underline"
                >
                  Download template
                </a>
              </div>

              {/* Add single email */}
              <div className="mt-3 flex gap-2">
                <input
                  className="input h-9 flex-1"
                  value={newRosterEmail}
                  onChange={(e) => setNewRosterEmail(e.target.value)}
                  placeholder="Add email manually..."
                  onKeyDown={(e) => e.key === "Enter" && addRosterEntry()}
                />
                <button onClick={addRosterEntry} className="btn btn-primary h-9 px-4">Add</button>
              </div>

              {rosterMsg && <p className="mt-2 text-xs text-amber-400">{rosterMsg}</p>}

              {/* Student list */}
              {roster.length > 0 && (
                <div className="mt-3">
                  <input
                    className="input mb-2 h-8 w-full text-sm"
                    value={rosterSearch}
                    onChange={(e) => setRosterSearch(e.target.value)}
                    placeholder="Search by name or email..."
                  />
                  <div className="max-h-64 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg)]">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-[var(--card)] text-left text-xs text-[var(--muted)]">
                        <tr>
                          <th className="px-3 py-2">Name</th>
                          <th className="px-3 py-2">Email</th>
                          <th className="px-3 py-2">ID</th>
                          <th className="px-3 py-2">Class</th>
                          <th className="w-8"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {roster
                          .filter((r) => {
                            if (!rosterSearch) return true;
                            const q = rosterSearch.toLowerCase();
                            return r.email.includes(q) || r.firstName?.toLowerCase().includes(q) || r.lastName?.toLowerCase().includes(q) || r.studentId?.toLowerCase().includes(q);
                          })
                          .slice(0, 100)
                          .map((entry) => (
                            <tr key={entry.email} className="border-t border-[var(--border)]">
                              <td className="px-3 py-1.5">
                                {[entry.firstName, entry.middleName, entry.lastName].filter(Boolean).join(" ") || <span className="text-[var(--muted)]">—</span>}
                              </td>
                              <td className="px-3 py-1.5 text-[var(--muted)]">{entry.email}</td>
                              <td className="px-3 py-1.5">{entry.studentId || <span className="text-[var(--muted)]">—</span>}</td>
                              <td className="px-3 py-1.5">{entry.studentClass || <span className="text-[var(--muted)]">—</span>}</td>
                              <td className="px-2">
                                <button onClick={() => removeRosterEntry(entry.email)} className="text-[var(--muted)] hover:text-rose-400">
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                    {roster.filter((r) => {
                      if (!rosterSearch) return true;
                      const q = rosterSearch.toLowerCase();
                      return r.email.includes(q) || r.firstName?.toLowerCase().includes(q) || r.lastName?.toLowerCase().includes(q);
                    }).length > 100 && (
                      <div className="border-t border-[var(--border)] px-3 py-2 text-center text-xs text-[var(--muted)]">
                        Showing first 100 of {roster.length} students
                      </div>
                    )}
                  </div>
                </div>
              )}
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
