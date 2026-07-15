import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  Users2, Plus, ArrowLeft, Trash2, UserPlus, CalendarPlus, X, Clock, BookOpen, Loader2, ArrowRight, Search, CheckCircle2,
  Upload, AlertTriangle, Download,
} from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton, EmptyState } from "@/components/ui";
import { api } from "@/lib/api";
import { useT, type TFn } from "@/lib/i18n";
import { useLearningStructure } from "@/lib/learningStructure";
import { IMPORT_ACCEPT, parseStudentFile } from "@/lib/importTable";
import { clsx } from "clsx";

const initials = (n: string) => n.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const fmt = (s: string | null, t: TFn) => (s ? new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : t("acls.noSetTime"));

const CLASS_COLORS = ["#fe3bed", "#c6ff34", "#ffffff"] as const;
const classColor = (id: string) => CLASS_COLORS[id.split("").reduce((h, c) => h + c.charCodeAt(0), 0) % CLASS_COLORS.length];

// ------------------------------------------------------------ List
interface ClassRow { id: string; name: string; code: string; description: string; members: number; assignments: number; academicYearId: string | null; academicYearName: string | null; }
interface CohortOption { id: string; name: string; }

export function AdminClasses() {
  const t = useT();
  // The Cohort/Academic Year concept a class can optionally belong to — same entity,
  // relabeled per Learning Structure mode (see ClassGroup.academicYearId). The class
  // itself keeps its own plain name/wording in every mode; only this parent link's
  // label changes.
  const { mode, academicYearLabel, cohortLabel } = useLearningStructure();
  const cohortConceptLabel = mode === "cohort" ? cohortLabel : academicYearLabel;
  const [rows, setRows] = useState<ClassRow[] | null>(null);
  const [cohorts, setCohorts] = useState<CohortOption[]>([]);
  const [cohortFilter, setCohortFilter] = useState("");
  const [create, setCreate] = useState(false);
  const load = () => api.get<{ classes: ClassRow[] }>("/admin/classes").then((d) => setRows(d.classes)).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  useEffect(() => { api.get<{ academicYears: CohortOption[] }>("/admin/institution").then((d) => setCohorts(d.academicYears)).catch(() => {}); }, []);

  const visibleRows = cohortFilter ? (rows ?? []).filter((c) => c.academicYearId === cohortFilter) : rows;

  return (
    <AdminShell wide>
      <div className="fade-in">
        <PageHeader title={t("acls.title")} subtitle={t("acls.subtitle")}
          actions={<button onClick={() => setCreate(true)} className="btn btn-on-teal"><Plus className="h-4 w-4" /> {t("acls.createClass")}</button>} />

        {cohorts.length > 0 && rows && rows.length > 0 && (
          <div className="mt-4 flex items-center gap-2">
            <span className="text-xs font-medium text-[var(--muted)]">{cohortConceptLabel}:</span>
            <select className="input h-9 w-auto text-sm" value={cohortFilter} onChange={(e) => setCohortFilter(e.target.value)}>
              <option value="">{t("acls.allCohorts", { label: cohortConceptLabel })}</option>
              {cohorts.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
            </select>
          </div>
        )}

        {!rows ? (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="card p-5">
                <div className="flex items-start justify-between"><Skeleton className="h-10 w-10 rounded-xl" /><Skeleton className="h-4 w-4" /></div>
                <Skeleton className="mt-3 h-4 w-3/4" />
                <Skeleton className="mt-2 h-3 w-1/3" />
                <div className="mt-4 flex gap-4 border-t border-[var(--border)] pt-3"><Skeleton className="h-3 w-20" /><Skeleton className="h-3 w-16" /></div>
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            className="mt-6"
            icon={Users2}
            title={t("acls.noClasses")}
            hint={t("acls.noClassesHint")}
            action={<button onClick={() => setCreate(true)} className="btn btn-primary"><Plus className="h-4 w-4" /> {t("acls.createClass")}</button>}
          />
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleRows!.map((c) => {
              const color = classColor(c.id);
              return (
                <Link key={c.id} to={`/admin/classes/${c.id}`}
                  className="rounded-2xl p-5 transition hover:scale-[1.01] hover:shadow-lg"
                  style={{ background: "var(--card)", border: `1.5px solid ${color}` }}>
                  <div className="flex items-start justify-between">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl"
                      style={{ background: color }}>
                      <Users2 className="h-5 w-5" style={{ color: "#111110" }} />
                    </div>
                    <ArrowRight className="h-4 w-4" style={{ color }} />
                  </div>
                  <h3 className="mt-3 font-semibold leading-snug">{c.name}</h3>
                  {c.code && <p className="text-xs text-[var(--muted)]">{c.code}</p>}
                  {c.academicYearName && <p className="mt-0.5 text-[11px] text-[var(--muted)]">{cohortConceptLabel}: {c.academicYearName}</p>}
                  <div className="mt-4 flex items-center gap-4 border-t pt-3 text-xs text-[var(--muted)]"
                    style={{ borderColor: `${color}33` }}>
                    <span className="inline-flex items-center gap-1"><Users2 className="h-3.5 w-3.5" style={{ color }} /> {t("adash.nStudents", { n: c.members })}</span>
                    <span className="inline-flex items-center gap-1"><BookOpen className="h-3.5 w-3.5" style={{ color }} /> {t("acls.nExams", { n: c.assignments })}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
      {create && <CreateModal cohorts={cohorts} cohortConceptLabel={cohortConceptLabel} onClose={() => setCreate(false)} onCreated={() => { setCreate(false); load(); }} />}
    </AdminShell>
  );
}

function CreateModal({ cohorts, cohortConceptLabel, onClose, onCreated }: { cohorts: CohortOption[]; cohortConceptLabel: string; onClose: () => void; onCreated: () => void }) {
  const t = useT();
  const [name, setName] = useState(""); const [code, setCode] = useState(""); const [description, setDescription] = useState("");
  const [academicYearId, setAcademicYearId] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  async function save() {
    if (!name.trim()) { setErr(t("acls.errName")); return; }
    setBusy(true);
    try { await api.post("/admin/classes", { name, code, description, academicYearId: academicYearId || null }); onCreated(); } catch (e) { setErr((e as Error).message); setBusy(false); }
  }
  return (
    <Modal title={t("acls.createClass")} onClose={onClose}>
      <div className="mt-4 space-y-3">
        <Field label={t("acls.className")}><input className="input h-10" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. CS Year 1 — Section A" /></Field>
        <Field label={t("acls.codeOptional")}><input className="input h-10" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. CS1-A" /></Field>
        <Field label={t("acls.descOptional")}><input className="input h-10" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        {cohorts.length > 0 && (
          <Field label={t("acls.cohortOptional", { label: cohortConceptLabel })}>
            <select className="input h-10" value={academicYearId} onChange={(e) => setAcademicYearId(e.target.value)}>
              <option value="">{t("acls.noCohort")}</option>
              {cohorts.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
            </select>
          </Field>
        )}
        {err && <p className="text-sm text-rose-500">{err}</p>}
      </div>
      <ModalActions onClose={onClose}><button onClick={save} disabled={busy} className="btn btn-primary disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {t("acls.create")}</button></ModalActions>
    </Modal>
  );
}

// ------------------------------------------------------------ Detail
interface Member { id: string; name: string; email: string; studentClass: string | null; }
interface Assignment {
  examId: string; examTitle: string; scheduledStart: string | null; assignedAt: string;
  memberCount: number; submitted: number; avgScore: number | null; passRate: number | null;
}
interface Detail { class: { id: string; name: string; code: string; description: string; academicYearId: string | null; academicYearName: string | null }; members: Member[]; assignments: Assignment[]; }

export function ClassDetail() {
  const t = useT();
  const { mode, academicYearLabel, cohortLabel } = useLearningStructure();
  const cohortConceptLabel = mode === "cohort" ? cohortLabel : academicYearLabel;
  const { id } = useParams();
  const navigate = useNavigate();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [delClass, setDelClass] = useState(false);

  const load = () => api.get<Detail>(`/admin/classes/${id}`).then(setD).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [id]);

  async function removeMember(cid: string) { await api.del(`/admin/classes/${id}/members/${cid}`); load(); }

  if (error) return <AdminShell wide><p className="text-sm text-rose-500">{error}</p></AdminShell>;
  if (!d) return (
    <AdminShell wide>
      <div className="max-w-4xl">
        <Skeleton className="h-4 w-20" />
        <div className="card mt-4 flex items-center gap-3 p-6"><Skeleton className="h-12 w-12 rounded-xl" /><div className="flex-1"><Skeleton className="h-5 w-48" /><Skeleton className="mt-2 h-3 w-32" /></div></div>
        <Skeleton className="mt-5 h-4 w-24" />
        <div className="card mt-3 divide-y divide-[var(--border)]">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2.5 px-4 py-2.5"><Skeleton className="h-8 w-8 rounded-full" /><div className="flex-1"><Skeleton className="h-3.5 w-32" /><Skeleton className="mt-1.5 h-3 w-40" /></div></div>
          ))}
        </div>
      </div>
    </AdminShell>
  );

  return (
    <AdminShell wide>
      <div className="fade-in max-w-4xl">
        <Link to="/admin/classes" className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--fg)]"><ArrowLeft className="h-4 w-4" /> {t("acls.title")}</Link>

        <div className="card mt-4 flex items-center justify-between p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#111110] text-white"><Users2 className="h-6 w-6" /></div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">{d.class.name}</h1>
              <p className="text-sm text-[var(--muted)]">{d.class.code || t("acls.noCode")} · {t("adash.nStudents", { n: d.members.length })}</p>
              {d.class.academicYearName && (
                <p className="mt-0.5 text-xs text-[var(--muted)]">{cohortConceptLabel}: <span className="font-medium text-[var(--fg)]">{d.class.academicYearName}</span></p>
              )}
            </div>
          </div>
          <button onClick={() => setDelClass(true)} title={t("acls.deleteClassTitle")} className="rounded-lg p-2 text-[var(--muted)] hover:bg-rose-500/10 hover:text-rose-400"><Trash2 className="h-4 w-4" /></button>
        </div>

        {/* Members */}
        <div className="mt-5 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t("acls.members")}</h2>
          <div className="flex gap-2">
            <button onClick={() => setImportOpen(true)} className="btn btn-outline h-9"><Upload className="h-4 w-4" /> {t("acls.importRoster")}</button>
            <button onClick={() => setAddOpen(true)} className="btn btn-outline h-9"><UserPlus className="h-4 w-4" /> {t("acls.addStudents")}</button>
          </div>
        </div>
        <div className="card mt-3 overflow-hidden">
          {d.members.length === 0 ? (
            <p className="p-6 text-center text-sm text-[var(--muted)]">{t("acls.noMembers")}</p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {d.members.map((m) => (
                <li key={m.id} className="flex items-center justify-between px-4 py-2.5">
                  <Link to={`/admin/students/${m.id}`} className="flex items-center gap-2.5 hover:text-[#c6ff34]">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#111110] text-[11px] font-bold text-white">{initials(m.name)}</span>
                    <span><span className="block text-sm font-medium">{m.name}</span><span className="block text-xs text-[var(--muted)]">{m.email}</span></span>
                  </Link>
                  <button onClick={() => removeMember(m.id)} className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-white/[0.06] hover:text-rose-400"><X className="h-4 w-4" /></button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Assigned exams */}
        <div className="mt-6 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t("acls.scheduledExams")}</h2>
          <button onClick={() => setAssignOpen(true)} className="btn btn-primary h-9"><CalendarPlus className="h-4 w-4" /> {t("acls.assignExam")}</button>
        </div>
        <div className="card mt-3 overflow-hidden">
          {d.assignments.length === 0 ? (
            <p className="p-6 text-center text-sm text-[var(--muted)]">{t("acls.noAssignments")}</p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {d.assignments.map((a, i) => {
                const color = classColor(id!);
                return (
                  <li key={i} className="flex items-start justify-between gap-3 px-4 py-3">
                    <div className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: `${color}18` }}>
                        <BookOpen className="h-4 w-4" style={{ color }} />
                      </span>
                      <div>
                        <p className="text-sm font-medium">{a.examTitle}</p>
                        <p className="flex items-center gap-1 text-xs text-[var(--muted)]"><Clock className="h-3 w-3" /> {fmt(a.scheduledStart, t)}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-[var(--muted)]">
                          <span>{a.submitted}/{a.memberCount} submitted</span>
                          {a.avgScore !== null && <span className="font-semibold" style={{ color }}>avg {a.avgScore}%</span>}
                          {a.passRate !== null && (
                            <span className={a.passRate >= 50 ? "text-emerald-400" : "text-rose-400"}>{a.passRate}% pass</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <Link to={`/admin/results?exam=${a.examId}`}
                      className="mt-1 shrink-0 rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--fg)]">
                      Results →
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {addOpen && <AddMembersModal classId={id!} existing={d.members.map((m) => m.id)} onClose={() => setAddOpen(false)} onDone={() => { setAddOpen(false); load(); }} />}
      {importOpen && <ImportRosterModal classId={id!} currentMembers={d.members} onClose={() => setImportOpen(false)} onDone={() => { setImportOpen(false); load(); }} />}
      {assignOpen && <AssignExamModal classId={id!} memberCount={d.members.length} onClose={() => setAssignOpen(false)} onDone={() => { setAssignOpen(false); load(); }} />}
      {delClass && <Modal title={t("acls.deleteClassQ")} onClose={() => setDelClass(false)}>
        <p className="mt-3 text-sm text-[var(--muted)]">{t("acls.deleteClassWarn", { name: d.class.name })}</p>
        <ModalActions onClose={() => setDelClass(false)}><button onClick={async () => { await api.del(`/admin/classes/${id}`); navigate("/admin/classes"); }} className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-700"><Trash2 className="h-4 w-4" /> {t("acls.delete")}</button></ModalActions>
      </Modal>}
    </AdminShell>
  );
}

function AddMembersModal({ classId, existing, onClose, onDone }: { classId: string; existing: string[]; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [students, setStudents] = useState<{ id: string; name: string; email: string }[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get<{ candidates: { id: string; name: string; email: string }[] }>("/admin/candidates").then((d) => setStudents(d.candidates)).catch(() => {}); }, []);
  const available = useMemo(() => students.filter((s) => !existing.includes(s.id) && (s.name.toLowerCase().includes(q.toLowerCase()) || s.email.toLowerCase().includes(q.toLowerCase()))), [students, existing, q]);
  async function add() {
    setBusy(true);
    try { await api.post(`/admin/classes/${classId}/members`, { candidateIds: [...sel] }); onDone(); } catch { setBusy(false); }
  }
  return (
    <Modal title={t("acls.addStudents")} onClose={onClose}>
      <div className="mt-3 flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3"><Search className="h-4 w-4 text-[var(--muted)]" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("acls.searchShort")} className="h-9 flex-1 bg-transparent text-sm outline-none" /></div>
      <div className="mt-3 max-h-72 space-y-1 overflow-y-auto">
        {available.length === 0 ? <p className="py-6 text-center text-sm text-[var(--muted)]">{t("acls.noMoreStudents")}</p> : available.map((s) => (
          <label key={s.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-white/[0.04]">
            <input type="checkbox" checked={sel.has(s.id)} onChange={(e) => { const n = new Set(sel); e.target.checked ? n.add(s.id) : n.delete(s.id); setSel(n); }} />
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#111110] text-[10px] font-bold text-white">{initials(s.name)}</span>
            <span><span className="block text-sm">{s.name}</span><span className="block text-xs text-[var(--muted)]">{s.email}</span></span>
          </label>
        ))}
      </div>
      <ModalActions onClose={onClose}><button onClick={add} disabled={busy || sel.size === 0} className="btn btn-primary disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} {t("acls.add")} {sel.size || ""}</button></ModalActions>
    </Modal>
  );
}

interface RosterSyncResult {
  created: { name: string; email: string }[];
  addedExisting: number;
  removed: { id: string; name: string; email: string }[];
  skipped: { email: string; reason: string }[];
  memberCount: number;
}

/**
 * Import a student list into this class's roster. Unlike the plain "Add
 * students" picker, this is an ongoing sync: re-uploading a roster later adds
 * anyone new and removes anyone no longer listed. Because removal is real
 * (it edits this class's membership), the "will be removed" set is previewed
 * client-side — by comparing the parsed file's emails against the class's
 * current members — before the admin commits, so a stale/wrong file doesn't
 * silently drop real students.
 */
function ImportRosterModal({ classId, currentMembers, onClose, onDone }: {
  classId: string; currentMembers: Member[]; onClose: () => void; onDone: () => void;
}) {
  const t = useT();
  const [rows, setRows] = useState<{ name?: string; email?: string }[] | null>(null);
  const [result, setResult] = useState<RosterSyncResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    try {
      const parsed = await parseStudentFile(f);
      if (!parsed.length) { setErr(t("acan.errNoRows")); return; }
      setRows(parsed); setErr(null); setResult(null);
    } catch { setErr(t("acan.errReadFile")); }
  };

  const willRemove = useMemo(() => {
    if (!rows) return [];
    const fileEmails = new Set(rows.map((r) => (r.email ?? "").trim().toLowerCase()).filter(Boolean));
    return currentMembers.filter((m) => !fileEmails.has(m.email.toLowerCase()));
  }, [rows, currentMembers]);

  const submit = async () => {
    if (!rows) return;
    setBusy(true); setErr(null);
    try { setResult(await api.post<RosterSyncResult>(`/admin/classes/${classId}/import`, { rows })); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Modal title={t("acls.importRoster")} onClose={onClose}>
      {!result ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-[var(--muted)]">{t("acls.importRosterDesc")}</p>
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-[var(--border)] p-6 text-center hover:bg-[var(--card-2)]">
            <Upload className="h-6 w-6 text-[var(--muted)]" />
            <span className="text-sm font-medium">{rows ? t("acan.readyToImport", { n: rows.length }) : t("acan.chooseFile")}</span>
            <span className="text-xs text-[var(--muted)]">{t("acan.colsHint")}</span>
            <input type="file" accept={IMPORT_ACCEPT} className="hidden" onChange={onFile} />
          </label>
          {rows && willRemove.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-500">
              <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {t("acls.willRemoveN", { n: willRemove.length })}</p>
              <ul className="mt-1.5 max-h-28 space-y-0.5 overflow-y-auto">
                {willRemove.map((m) => <li key={m.id}>{m.name} — {m.email}</li>)}
              </ul>
            </div>
          )}
          {err && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">{err}</p>}
          <div className="mt-2 flex items-center justify-between gap-2">
            <a href="/templates/Student-Import-Template.xlsx" download className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--muted)] hover:text-[var(--fg)]" title="Download the student import template (.xlsx)">
              <Download className="h-3.5 w-3.5" /> Download template
            </a>
            <div className="flex gap-2">
              <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--fg)]">{t("acan.cancel")}</button>
              <button onClick={submit} disabled={busy || !rows} className="btn btn-primary disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} {t("acls.importAndSync")}</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-400">
            <CheckCircle2 className="h-4 w-4 shrink-0" /> {t("acls.syncSummary", { created: result.created.length, existing: result.addedExisting, removed: result.removed.length })}
          </div>
          {result.removed.length > 0 && (
            <div className="rounded-lg border border-[var(--border)] p-3">
              <p className="text-xs font-semibold text-[var(--muted)]">{t("acls.removedN", { n: result.removed.length })}</p>
              <ul className="mt-1.5 max-h-32 space-y-1 overflow-y-auto text-xs text-[var(--muted)]">
                {result.removed.map((m) => <li key={m.id}>{m.name} — {m.email}</li>)}
              </ul>
            </div>
          )}
          {result.skipped.length > 0 && (
            <div className="rounded-lg border border-[var(--border)] p-3">
              <p className="text-xs font-semibold text-[var(--muted)]">{t("acan.skippedN", { n: result.skipped.length })}</p>
              <ul className="mt-1.5 max-h-32 space-y-1 overflow-y-auto text-xs text-[var(--muted)]">
                {result.skipped.map((s, i) => <li key={i} className="flex items-center gap-1.5"><AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" /> {s.email} — {s.reason}</li>)}
              </ul>
            </div>
          )}
          <div className="flex justify-end">
            <button onClick={() => { onDone(); onClose(); }} className="btn btn-primary">{t("acan.done")}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function AssignExamModal({ classId, memberCount, onClose, onDone }: { classId: string; memberCount: number; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [exams, setExams] = useState<{ id: string; title: string }[]>([]);
  const [examId, setExamId] = useState(""); const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { api.get<{ items: { exam: { id: string; title: string } }[] }>("/admin/exams").then((d) => { const xs = d.items.map((i) => i.exam); setExams(xs); if (xs[0]) setExamId(xs[0].id); }).catch(() => {}); }, []);
  async function assign() {
    if (memberCount === 0) { setErr(t("acls.errAddFirst")); return; }
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{ assigned: number }>(`/admin/classes/${classId}/assign-exam`, { examId, scheduledStart: when ? new Date(when).toISOString() : null });
      setMsg(t("acls.scheduledN", { n: r.assigned }));
      setTimeout(onDone, 800);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }
  return (
    <Modal title={t("acls.assignToClassTitle")} onClose={onClose}>
      <p className="mt-2 text-sm text-[var(--muted)]">{t("acls.assignDesc")}</p>
      <div className="mt-3 space-y-3">
        <Field label={t("acls.exam")}><select className="input h-10" value={examId} onChange={(e) => setExamId(e.target.value)}>{exams.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select></Field>
        <Field label={t("acls.scheduledStartLabel")}><input type="datetime-local" className="input h-10" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
        {err && <p className="text-sm text-rose-500">{err}</p>}
        {msg && <p className="inline-flex items-center gap-1.5 text-sm text-emerald-500"><CheckCircle2 className="h-4 w-4" /> {msg}</p>}
      </div>
      <ModalActions onClose={onClose}><button onClick={assign} disabled={busy || !examId} className="btn btn-primary disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4" />} {t("acls.assignSchedule")}</button></ModalActions>
    </Modal>
  );
}

// ---- shared modal bits ----
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h2 className="text-lg font-bold">{title}</h2><button onClick={onClose} className="rounded-lg p-1 text-[var(--muted)] hover:bg-white/[0.05]"><X className="h-5 w-5" /></button></div>
        {children}
      </div>
    </div>
  );
}
function ModalActions({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const t = useT();
  return <div className="mt-5 flex justify-end gap-2"><button onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--fg)]">{t("acls.cancel")}</button>{children}</div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-sm font-medium">{label}</span>{children}</label>;
}
