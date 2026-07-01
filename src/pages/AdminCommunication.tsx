import { useEffect, useState } from "react";
import {
  Megaphone, MessageSquare, Users, Plus, X, Bell, Mail, Phone, MessageCircle,
  Send, Loader2, CheckCircle2, Zap, FlaskConical, Inbox, Trash2, Clock,
} from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { PageHeader } from "@/components/PageHeader";
import { api } from "@/lib/api";
import { useT, type TFn } from "@/lib/i18n";
import { clsx } from "clsx";

type Tab = "announcements" | "compose" | "broadcast";
type Channel = "in_app" | "email" | "sms" | "whatsapp";

interface Announcement {
  id: string; title: string; message: string; audience: string; priority: string;
  channels: Channel[]; status: string; scheduledFor: string | null; createdAt: string;
  sentAt: string | null; emailedCount?: number;
}
interface Kpis { total: number; sent: number; scheduled: number; drafts: number; }
interface MailerStatus { mode: string; live: boolean; from: string; host: string | null; lastError: string | null; }
interface EmailMsg { id: string; to: string; subject: string; sentAt: string; delivery?: string; }
interface ExamOpt { id: string; title: string }

const fmt = (s: string | null) => (s ? new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

const PRIORITY_TONE: Record<string, string> = {
  normal: "bg-[var(--card-2)] text-[var(--muted)]", high: "bg-amber-500/20 text-amber-400", urgent: "bg-rose-500/20 text-rose-400",
};
const STATUS_TONE: Record<string, string> = {
  sent: "bg-emerald-500/20 text-emerald-400", scheduled: "bg-blue-500/20 text-blue-400", draft: "bg-orange-500/20 text-orange-400",
};
const CHANNEL_KEY: Record<Channel, string> = { in_app: "acom.chInApp", email: "acom.chEmail", sms: "SMS", whatsapp: "WhatsApp" };
const STATUS_KEY: Record<string, string> = { sent: "acom.statusSent", scheduled: "acom.statusScheduled", draft: "acom.statusDraft" };
const PRIORITY_KEY: Record<string, string> = { normal: "acom.prNormal", high: "acom.prHigh", urgent: "acom.prUrgent" };
const AUDIENCE_KEY: Record<string, string> = { everyone: "acom.audEveryone", students: "acom.audStudents", instructors: "acom.audInstructors", admins: "acom.audAdmins" };

export function AdminCommunication() {
  const t = useT();
  const [tab, setTab] = useState<Tab>("announcements");
  const [anns, setAnns] = useState<Announcement[] | null>(null);
  const [kpis, setKpis] = useState<Kpis>({ total: 0, sent: 0, scheduled: 0, drafts: 0 });
  const [mailer, setMailer] = useState<MailerStatus | null>(null);
  const [modal, setModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAnns = () =>
    api.get<{ announcements: Announcement[]; kpis: Kpis }>("/admin/announcements")
      .then((d) => { setAnns(d.announcements); setKpis(d.kpis); })
      .catch((e) => setError(e.message));

  useEffect(() => {
    loadAnns();
    api.get<MailerStatus>("/admin/communication/status").then(setMailer).catch(() => {});
  }, []);

  return (
    <AdminShell wide>
      <div className="fade-in max-w-5xl">
        <PageHeader title={t("acom.title")} subtitle={t("acom.subtitle")} />
        {/* KPIs */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Kpi label={t("acom.kpiTotal")} value={kpis.total} />
          <Kpi label={t("acom.kpiSent")} value={kpis.sent} tone="text-emerald-400" />
          <Kpi label={t("acom.kpiScheduled")} value={kpis.scheduled} tone="text-blue-400" />
          <Kpi label={t("acom.kpiDrafts")} value={kpis.drafts} tone="text-orange-400" />
        </div>

        {/* Tabs + action */}
        <div className="mt-5 flex items-center justify-between">
          <div className="inline-flex rounded-xl border border-[var(--border)] bg-[var(--card)] p-1">
            <TabBtn active={tab === "announcements"} onClick={() => setTab("announcements")} icon={Megaphone}>{t("acom.tabAnnouncements")}</TabBtn>
            <TabBtn active={tab === "compose"} onClick={() => setTab("compose")} icon={MessageSquare}>{t("acom.tabCompose")}</TabBtn>
            <TabBtn active={tab === "broadcast"} onClick={() => setTab("broadcast")} icon={Users}>{t("acom.tabBroadcast")}</TabBtn>
          </div>
          <button onClick={() => setModal(true)} className="btn btn-primary"><Plus className="h-4 w-4" /> {t("acom.newAnnouncement")}</button>
        </div>

        {error && <p className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</p>}

        <div className="mt-5">
          {tab === "announcements" && <AnnouncementsTab t={t} anns={anns} onNew={() => setModal(true)} onReload={loadAnns} />}
          {tab === "compose" && <ComposeTab t={t} mailer={mailer} />}
          {tab === "broadcast" && <BroadcastTab t={t} mailer={mailer} />}
        </div>
      </div>

      {modal && <NewAnnouncementModal t={t} mailer={mailer} onClose={() => setModal(false)} onCreated={() => { setModal(false); loadAnns(); setTab("announcements"); }} />}
    </AdminShell>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className={clsx("mt-1 text-2xl font-bold tabular-nums", tone)}>{value}</p>
    </div>
  );
}

function TabBtn({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: typeof Megaphone; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={clsx("flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition",
      active ? "bg-[var(--color-navy)] text-white shadow-sm" : "text-[var(--muted)] hover:text-[var(--fg)]")}>
      <Icon className="h-4 w-4" /> {children}
    </button>
  );
}

// ------------------------------------------------------------ Announcements list
function AnnouncementsTab({ t, anns, onNew, onReload }: { t: TFn; anns: Announcement[] | null; onNew: () => void; onReload: () => void }) {
  async function del(id: string) {
    try { await api.del(`/admin/announcements/${id}`); onReload(); } catch { /* ignore */ }
  }
  if (!anns) return <div className="flex items-center gap-2 py-10 text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}</div>;
  if (anns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border)] py-20 text-center">
        <Megaphone className="h-9 w-9 text-[var(--muted)]" />
        <p className="mt-3 text-base font-semibold">{t("acom.noAnnouncements")}</p>
        <p className="text-sm text-[var(--muted)]">{t("acom.createToNotify")}</p>
        <button onClick={onNew} className="btn btn-primary mt-4"><Plus className="h-4 w-4" /> {t("acom.createAnnouncement")}</button>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {anns.map((a) => (
        <div key={a.id} className="card p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">{a.title}</p>
                <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS_TONE[a.status])}>{t(STATUS_KEY[a.status] ?? a.status)}</span>
                <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-semibold", PRIORITY_TONE[a.priority])}>{t(PRIORITY_KEY[a.priority] ?? a.priority)}</span>
              </div>
              <p className="mt-1.5 whitespace-pre-line text-sm text-[var(--muted)]">{a.message}</p>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--muted)]">
                <span className="inline-flex items-center gap-1 rounded-md bg-[var(--bg)] px-1.5 py-0.5"><Users className="h-3 w-3" /> {t(AUDIENCE_KEY[a.audience] ?? a.audience)}</span>
                {a.channels.map((c) => (
                  <span key={c} className="rounded-md bg-[var(--bg)] px-1.5 py-0.5">{t(CHANNEL_KEY[c] ?? c)}</span>
                ))}
                {a.status === "scheduled" && a.scheduledFor && <span className="inline-flex items-center gap-1 text-blue-400"><Clock className="h-3 w-3" /> {fmt(a.scheduledFor)}</span>}
                {a.status === "sent" && <span>· {a.emailedCount ? t("acom.emailedSuffix", { n: a.emailedCount }) : ""}{fmt(a.sentAt)}</span>}
                {a.status === "draft" && <span>· {t("acom.draftSaved", { when: fmt(a.createdAt) })}</span>}
              </div>
            </div>
            <button onClick={() => del(a.id)} title={t("acom.delete")} className="shrink-0 rounded-lg p-2 text-[var(--muted)] hover:bg-white/[0.05] hover:text-rose-400"><Trash2 className="h-4 w-4" /></button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------ New Announcement modal
const CHANNELS: { key: Channel; labelKey: string; icon: typeof Bell }[] = [
  { key: "in_app", labelKey: "acom.chInApp", icon: Bell },
  { key: "email", labelKey: "acom.chEmail", icon: Mail },
  { key: "sms", labelKey: "SMS", icon: Phone },
  { key: "whatsapp", labelKey: "WhatsApp", icon: MessageCircle },
];

function NewAnnouncementModal({ t, mailer, onClose, onCreated }: { t: TFn; mailer: MailerStatus | null; onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [audience, setAudience] = useState("students");
  const [priority, setPriority] = useState("normal");
  const [channels, setChannels] = useState<Channel[]>(["in_app"]);
  const [scheduledFor, setScheduledFor] = useState("");
  const [busy, setBusy] = useState<"send" | "draft" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const toggle = (c: Channel) => setChannels((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]));

  async function submit(draft: boolean) {
    if (!title.trim() || !message.trim()) { setErr(t("acom.errTitleMsg")); return; }
    setBusy(draft ? "draft" : "send"); setErr(null);
    try {
      await api.post("/admin/announcements", {
        title, message, audience, priority, channels,
        scheduledFor: scheduledFor ? new Date(scheduledFor).toISOString() : null, draft,
      });
      onCreated();
    } catch (e) { setErr((e as Error).message); setBusy(null); }
  }

  const emailWarn = channels.includes("email") && mailer && !mailer.live;
  const smsWarn = channels.includes("sms") || channels.includes("whatsapp");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-[var(--card)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold">{t("acom.newAnnouncement")}</h2>
            <p className="text-sm text-[var(--muted)]">{t("acom.modalDesc")}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-[var(--muted)] hover:bg-white/[0.05]"><X className="h-5 w-5" /></button>
        </div>

        <label className="mt-4 block text-sm font-medium">{t("acom.fldTitle")}
          <input className="input mt-1 h-10" placeholder={t("acom.titlePh")} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="mt-3 block text-sm font-medium">{t("acom.fldMessage")}
          <textarea className="input mt-1 min-h-[110px] py-2" placeholder={t("acom.messagePh")} value={message} onChange={(e) => setMessage(e.target.value)} />
        </label>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium">{t("acom.fldAudience")}
            <select className="input mt-1 h-10" value={audience} onChange={(e) => setAudience(e.target.value)}>
              <option value="everyone">{t("acom.audEveryone")}</option>
              <option value="students">{t("acom.audStudents")}</option>
              <option value="instructors">{t("acom.audInstructors")}</option>
              <option value="admins">{t("acom.audAdmins")}</option>
            </select>
          </label>
          <label className="block text-sm font-medium">{t("acom.fldPriority")}
            <select className="input mt-1 h-10" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="normal">{t("acom.prNormal")}</option>
              <option value="high">{t("acom.prHigh")}</option>
              <option value="urgent">{t("acom.prUrgent")}</option>
            </select>
          </label>
        </div>

        <div className="mt-3">
          <p className="text-sm font-medium">{t("acom.fldChannels")}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {CHANNELS.map((c) => {
              const on = channels.includes(c.key);
              return (
                <button key={c.key} onClick={() => toggle(c.key)}
                  className={clsx("inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition",
                    on ? "border-[var(--color-navy)] bg-[var(--color-navy)] text-white" : "border-[var(--border)] text-[var(--muted)] hover:bg-white/[0.02]")}>
                  <c.icon className="h-4 w-4" /> {t(c.labelKey)}
                </button>
              );
            })}
          </div>
          {emailWarn && <p className="mt-1.5 text-[11px] text-amber-400">{t("acom.emailMockWarn")}</p>}
          {smsWarn && <p className="mt-1.5 text-[11px] text-amber-400">{t("acom.smsWarn")}</p>}
        </div>

        <label className="mt-3 block text-sm font-medium">{t("acom.fldSchedule")} <span className="font-normal text-[var(--muted)]">{t("acom.scheduleOpt")}</span>
          <input type="datetime-local" className="input mt-1 h-10" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} />
        </label>

        {err && <p className="mt-3 text-sm text-rose-400">{err}</p>}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--fg)]">{t("acom.cancel")}</button>
          <button onClick={() => submit(true)} disabled={!!busy} className="btn btn-outline disabled:opacity-50">
            {busy === "draft" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {t("acom.saveDraft")}
          </button>
          <button onClick={() => submit(false)} disabled={!!busy} className="btn btn-primary disabled:opacity-50">
            {busy === "send" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {scheduledFor ? t("acom.schedule") : t("acom.createAnnouncement")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ Compose (direct email)
const TEMPLATES = [
  { labelKey: "acom.tmplBlank", subjectKey: "", bodyKey: "" },
  { labelKey: "acom.tmplReminder", subjectKey: "acom.tmplReminderSubject", bodyKey: "acom.tmplReminderBody" },
  { labelKey: "acom.tmplResults", subjectKey: "acom.tmplResultsSubject", bodyKey: "acom.tmplResultsBody" },
];

function ComposeTab({ t, mailer }: { t: TFn; mailer: MailerStatus | null }) {
  const [exams, setExams] = useState<ExamOpt[]>([]);
  const [audience, setAudience] = useState<"all" | "exam">("all");
  const [examId, setExamId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ items: { exam: ExamOpt }[] }>("/admin/exams")
      .then((d) => { const xs = d.items.map((i) => i.exam); setExams(xs); if (xs[0]) setExamId(xs[0].id); }).catch(() => {});
  }, []);

  async function send() {
    if (!subject.trim() || !body.trim()) { setErr(t("acom.errSubjectMsg")); return; }
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await api.post<{ sent: number; delivered: number; failed: number }>("/admin/communication/send", {
        audience, examId: audience === "exam" ? examId : undefined, subject, body,
      });
      setMsg(mailer?.live
        ? t("acom.delivered", { delivered: r.delivered, sent: r.sent, failed: r.failed ? t("acom.failedSuffix", { n: r.failed }) : "" })
        : t("acom.recordedMock", { n: r.sent }));
      setSubject(""); setBody("");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="card max-w-xl p-5">
      <h2 className="text-sm font-semibold">{t("acom.composeTitle")}</h2>
      <div className="mt-3 flex gap-2">
        <button onClick={() => setAudience("all")} className={clsx("flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium", audience === "all" ? "border-brand-500 bg-brand-500/15 text-brand-400" : "border-[var(--border)] text-[var(--muted)]")}><Users className="h-4 w-4" /> {t("acom.allStudents")}</button>
        <button onClick={() => setAudience("exam")} className={clsx("flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium", audience === "exam" ? "border-brand-500 bg-brand-500/15 text-brand-400" : "border-[var(--border)] text-[var(--muted)]")}><MessageSquare className="h-4 w-4" /> {t("acom.byExam")}</button>
      </div>
      {audience === "exam" && (
        <select className="input mt-3 h-10" value={examId} onChange={(e) => setExamId(e.target.value)}>
          {exams.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
        </select>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {TEMPLATES.map((tpl) => (
          <button key={tpl.labelKey} onClick={() => { setSubject(tpl.subjectKey ? t(tpl.subjectKey) : ""); setBody(tpl.bodyKey ? t(tpl.bodyKey) : ""); }} className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted)] hover:bg-white/[0.03]">{t(tpl.labelKey)}</button>
        ))}
      </div>
      <input className="input mt-3 h-10" placeholder={t("acom.subjectPh")} value={subject} onChange={(e) => setSubject(e.target.value)} />
      <textarea className="input mt-3 min-h-[140px] py-2" placeholder={t("acom.bodyPh")} value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="mt-3 flex items-center justify-between">
        {msg ? <span className="inline-flex items-center gap-1.5 text-sm text-emerald-400"><CheckCircle2 className="h-4 w-4" /> {msg}</span> : err ? <span className="text-sm text-rose-400">{err}</span> : <span />}
        <button onClick={send} disabled={busy} className="btn btn-primary disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {t("acom.send")}</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ Broadcast (delivery log)
function BroadcastTab({ t, mailer }: { t: TFn; mailer: MailerStatus | null }) {
  const [emails, setEmails] = useState<EmailMsg[] | null>(null);
  useEffect(() => { api.get<{ emails: EmailMsg[] }>("/admin/emails").then((d) => setEmails(d.emails)).catch(() => setEmails([])); }, []);
  return (
    <div className="max-w-2xl">
      {mailer && (
        <div className={clsx("mb-4 flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm",
          mailer.live ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-500" : "border-amber-500/30 bg-amber-500/15 text-amber-500")}>
          {mailer.live ? <Zap className="h-4 w-4" /> : <FlaskConical className="h-4 w-4" />}
          {mailer.live ? <span>{t("acom.liveVia", { host: mailer.host ?? mailer.mode, from: mailer.from })}</span>
            : <span><span className="font-semibold">{t("acom.mockMode1")}</span>{t("acom.mockMode2")}<code>MAIL_TRANSPORT=smtp</code>{t("acom.mockMode3")}</span>}
        </div>
      )}
      <div className="card p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Inbox className="h-4 w-4 text-brand-400" /> {t("acom.deliveryLog")} {emails && <span className="text-xs font-normal text-[var(--muted)]">· {emails.length}</span>}</h2>
        {!emails ? <div className="mt-3 flex items-center gap-2 text-sm text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}</div>
          : emails.length === 0 ? <p className="mt-3 text-sm text-[var(--muted)]">{t("acom.nothingSent")}</p>
          : (
            <div className="mt-3 max-h-[480px] space-y-2 overflow-y-auto pr-1">
              {emails.map((m) => (
                <div key={m.id} className="rounded-lg border border-[var(--border)] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium">{m.subject}</p>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <DeliveryBadge t={t} delivery={m.delivery} />
                      <span className="text-[11px] text-[var(--muted)]">{fmt(m.sentAt)}</span>
                    </span>
                  </div>
                  <p className="text-xs text-[var(--muted)]">{t("acom.toPrefix", { to: m.to })}</p>
                </div>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}

function DeliveryBadge({ t, delivery }: { t: TFn; delivery?: string }) {
  const map: Record<string, { labelKey: string; cls: string }> = {
    sent: { labelKey: "acom.badgeSent", cls: "bg-emerald-500/20 text-emerald-400" },
    failed: { labelKey: "acom.badgeFailed", cls: "bg-rose-500/20 text-rose-400" },
    logged: { labelKey: "acom.badgeLogged", cls: "bg-[var(--card-2)] text-[var(--muted)]" },
  };
  const m = map[delivery ?? "logged"] ?? map.logged;
  return <span className={clsx("rounded-full px-1.5 py-0.5 text-[10px] font-semibold", m.cls)}>{t(m.labelKey)}</span>;
}
