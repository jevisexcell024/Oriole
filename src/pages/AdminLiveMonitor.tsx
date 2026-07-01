import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Radio, Loader2, AlertTriangle, ShieldCheck, Clock, Pause, Play, MessageSquare, Ban, Send, X, ExternalLink } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { PageHeader } from "@/components/PageHeader";
import { api } from "@/lib/api";
import type { ProctorEvent } from "@shared/types";
import { clsx } from "clsx";

interface Session {
  attemptId: string; candidateName: string; examTitle: string;
  startedAt: string; durationMinutes: number;
  flagCount: number; integrity: number; answeredCount: number; questionCount: number;
  recentEvents: ProctorEvent[];
  snapshot: string | null;
  paused: boolean;
}

function remaining(startedAt: string, durationMinutes: number) {
  const end = new Date(startedAt).getTime() + durationMinutes * 60000;
  const s = Math.max(0, Math.floor((end - Date.now()) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function AdminLiveMonitor() {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [, setTick] = useState(0);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [sort, setSort] = useState<"recent" | "integrity" | "flags">("recent");
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const load = () => api.get<{ sessions: Session[] }>("/admin/live").then((d) => setSessions(d.sessions)).catch(() => {});
    load();
    const poll = setInterval(load, 4000);     // refresh data every 4s
    const clock = setInterval(() => setTick((t) => t + 1), 1000); // tick countdowns
    return () => { clearInterval(poll); clearInterval(clock); };
  }, []);

  const view = useMemo(() => {
    let list = sessions ?? [];
    if (flaggedOnly) list = list.filter((s) => s.flagCount > 0);
    const sorted = [...list];
    if (sort === "integrity") sorted.sort((a, b) => a.integrity - b.integrity);
    else if (sort === "flags") sorted.sort((a, b) => b.flagCount - a.flagCount);
    else sorted.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return sorted;
  }, [sessions, flaggedOnly, sort]);

  return (
    <AdminShell wide>
      <div className="fade-in">
        <PageHeader title="Live Monitor" subtitle="In-progress proctored sessions, refreshed automatically."
          actions={<span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold text-white"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400" /> LIVE</span>} />

        {!sessions && <div className="mt-10 flex items-center gap-2 text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}

        {sessions && sessions.length === 0 && (
          <div className="card mt-6 flex flex-col items-center gap-2 p-12 text-center">
            <Radio className="h-8 w-8 text-[var(--muted)]" />
            <p className="text-sm font-medium">No active sessions</p>
            <p className="text-xs text-[var(--muted)]">When a candidate starts an exam, their session appears here in real time.</p>
          </div>
        )}

        {sessions && sessions.length > 0 && (
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <button onClick={() => setFlaggedOnly((v) => !v)} className={clsx("inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition", flaggedOnly ? "border-[#c6ff34] bg-[rgba(198,255,52,0.1)] text-[#c6ff34]" : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--fg)]")}>
              <AlertTriangle className="h-4 w-4" /> Flagged only
            </button>
            <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="input h-10 w-auto">
              <option value="recent">Most recent</option>
              <option value="integrity">Lowest integrity</option>
              <option value="flags">Most flags</option>
            </select>
            <span className="ml-auto text-xs text-[var(--muted)]">{view.length} of {sessions.length} sessions</span>
          </div>
        )}

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {view.map((s) => (
            <div key={s.attemptId} onClick={() => setActive(s.attemptId)}
              className={clsx("card cursor-pointer overflow-hidden transition hover:-translate-y-0.5 hover:shadow-lg", s.paused ? "ring-1 ring-sky-400" : s.flagCount > 0 && "ring-1 ring-amber-300")}>
              <div className="relative aspect-video bg-black">
                {s.snapshot ? (
                  <img src={s.snapshot} alt={s.candidateName} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-white/50">Awaiting camera…</div>
                )}
                <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 text-xs font-bold tabular-nums text-white">
                  <Clock className="h-3 w-3" /> {remaining(s.startedAt, s.durationMinutes)}
                </span>
                <span className={clsx("absolute left-2 top-2 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-white", s.paused ? "bg-sky-500/90" : "bg-rose-500/90")}>
                  {s.paused ? <><Pause className="h-2.5 w-2.5" /> PAUSED</> : <><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--card)]" /> LIVE</>}
                </span>
              </div>
              <div className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold leading-tight">{s.candidateName}</p>
                  <p className="text-xs text-[var(--muted)]">{s.examTitle}</p>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between text-xs">
                <span className="text-[var(--muted)]">Progress</span>
                <span className="font-medium">{s.answeredCount}/{s.questionCount}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--border)]">
                <span className="block h-full rounded-full bg-brand-500" style={{ width: `${s.questionCount ? (s.answeredCount / s.questionCount) * 100 : 0}%` }} />
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-[var(--border)] pt-3 text-xs">
                {s.flagCount > 0 ? (
                  <span className="inline-flex items-center gap-1.5 font-semibold text-amber-400"><AlertTriangle className="h-4 w-4" /> {s.flagCount} flag{s.flagCount === 1 ? "" : "s"}</span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 font-medium text-emerald-400"><ShieldCheck className="h-4 w-4" /> Clean</span>
                )}
                <span className={clsx("font-semibold tabular-nums", s.integrity >= 80 ? "text-emerald-400" : s.integrity >= 60 ? "text-amber-400" : "text-rose-400")}>
                  Integrity {s.integrity}
                </span>
              </div>

              {s.recentEvents.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {s.recentEvents.map((e) => (
                    <li key={e.id} className="truncate text-[11px] text-[var(--muted)]">
                      • <span className="capitalize">{e.type.replace(/_/g, " ")}</span> — {new Date(e.at).toLocaleTimeString()}
                    </li>
                  ))}
                </ul>
              )}
              </div>
            </div>
          ))}
        </div>

        {active && <InterveneDrawer attemptId={active} onClose={() => setActive(null)} />}
      </div>
    </AdminShell>
  );
}

interface LiveDetail {
  attemptId: string; candidateName: string; examTitle: string; status: string;
  paused: boolean; terminated: boolean; messages: { id: string; text: string; at: string }[];
  events: ProctorEvent[]; snapshots: { id: string; dataUrl: string; at: string }[];
  integrity: number; flagCount: number; answeredCount: number; questionCount: number;
}

function InterveneDrawer({ attemptId, onClose }: { attemptId: string; onClose: () => void }) {
  const [d, setD] = useState<LiveDetail | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const liveRef = useRef(true);

  const load = () => api.get<LiveDetail>(`/admin/attempts/${attemptId}/live`).then((r) => { if (liveRef.current) setD(r); }).catch(() => {});
  useEffect(() => {
    liveRef.current = true;
    load();
    const poll = setInterval(load, 3000);
    return () => { liveRef.current = false; clearInterval(poll); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId]);

  const sendMessage = async () => {
    if (!msg.trim()) return;
    setBusy("msg");
    try { await api.post(`/admin/attempts/${attemptId}/message`, { text: msg.trim() }); setMsg(""); setSent(true); setTimeout(() => setSent(false), 2000); load(); }
    catch (e) { alert((e as Error).message); }
    finally { setBusy(null); }
  };
  const togglePause = async () => {
    setBusy("pause");
    try { await api.post(`/admin/attempts/${attemptId}/pause`, { paused: !d?.paused }); load(); }
    catch (e) { alert((e as Error).message); }
    finally { setBusy(null); }
  };
  const terminate = async () => {
    const reason = window.prompt("Reason for terminating this attempt? (the candidate's exam will be submitted immediately)");
    if (reason === null) return;
    setBusy("term");
    try { await api.post(`/admin/attempts/${attemptId}/terminate`, { reason }); onClose(); }
    catch (e) { alert((e as Error).message); }
    finally { setBusy(null); }
  };

  const flaggedSnap = (at: string) => (d?.events ?? []).some((e) => e.severity !== "info" && Math.abs(new Date(e.at).getTime() - new Date(at).getTime()) < 16000);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div className="flex h-full w-full max-w-md flex-col border-l border-[var(--border)] bg-[var(--card)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold">{d?.candidateName ?? "Loading…"}</h2>
            <p className="truncate text-xs text-[var(--muted)]">{d?.examTitle}</p>
          </div>
          <div className="flex items-center gap-1">
            <Link to={`/admin/attempts/${attemptId}`} title="Full review" className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--card-2)] hover:text-[var(--fg)]"><ExternalLink className="h-4 w-4" /></Link>
            <button onClick={onClose} className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--card-2)] hover:text-[var(--fg)]"><X className="h-4 w-4" /></button>
          </div>
        </div>

        {!d ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : d.terminated || d.status === "submitted" ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-[var(--muted)]"><Ban className="h-7 w-7" /> This attempt has ended.</div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            {/* Live snapshot */}
            <div className="relative aspect-video bg-black">
              {d.snapshots.length > 0 ? <img src={d.snapshots[d.snapshots.length - 1].dataUrl} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-xs text-white/50">Awaiting camera…</div>}
              {d.paused && <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-sky-500/90 px-1.5 py-0.5 text-[10px] font-semibold text-white"><Pause className="h-2.5 w-2.5" /> PAUSED</span>}
            </div>
            <div className="flex items-center justify-between px-5 py-3 text-xs">
              <span>Progress <span className="font-semibold">{d.answeredCount}/{d.questionCount}</span></span>
              <span>{d.flagCount > 0 ? <span className="font-semibold text-amber-400">{d.flagCount} flag{d.flagCount === 1 ? "" : "s"}</span> : <span className="text-emerald-400">Clean</span>}</span>
              <span className={clsx("font-semibold", d.integrity >= 80 ? "text-emerald-400" : d.integrity >= 60 ? "text-amber-400" : "text-rose-400")}>Integrity {d.integrity}</span>
            </div>

            {/* Recording timeline (snapshot strip with flagged moments) */}
            <div className="border-t border-[var(--border)] px-5 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Recording timeline</p>
              {d.snapshots.length === 0 ? <p className="mt-1 text-xs text-[var(--muted)]">No frames captured yet.</p> : (
                <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
                  {d.snapshots.map((s) => (
                    <figure key={s.id} className={clsx("shrink-0 rounded-md p-0.5", flaggedSnap(s.at) ? "bg-rose-500/30 ring-1 ring-rose-500" : "")} title={flaggedSnap(s.at) ? "Flagged moment" : new Date(s.at).toLocaleTimeString()}>
                      <img src={s.dataUrl} alt="" className="h-12 w-16 rounded object-cover" />
                      <figcaption className="mt-0.5 text-center text-[9px] text-[var(--muted)]">{new Date(s.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</figcaption>
                    </figure>
                  ))}
                </div>
              )}
            </div>

            {/* Flagged events */}
            {d.events.length > 0 && (
              <div className="border-t border-[var(--border)] px-5 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Flagged moments</p>
                <ul className="mt-2 space-y-1">
                  {d.events.filter((e) => e.severity !== "info").slice(0, 8).map((e) => (
                    <li key={e.id} className="flex items-center justify-between text-xs">
                      <span className={clsx("inline-flex items-center gap-1.5", e.severity === "high" ? "text-rose-400" : "text-amber-400")}><AlertTriangle className="h-3 w-3" /> <span className="capitalize">{e.type.replace(/_/g, " ")}</span></span>
                      <span className="text-[var(--muted)]">{new Date(e.at).toLocaleTimeString()}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Sent messages */}
            {d.messages.length > 0 && (
              <div className="border-t border-[var(--border)] px-5 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Messages sent</p>
                <ul className="mt-2 space-y-1.5">
                  {d.messages.map((m) => <li key={m.id} className="rounded-lg bg-[var(--card-2)] px-2.5 py-1.5 text-xs">{m.text} <span className="text-[var(--muted)]">· {new Date(m.at).toLocaleTimeString()}</span></li>)}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Intervene controls */}
        {d && !d.terminated && d.status === "in_progress" && (
          <div className="border-t border-[var(--border)] p-4">
            <div className="flex items-center gap-2">
              <input value={msg} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") sendMessage(); }} placeholder="Message the candidate…" className="input h-9 flex-1 text-sm" />
              <button onClick={sendMessage} disabled={!msg.trim() || busy === "msg"} className="btn btn-primary h-9 disabled:opacity-50">{busy === "msg" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</button>
            </div>
            {sent && <p className="mt-1 text-[11px] text-emerald-400"><MessageSquare className="mr-1 inline h-3 w-3" /> Message delivered.</p>}
            <div className="mt-3 flex gap-2">
              <button onClick={togglePause} disabled={busy === "pause"} className="btn btn-outline h-9 flex-1 disabled:opacity-50">
                {busy === "pause" ? <Loader2 className="h-4 w-4 animate-spin" /> : d.paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />} {d.paused ? "Resume" : "Pause"}
              </button>
              <button onClick={terminate} disabled={busy === "term"} className="btn h-9 flex-1 bg-rose-500/15 text-rose-400 hover:bg-rose-500/25 disabled:opacity-50">
                {busy === "term" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />} Terminate
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
