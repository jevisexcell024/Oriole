import { useRef, useState } from "react";
import {
  User, Lock, Bell, BadgeCheck, Camera, Loader2, CheckCircle2, Mail, Phone, Trash2,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { TwoFactorSettings } from "@/components/TwoFactorSettings";
import { useT } from "@/lib/i18n";
import type { NotificationPrefs } from "@shared/types";
import { clsx } from "clsx";

type Tab = "profile" | "password" | "notifications" | "verification";

const TABS: { id: Tab; labelKey: string; icon: typeof User }[] = [
  { id: "profile", labelKey: "acct.tabProfile", icon: User },
  { id: "password", labelKey: "acct.tabSecurity", icon: Lock },
  { id: "notifications", labelKey: "acct.tabNotifications", icon: Bell },
  { id: "verification", labelKey: "acct.tabVerification", icon: BadgeCheck },
];

/** Tabbed account settings (Profile / Password / Notifications / Verification).
 *  Shell-agnostic — render it inside Shell (student) or AdminShell (staff). */
export function AccountSettings() {
  const t = useT();
  const { user, refresh } = useAuth();
  // Students can't change their own password — it's managed by their administrator.
  const isCandidate = user?.role === "candidate";
  const tabs = TABS; // the Security tab (two-factor auth) is available to everyone
  const [tab, setTab] = useState<Tab>("profile");

  return (
    <div className="fade-in max-w-5xl">
      <PageHeader title={t("acct.title")} subtitle={t("acct.subtitle")} />

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[220px_1fr]">
        <nav className="card h-max p-2">
          {tabs.map((tt) => {
            const active = tab === tt.id;
            return (
              <button key={tt.id} onClick={() => setTab(tt.id)}
                className={clsx("flex w-full items-center gap-2.5 rounded-[3px] px-3 py-2.5 text-sm font-medium transition",
                  active ? "bg-brand-500/15 text-brand-400" : "text-[var(--muted)] hover:bg-white/[0.04] hover:text-[var(--fg)]")}>
                <tt.icon className="h-4 w-4 shrink-0" /> {t(tt.labelKey)}
              </button>
            );
          })}
        </nav>

        <div className="card p-6">
          {tab === "profile" && <ProfileTab user={user} refresh={refresh} />}
          {tab === "password" && (
            <>
              {!isCandidate && <PasswordTab />}
              <TwoFactorSettings />
            </>
          )}
          {tab === "notifications" && <NotificationsTab user={user} refresh={refresh} />}
          {tab === "verification" && <VerificationTab user={user} />}
        </div>
      </div>
    </div>
  );
}

// ─── Profile Settings ───────────────────────────────────────────────────────
function ProfileTab({ user, refresh }: { user: ReturnType<typeof useAuth>["user"]; refresh: () => Promise<void> }) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [first, setFirst] = useState(user?.name?.split(" ")[0] ?? "");
  const [last, setLast] = useState(user?.name?.split(" ").slice(1).join(" ") ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [gender, setGender] = useState(user?.gender ?? "");
  const [avatar, setAvatar] = useState<string | undefined>(user?.avatarUrl);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const initials = `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase() || (user?.name?.[0] ?? "U");

  const pickAvatar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setErr(t("acct.errImage")); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // Downscale + crop to a centred square so any photo fits well under the server cap.
        const SIZE = 256;
        const canvas = document.createElement("canvas");
        canvas.width = SIZE; canvas.height = SIZE;
        const ctx = canvas.getContext("2d");
        if (!ctx) { setAvatar(String(reader.result)); setErr(null); return; }
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE);
        setAvatar(canvas.toDataURL("image/jpeg", 0.85));
        setErr(null);
      };
      img.onerror = () => setErr(t("acct.errReadImage"));
      img.src = String(reader.result);
    };
    reader.onerror = () => setErr(t("acct.errReadFile"));
    reader.readAsDataURL(file);
  };

  const save = async () => {
    setBusy(true); setMsg(null); setErr(null);
    try {
      await api.patch("/me/profile", { name: `${first} ${last}`.trim(), phone, gender, avatarUrl: avatar ?? "" });
      await refresh();
      setMsg(t("acct.profileSaved"));
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-5 border-b border-[var(--border)] pb-6">
        <div className="relative">
          {avatar
            ? <img src={avatar} alt="" className="h-20 w-20 rounded-full object-cover ring-2 ring-[var(--border)]" />
            : <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[#111110] text-2xl font-bold text-white">{initials}</div>}
          <button onClick={() => fileRef.current?.click()} className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-white ring-2 ring-[var(--card)] hover:bg-brand-500">
            <Camera className="h-3.5 w-3.5" />
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pickAvatar} />
        </div>
        <div className="flex gap-2">
          <button onClick={() => fileRef.current?.click()} className="btn btn-primary h-10">{t("acct.uploadNew")}</button>
          <button onClick={() => setAvatar(undefined)} disabled={!avatar} className="btn btn-outline h-10 disabled:opacity-50"><Trash2 className="h-4 w-4" /> {t("acct.deleteAvatar")}</button>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
        <Field label={t("acct.firstName")} required><input className="input h-11" value={first} onChange={(e) => setFirst(e.target.value)} placeholder={t("acct.firstName")} /></Field>
        <Field label={t("acct.lastName")} required><input className="input h-11" value={last} onChange={(e) => setLast(e.target.value)} placeholder={t("acct.lastName")} /></Field>
        <Field label={t("acct.email")}>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
            <input className="input h-11 pl-9 opacity-70" value={user?.email ?? ""} readOnly title={t("acct.emailLocked")} />
          </div>
        </Field>
        <Field label={t("acct.mobile")}>
          <div className="relative">
            <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
            <input className="input h-11 pl-9" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0806 123 7890" />
          </div>
        </Field>
        <Field label={t("acct.gender")}>
          <div className="grid grid-cols-2 gap-2">
            {["male", "female"].map((g) => (
              <button key={g} onClick={() => setGender(gender === g ? "" : g)}
                className={clsx("flex items-center justify-center gap-2 rounded-[3px] border py-2.5 text-sm transition",
                  gender === g ? "border-brand-500 bg-brand-500/15 text-brand-400" : "border-[var(--border)] text-[var(--muted)] hover:bg-white/[0.02]")}>
                <span className={clsx("h-3.5 w-3.5 rounded-full border-2", gender === g ? "border-brand-500 bg-brand-500" : "border-[var(--muted)]")} />
                {t(`acct.${g}`)}
              </button>
            ))}
          </div>
        </Field>
        <Field label={t("acct.role")}><input className="input h-11 capitalize opacity-70" value={user?.role ?? ""} readOnly /></Field>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button onClick={save} disabled={busy || !first.trim()} className="btn btn-primary h-11 px-6 disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {t("acct.saveChanges")}
        </button>
        {msg && <span className="inline-flex items-center gap-1.5 text-sm text-emerald-400"><CheckCircle2 className="h-4 w-4" /> {msg}</span>}
        {err && <span className="text-sm text-rose-400">{err}</span>}
      </div>
    </div>
  );
}

// ─── Password ─────────────────────────────────────────────────────────────────
function PasswordTab() {
  const t = useT();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function changePassword() {
    setMsg(null); setErr(null);
    if (next.length < 6) { setErr(t("acct.errPwShort")); return; }
    if (next !== confirm) { setErr(t("acct.errPwMatch")); return; }
    setBusy(true);
    try {
      await api.post("/me/password", { current, password: next });
      setMsg(t("acct.passwordUpdated")); setCurrent(""); setNext(""); setConfirm("");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="max-w-md">
      <h2 className="text-sm font-semibold">{t("acct.changePassword")}</h2>
      <p className="mt-0.5 text-xs text-[var(--muted)]">{t("acct.passwordHint")}</p>
      <div className="mt-4 space-y-3">
        <Field label={t("acct.currentPassword")}><input type="password" className="input h-11" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" /></Field>
        <Field label={t("acct.newPassword")}><input type="password" className="input h-11" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" /></Field>
        <Field label={t("acct.confirmPassword")}><input type="password" className="input h-11" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" /></Field>
      </div>
      <div className="mt-5 flex items-center gap-3">
        <button onClick={changePassword} disabled={busy || !current || !next} className="btn btn-primary h-11 px-6 disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {t("acct.updatePassword")}
        </button>
        {msg && <span className="inline-flex items-center gap-1.5 text-sm text-emerald-400"><CheckCircle2 className="h-4 w-4" /> {msg}</span>}
        {err && <span className="text-sm text-rose-400">{err}</span>}
      </div>
    </div>
  );
}

// ─── Notifications ────────────────────────────────────────────────────────────
function NotificationsTab({ user, refresh }: { user: ReturnType<typeof useAuth>["user"]; refresh: () => Promise<void> }) {
  const t = useT();
  const init = user?.notificationPrefs ?? {};
  const [prefs, setPrefs] = useState<NotificationPrefs>({
    announcements: init.announcements ?? true,
    results: init.results ?? true,
    reminders: init.reminders ?? true,
  });
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const ROWS: { key: keyof NotificationPrefs; labelKey: string; descKey: string }[] = [
    { key: "announcements", labelKey: "acct.notifAnnouncements", descKey: "acct.notifAnnouncementsDesc" },
    { key: "results", labelKey: "acct.notifResults", descKey: "acct.notifResultsDesc" },
    { key: "reminders", labelKey: "acct.notifReminders", descKey: "acct.notifRemindersDesc" },
  ];

  // Autosave each toggle (debounced).
  const toggle = (key: keyof NotificationPrefs) => {
    setPrefs((p) => {
      const next = { ...p, [key]: !p[key] };
      setStatus("saving");
      clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        try { await api.patch("/me/profile", { notificationPrefs: next }); await refresh(); setStatus("saved"); }
        catch { setStatus("idle"); }
      }, 400);
      return next;
    });
  };

  return (
    <div className="max-w-lg">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t("acct.notifPrefs")}</h2>
        <span className="text-xs text-[var(--muted)]">
          {status === "saving" ? <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("acct.saving")}</span>
            : status === "saved" ? <span className="inline-flex items-center gap-1.5 text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> {t("acct.saved")}</span>
            : ""}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-[var(--muted)]">{t("acct.notifHint")}</p>
      <div className="mt-4 space-y-2">
        {ROWS.map((r) => {
          const on = !!prefs[r.key];
          return (
            <button key={r.key} onClick={() => toggle(r.key)}
              className="flex w-full items-center justify-between gap-3 rounded-[3px] border border-[var(--border)] p-3.5 text-left hover:bg-white/[0.02]">
              <div>
                <p className="text-sm font-medium">{t(r.labelKey)}</p>
                <p className="text-xs text-[var(--muted)]">{t(r.descKey)}</p>
              </div>
              <span className={clsx("inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition", on ? "bg-brand-600" : "bg-[var(--border)]")}>
                <span className={clsx("h-4 w-4 rounded-full bg-white transition", on && "translate-x-4")} />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Verification ─────────────────────────────────────────────────────────────
function VerificationTab({ user }: { user: ReturnType<typeof useAuth>["user"] }) {
  const t = useT();
  const isCandidate = user?.role === "candidate";
  const rows: { label: string; value: string; state: "ok" | "info" }[] = [
    { label: t("acct.emailAddress"), value: user?.email ?? "—", state: user?.email ? "ok" : "info" },
    { label: t("acct.accountRole"), value: user?.role ?? "—", state: "ok" },
    isCandidate
      ? { label: t("acct.identity"), value: t("acct.identityCandidate"), state: "info" }
      : { label: t("acct.identity"), value: t("acct.identityStaff"), state: "ok" },
  ];
  return (
    <div className="max-w-lg">
      <h2 className="text-sm font-semibold">{t("acct.verification")}</h2>
      <p className="mt-0.5 text-xs text-[var(--muted)]">{t("acct.verifHint")}</p>
      <div className="mt-4 space-y-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-3 rounded-[3px] border border-[var(--border)] p-3.5">
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--muted)]">{r.label}</p>
              <p className="mt-0.5 text-sm font-medium capitalize">{r.value}</p>
            </div>
            {r.state === "ok" ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-400">
                <BadgeCheck className="h-3.5 w-3.5" /> {t("acct.onFile")}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--card-2)] px-2.5 py-1 text-[11px] font-semibold text-[var(--muted)]">
                {t("acct.perSession")}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}{required && <span className="text-rose-400"> *</span>}</span>
      {children}
    </label>
  );
}
