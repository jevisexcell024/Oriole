import { useEffect, useState } from "react";
import { Loader2, AlertTriangle, Check } from "lucide-react";
import { SuperAdminShell } from "@/components/SuperAdminShell";
import { PageHeader } from "@/components/PageHeader";
import { ErrorBanner } from "@/components/ui";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { clsx } from "clsx";

interface MaintenanceState { id: string; enabled: boolean; message: string; updatedAt: string | null; updatedBy: string | null; }

export function SuperAdminMaintenance() {
  const t = useT();
  const [data, setData] = useState<MaintenanceState | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.get<MaintenanceState>("/super-admin/maintenance").then((d) => { setData(d); setMessage(d.message); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function setEnabled(enabled: boolean) {
    setError(null); setBusy(true);
    try { const d = await api.patch<MaintenanceState>("/super-admin/maintenance", { enabled, message }); setData(d); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <SuperAdminShell>
      <div className="fade-in max-w-2xl">
        <PageHeader eyebrow={t("sad.dashEyebrow")} title={t("sad.maintTitle")} subtitle={t("sad.maintSubtitle")} />

        <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t("sad.maintWarn")}</span>
        </div>

        {error && <ErrorBanner className="mt-4">{error}</ErrorBanner>}
        {!data && !error && <div className="mt-8 flex items-center gap-2 text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}</div>}

        {data && (
          <div className="card mt-4 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">{t("sad.maintStatus")}</p>
                <p className="text-xs text-[var(--muted)]">
                  {data.enabled
                    ? (data.updatedAt ? t("sad.maintEnabledSince", { when: new Date(data.updatedAt).toLocaleString(), who: data.updatedBy ?? "" }) : t("sad.maintEnabledNow"))
                    : t("sad.maintDisabledDesc")}
                </p>
              </div>
              <span className={clsx("inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
                data.enabled ? "bg-rose-500/15 text-rose-400" : "bg-emerald-500/15 text-emerald-400")}>
                {data.enabled ? t("sad.maintOn") : t("sad.maintOff")}
              </span>
            </div>

            <label className="mt-4 block">
              <span className="mb-1 block text-sm font-medium">{t("sad.maintMessage")}</span>
              <textarea
                className="input min-h-20 py-2"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={500}
                placeholder={t("sad.maintMessagePlaceholder")}
              />
            </label>

            <div className="mt-4 flex justify-end gap-2">
              {data.enabled ? (
                <button onClick={() => setEnabled(false)} disabled={busy} className="btn btn-primary disabled:opacity-50">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {t("sad.maintTurnOff")}
                </button>
              ) : (
                <button onClick={() => setEnabled(true)} disabled={busy} className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-600 disabled:opacity-50">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />} {t("sad.maintTurnOn")}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </SuperAdminShell>
  );
}
