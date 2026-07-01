import { useEffect, useState } from "react";
import { Megaphone, AlertTriangle } from "lucide-react";
import { Shell } from "@/components/Shell";
import { Skeleton, EmptyState } from "@/components/ui";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { useT } from "@/lib/i18n";
import { clsx } from "clsx";

interface Ann { id: string; title: string; message: string; priority: string; sentAt: string; }
const fmt = (s: string) => new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
const CHIP: Record<string, string> = { urgent: "bg-rose-500/15 text-rose-400", high: "bg-amber-500/15 text-amber-400", normal: "bg-white/[0.06] text-[var(--muted)]" };

export function StudentAnnouncements() {
  const t = useT();
  const [anns, setAnns] = useState<Ann[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.get<{ announcements: Ann[] }>("/announcements").then((d) => setAnns(d.announcements)).catch((e) => setError(e.message)); }, []);

  return (
    <Shell>
      <div className="fade-in max-w-2xl">
        <PageHeader title={t("ann.title")} subtitle={t("ann.subtitle")} />

        {error && <p className="mt-6 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</p>}
        {!anns && !error && (
          <div className="mt-6 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="card p-5"><Skeleton className="h-4 w-1/3" /><Skeleton className="mt-3 h-3 w-full" /><Skeleton className="mt-2 h-3 w-2/3" /></div>
            ))}
          </div>
        )}

        {anns && anns.length === 0 && (
          <EmptyState
            className="mt-6"
            icon={Megaphone}
            title={t("ann.none")}
            hint={t("ann.noneHint")}
          />
        )}

        {anns && anns.length > 0 && (
          <div className="mt-6 space-y-3">
            {anns.map((a) => {
              const urgent = a.priority === "urgent" || a.priority === "high";
              return (
                <div key={a.id} className={clsx("card p-5", urgent && "ring-1 ring-amber-500/30")}>
                  <div className="flex items-center gap-2">
                    {urgent ? <AlertTriangle className="h-4 w-4 text-amber-400" /> : <Megaphone className="h-4 w-4 text-[#c6ff34]" />}
                    <p className="font-semibold">{a.title}</p>
                    <span className={clsx("rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize", CHIP[a.priority] ?? CHIP.normal)}>{t(`ann.${a.priority}`)}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-line text-sm text-[var(--fg)]">{a.message}</p>
                  <p className="mt-2 text-[11px] text-[var(--muted)]">{fmt(a.sentAt)}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Shell>
  );
}
