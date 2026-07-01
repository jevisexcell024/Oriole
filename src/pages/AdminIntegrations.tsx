import { useEffect, useState } from "react";
import { Webhook as WebhookIcon, KeyRound, Plus, Trash2, Loader2, Copy, Check, Send, Power } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { useT } from "@/lib/i18n";
import { clsx } from "clsx";

interface Hook { id: string; url: string; events: string[]; secret: string; active: boolean; createdAt: string; lastStatus: number | null; lastAt: string | null; }
interface ApiKey { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null; }
interface Resp { events: string[]; webhooks: Hook[]; apiKeys: ApiKey[]; }

export function AdminIntegrations() {
  const t = useT();
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [sel, setSel] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const reload = () => api.get<Resp>("/admin/integrations").then(setData).catch((e) => setError(e.message));
  useEffect(() => { reload(); }, []);

  const toggleEvent = (e: string) => setSel((cur) => (cur.includes(e) ? cur.filter((x) => x !== e) : [...cur, e]));

  async function addHook() {
    setAdding(true); setError(null);
    try { await api.post("/admin/webhooks", { url: url.trim(), events: sel }); setUrl(""); setSel([]); await reload(); }
    catch (e) { setError((e as Error).message); } finally { setAdding(false); }
  }
  async function toggleHook(h: Hook) { try { await api.patch(`/admin/webhooks/${h.id}`, { active: !h.active }); await reload(); } catch (e) { setError((e as Error).message); } }
  async function delHook(id: string) { try { await api.del(`/admin/webhooks/${id}`); await reload(); } catch (e) { setError((e as Error).message); } }
  async function testHook(id: string) { try { await api.post(`/admin/webhooks/${id}/test`); setTimeout(reload, 1500); } catch (e) { setError((e as Error).message); } }

  async function createKey() {
    setError(null);
    try { const d = await api.post<{ key: string }>("/admin/apikeys", { name: keyName.trim() || "API key" }); setNewKey(d.key); setKeyName(""); await reload(); }
    catch (e) { setError((e as Error).message); }
  }
  async function delKey(id: string) { try { await api.del(`/admin/apikeys/${id}`); await reload(); } catch (e) { setError((e as Error).message); } }

  return (
    <AdminShell wide>
      <div className="fade-in max-w-4xl">
        <PageHeader title={t("aintg.title")} subtitle={t("aintg.subtitle")} />
        {error && <p className="mt-6 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</p>}
        {!data ? <div className="mt-8 flex items-center gap-2 text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}</div> : (
          <>
            <h2 className="mt-6 flex items-center gap-2 text-sm font-semibold"><WebhookIcon className="h-4 w-4 text-[#c6ff34]" /> {t("aintg.webhooks")}</h2>
            <p className="text-xs text-[var(--muted)]">{t("aintg.webhookDesc1")}<code className="rounded bg-[var(--card-2)] px-1">x-orcalis-signature</code>{t("aintg.webhookDesc2")}</p>

            <div className="card mt-3 p-4">
              <input className="input h-9" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-system.example.com/orcalis-hook" />
              <div className="mt-3 flex flex-wrap gap-2">
                {data.events.map((e) => (
                  <button key={e} type="button" onClick={() => toggleEvent(e)} className={clsx("rounded-full border px-3 py-1 text-xs font-medium transition", sel.includes(e) ? "border-[#c6ff34] bg-[rgba(198,255,52,0.12)] text-[#c6ff34]" : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)]")}>{e}</button>
                ))}
              </div>
              <button onClick={addHook} disabled={adding || !url.trim() || sel.length === 0} className="btn btn-primary mt-3 h-9 disabled:opacity-50">{adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {t("aintg.addWebhook")}</button>
            </div>

            <div className="mt-3 space-y-2">
              {data.webhooks.length === 0 && <p className="text-sm text-[var(--muted)]">{t("aintg.noWebhooks")}</p>}
              {data.webhooks.map((h) => (
                <div key={h.id} className="card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{h.url}</p>
                      <p className="mt-0.5 text-xs text-[var(--muted)]">{h.events.join(", ")}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-semibold", h.active ? "bg-emerald-500/15 text-emerald-500" : "bg-[var(--card-2)] text-[var(--muted)]")}>{h.active ? t("aintg.active") : t("aintg.paused")}</span>
                      <button onClick={() => testHook(h.id)} title={t("aintg.testPing")} className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--card-2)] hover:text-[var(--fg)]"><Send className="h-4 w-4" /></button>
                      <button onClick={() => toggleHook(h)} title={h.active ? t("aintg.pause") : t("aintg.resume")} className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--card-2)] hover:text-[var(--fg)]"><Power className="h-4 w-4" /></button>
                      <button onClick={() => delHook(h.id)} title={t("aintg.delete")} className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-rose-500/10 hover:text-rose-400"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--muted)]">
                    <span>{t("aintg.secret")} <code className="rounded bg-[var(--card-2)] px-1 break-all">{h.secret}</code></span>
                    {h.lastAt && <span>{t("aintg.lastDelivery", { status: h.lastStatus === 0 ? t("aintg.failed") : `HTTP ${h.lastStatus}`, when: new Date(h.lastAt).toLocaleString() })}</span>}
                  </div>
                </div>
              ))}
            </div>

            <h2 className="mt-8 flex items-center gap-2 text-sm font-semibold"><KeyRound className="h-4 w-4 text-[#c6ff34]" /> {t("aintg.apiKeys")}</h2>
            <p className="text-xs text-[var(--muted)]">{t("aintg.apiDescPre")}<code className="rounded bg-[var(--card-2)] px-1">/api/v1/exams</code>, <code className="rounded bg-[var(--card-2)] px-1">/api/v1/results</code>{t("aintg.apiDescAnd")}<code className="rounded bg-[var(--card-2)] px-1">/api/v1/certificates</code>{t("aintg.apiDescAuth")}<code className="rounded bg-[var(--card-2)] px-1">Authorization: Bearer &lt;key&gt;</code>.</p>

            {newKey && (
              <div className="card mt-3 border-emerald-500/40 p-4">
                <p className="text-sm font-semibold text-emerald-400">{t("aintg.newKeyTitle")}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <code className="min-w-[200px] flex-1 break-all rounded-md bg-[var(--card-2)] px-2 py-1.5 text-xs">{newKey}</code>
                  <button onClick={() => { navigator.clipboard.writeText(newKey).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }} className="btn btn-outline h-9">{copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />} {copied ? t("aintg.copied") : t("aintg.copy")}</button>
                  <button onClick={() => setNewKey(null)} className="btn btn-ghost h-9">{t("aintg.done")}</button>
                </div>
              </div>
            )}

            <div className="card mt-3 flex flex-wrap items-end gap-3 p-4">
              <label className="min-w-[200px] flex-1 text-[11px] text-[var(--muted)]">{t("aintg.name")}<input className="input mt-1 h-9" value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="e.g. Registrar integration" /></label>
              <button onClick={createKey} className="btn btn-primary h-9"><Plus className="h-4 w-4" /> {t("aintg.createKey")}</button>
            </div>

            {data.apiKeys.length > 0 && (
              <div className="mt-3 space-y-2">
                {data.apiKeys.map((k) => (
                  <div key={k.id} className="card flex items-center justify-between gap-3 p-3.5">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{k.name}</p>
                      <p className="truncate text-xs text-[var(--muted)]"><code>{k.prefix}…</code> · {t("aintg.createdOn", { date: new Date(k.createdAt).toLocaleDateString() })}{k.lastUsedAt ? t("aintg.lastUsedSuffix", { date: new Date(k.lastUsedAt).toLocaleDateString() }) : t("aintg.neverUsed")}</p>
                    </div>
                    <button onClick={() => delKey(k.id)} title={t("aintg.revoke")} className="rounded-lg p-2 text-[var(--muted)] hover:bg-rose-500/10 hover:text-rose-400"><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </AdminShell>
  );
}
