import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Dumbbell, Play, FileText, Clock } from "lucide-react";
import { Shell } from "@/components/Shell";
import { Skeleton, EmptyState } from "@/components/ui";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { useT } from "@/lib/i18n";

interface Item {
  exam: { id: string; title: string; code: string; description: string; durationMinutes: number; questionCount: number };
  registrationId: string;
  lastScore: number | null;
}

export function PracticeTests() {
  const t = useT();
  const navigate = useNavigate();
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);

  useEffect(() => { api.get<{ items: Item[] }>("/practice").then((d) => setItems(d.items)).catch((e) => setError(e.message)); }, []);

  async function start(registrationId: string) {
    setStarting(registrationId); setError(null);
    try {
      const r = await api.post<{ attempt: { id: string } }>("/attempts", { registrationId });
      navigate(`/attempts/${r.attempt.id}/session`);
    } catch (e) { setError((e as Error).message); setStarting(null); }
  }

  return (
    <Shell>
      <div className="fade-in">
        <PageHeader title={t("prac.title")} subtitle={t("prac.subtitle")} />

        {error && <p className="mt-6 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</p>}
        {!items && !error && (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="card p-5">
                <div className="flex items-center gap-2"><Skeleton className="h-9 w-9 rounded-xl" /><div className="flex-1"><Skeleton className="h-3.5 w-2/3" /><Skeleton className="mt-1.5 h-3 w-1/3" /></div></div>
                <Skeleton className="mt-3 h-3 w-full" />
                <Skeleton className="mt-4 h-9 w-full rounded-lg" />
              </div>
            ))}
          </div>
        )}

        {items && items.length === 0 && (
          <EmptyState
            className="mt-6"
            icon={Dumbbell}
            title={t("prac.none")}
            hint={t("prac.noneHint")}
          />
        )}

        {items && items.length > 0 && (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {items.map((it) => (
              <div key={it.exam.id} className="card flex flex-col p-5">
                <div className="flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#111110] text-white"><Dumbbell className="h-4 w-4" /></div>
                  <div>
                    <p className="text-sm font-semibold">{it.exam.title}</p>
                    <p className="text-xs text-[var(--muted)]">{it.exam.code}</p>
                  </div>
                </div>
                {it.exam.description && <p className="mt-3 line-clamp-2 text-sm text-[var(--muted)]">{it.exam.description}</p>}
                <div className="mt-3 flex items-center gap-3 text-xs text-[var(--muted)]">
                  <span className="inline-flex items-center gap-1"><FileText className="h-3.5 w-3.5" /> {t("prac.questions", { n: it.exam.questionCount })}</span>
                  <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {it.exam.durationMinutes} {t("exams.minutes")}</span>
                  {it.lastScore !== null && <span className="ml-auto font-semibold text-[var(--fg)]">{t("prac.last")}: {it.lastScore}%</span>}
                </div>
                <button onClick={() => start(it.registrationId)} disabled={starting === it.registrationId} className="btn btn-primary mt-4 disabled:opacity-50">
                  {starting === it.registrationId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  {it.lastScore !== null ? t("prac.retake") : t("prac.start")}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Shell>
  );
}
