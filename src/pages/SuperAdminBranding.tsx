import { useEffect, useState } from "react";
import { Loader2, Check, Palette, Clock } from "lucide-react";
import { SuperAdminShell } from "@/components/SuperAdminShell";
import { PageHeader } from "@/components/PageHeader";
import { ErrorBanner } from "@/components/ui";
import { api } from "@/lib/api";
import { useSuperAdminAuth } from "@/lib/superAdminAuth";

interface Branding { id: string; defaultBrandColor: string; updatedAt: string | null; updatedBy: string | null; }

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const PRESETS = ["#c6ff34", "#22d3ee", "#c084fc", "#fb923c", "#4ade80", "#f43f5e", "#60a5fa", "#f59e0b"];

export function SuperAdminBranding() {
  const { superAdmin } = useSuperAdminAuth();
  const isOwner = (superAdmin?.role ?? "owner") === "owner";
  const [data, setData] = useState<Branding | null>(null);
  const [color, setColor] = useState("#c6ff34");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = () => api.get<Branding>("/super-admin/branding").then((d) => { setData(d); setColor(d.defaultBrandColor); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const valid = HEX_RE.test(color);

  async function save() {
    if (!valid) return;
    setBusy(true); setError(null); setSaved(false);
    try {
      const d = await api.patch<Branding>("/super-admin/branding", { defaultBrandColor: color });
      setData(d);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <SuperAdminShell>
      <div className="fade-in max-w-3xl">
        <PageHeader eyebrow="Configuration" title="Branding Defaults" subtitle="The accent color a school's Admin console starts on — any school can still pick its own color from its own Settings, which always wins over this." />

        {error && <ErrorBanner className="mt-4">{error}</ErrorBanner>}

        {data && (
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="card flex items-center gap-3 p-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--border)]" style={{ background: data.defaultBrandColor }} />
              <div>
                <p className="text-sm font-bold">{data.defaultBrandColor.toUpperCase()}</p>
                <p className="text-xs text-[var(--muted)]">Current default</p>
              </div>
            </div>
            <div className="card flex items-center gap-3 p-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/5 text-[var(--muted)]"><Clock className="h-5 w-5" /></div>
              <div>
                <p className="text-sm font-bold">{data.updatedAt ? new Date(data.updatedAt).toLocaleDateString() : "Never changed"}</p>
                <p className="text-xs text-[var(--muted)]">{data.updatedBy ? `By ${data.updatedBy}` : "Built-in default"}</p>
              </div>
            </div>
          </div>
        )}

        {!isOwner ? (
          <p className="mt-6 text-sm text-[var(--muted)]">You're on the Support tier — only an Owner can change the platform default.</p>
        ) : (
          <div className="card mt-6 p-5">
            <div className="flex items-center gap-2">
              <Palette className="h-4 w-4 text-[var(--muted)]" />
              <p className="text-sm font-semibold">Choose a color</p>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <input
                type="color"
                value={valid ? color : "#c6ff34"}
                onChange={(e) => setColor(e.target.value)}
                className="h-11 w-14 shrink-0 cursor-pointer rounded-lg border border-[var(--border)] bg-transparent p-1"
              />
              <input
                className="input h-11 w-36 font-mono uppercase"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="#c6ff34"
                maxLength={7}
              />
              {!valid && <span className="text-xs text-rose-400">Enter a 6-digit hex color.</span>}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  onClick={() => setColor(p)}
                  title={p}
                  className="h-7 w-7 rounded-full border-2 transition"
                  style={{ background: p, borderColor: color.toLowerCase() === p.toLowerCase() ? "var(--fg)" : "transparent" }}
                />
              ))}
            </div>

            {valid && (
              <div className="mt-5 rounded-xl border border-[var(--border)] p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Preview</p>
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" className="rounded-lg px-4 py-2 text-sm font-semibold" style={{ background: color, color: perceivedLight(color) ? "#111110" : "#ffffff" }}>
                    Primary button
                  </button>
                  <span className="rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: `${color}26`, color }}>Badge</span>
                  <span className="text-sm font-medium" style={{ color }}>Link text</span>
                </div>
              </div>
            )}

            <div className="mt-5 flex items-center gap-3">
              <button onClick={save} disabled={busy || !valid} className="btn btn-primary disabled:opacity-50">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save default
              </button>
              {saved && <span className="text-xs font-medium text-emerald-400">Saved.</span>}
            </div>
          </div>
        )}
      </div>
    </SuperAdminShell>
  );
}

function perceivedLight(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  // Standard relative-luminance approximation, good enough for a UI-level light/dark ink decision.
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
}
