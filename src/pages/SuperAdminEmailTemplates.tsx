import { useEffect, useState } from "react";
import { Mail, Loader2, Pencil, RotateCcw, Check } from "lucide-react";
import { SuperAdminShell } from "@/components/SuperAdminShell";
import { PageHeader } from "@/components/PageHeader";
import { ErrorBanner, Modal } from "@/components/ui";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { clsx } from "clsx";

interface Template {
  key: string;
  label: string;
  description: string;
  variables: string[];
  defaultSubject: string;
  defaultIntro: string;
  subject: string;
  intro: string;
  customized: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

export function SuperAdminEmailTemplates() {
  const t = useT();
  const [rows, setRows] = useState<Template[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Template | null>(null);

  const load = () => api.get<{ templates: Template[] }>("/super-admin/email-templates").then((d) => setRows(d.templates)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  return (
    <SuperAdminShell>
      <div className="fade-in max-w-3xl">
        <PageHeader eyebrow={t("sad.dashEyebrow")} title={t("sad.tplTitle")} subtitle={t("sad.tplSubtitle")} />

        {error && <ErrorBanner className="mt-4">{error}</ErrorBanner>}
        {!rows && !error && <div className="mt-8 flex items-center gap-2 text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}</div>}

        {rows && (
          <div className="mt-6 space-y-3">
            {rows.map((tpl) => (
              <div key={tpl.key} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#c6ff34]/15 text-[#8fb31f]"><Mail className="h-4 w-4" /></span>
                    <div>
                      <p className="text-sm font-semibold">{tpl.label}</p>
                      <p className="text-xs text-[var(--muted)]">{tpl.description}</p>
                      <p className="mt-2 text-sm font-medium">{tpl.subject}</p>
                      <p className="mt-0.5 text-xs text-[var(--muted)]">{tpl.intro}</p>
                    </div>
                  </div>
                  <span className={clsx("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", tpl.customized ? "bg-blue-500/15 text-blue-400" : "bg-[var(--card-2)] text-[var(--muted)]")}>
                    {tpl.customized ? t("sad.tplCustomized") : t("sad.tplDefault")}
                  </span>
                </div>
                <div className="mt-3 flex justify-end">
                  <button onClick={() => setEditing(tpl)} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-[var(--muted)] hover:bg-white/[0.05] hover:text-[var(--fg)]">
                    <Pencil className="h-3.5 w-3.5" /> {t("sad.tplEdit")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && <EditModal template={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load(); }} />}
    </SuperAdminShell>
  );
}

function EditModal({ template, onClose, onDone }: { template: Template; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [subject, setSubject] = useState(template.subject);
  const [intro, setIntro] = useState(template.intro);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true); setErr(null);
    try { await api.patch(`/super-admin/email-templates/${template.key}`, { subject, intro }); onDone(); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  }
  async function reset() {
    setBusy(true); setErr(null);
    try { await api.patch(`/super-admin/email-templates/${template.key}`, {}); onDone(); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  return (
    <Modal title={template.label} onClose={onClose}>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-[var(--muted)]">{t("sad.tplVariablesHint")} {template.variables.map((v) => `{{${v}}}`).join(", ")}</p>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">{t("sad.tplSubjectField")}</span>
          <input className="input h-10" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">{t("sad.tplIntroField")}</span>
          <textarea className="input min-h-24 py-2" value={intro} onChange={(e) => setIntro(e.target.value)} maxLength={1000} />
        </label>
        {err && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">{err}</p>}
      </div>
      <div className="mt-5 flex items-center justify-between gap-2">
        <button onClick={reset} disabled={busy || !template.customized} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-40">
          <RotateCcw className="h-3.5 w-3.5" /> {t("sad.tplResetDefault")}
        </button>
        <div className="flex gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--fg)]">{t("ateam.cancel")}</button>
          <button onClick={save} disabled={busy || !subject.trim() || !intro.trim()} className="btn btn-primary disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {t("ateam.save")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
