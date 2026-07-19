import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  Users, Loader2, Search, Plus, Download, Upload, Phone, Mail, MoreHorizontal, X, Pencil, Trash2, BookPlus,
  ChevronLeft, ChevronRight, AlertTriangle, CheckCircle2, Send,
} from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { PageHeader } from "@/components/PageHeader";
import { TableSkeleton, EmptyState, Modal, ErrorBanner } from "@/components/ui";
import { api } from "@/lib/api";
import { IMPORT_ACCEPT, parseStudentFile, type ImportRow } from "@/lib/importTable";
import { useT } from "@/lib/i18n";
import { initials } from "@/lib/format";
import { clsx } from "clsx";

interface Student {
  id: string; name: string; email: string; gender: string | null; age: number | null; studentClass: string | null;
  phone: string | null; avgScore: number | null; missingDays: number; enrollments: number; completed: number;
}
interface ExamOpt { id: string; title: string }

const PAGE = 10;
const gradeTone = (n: number | null) => (n === null ? "text-[var(--muted)]" : n >= 80 ? "text-[#22C55E]" : n >= 60 ? "text-[#eab308]" : "text-[#EF4444]");

export function AdminCandidates() {
  const t = useT();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Student[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [genderFilter, setGenderFilter] = useState("");
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<Set<string>>(new Set());
  // Row action menu: rendered in a portal with fixed coords so the table's
  // scroll container can't clip it (caused the cut-off menu).
  const [menu, setMenu] = useState<{ id: string; top: number; left: number } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Student | null>(null);
  const [assigning, setAssigning] = useState<Student | null>(null);
  const [deleting, setDeleting] = useState<Student | null>(null);
  const [resending, setResending] = useState<Student | null>(null);

  const load = () => api.get<{ students: Student[] }>("/admin/students").then((d) => setRows(d.students)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const classes = useMemo(() => [...new Set((rows ?? []).map((r) => r.studentClass).filter(Boolean))] as string[], [rows]);
  const filtered = useMemo(() => {
    let list = rows ?? [];
    const term = q.trim().toLowerCase();
    if (term) list = list.filter((r) => r.name.toLowerCase().includes(term) || r.email.toLowerCase().includes(term));
    if (classFilter) list = list.filter((r) => r.studentClass === classFilter);
    if (genderFilter) list = list.filter((r) => r.gender === genderFilter);
    return list;
  }, [rows, q, classFilter, genderFilter]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const pageRows = filtered.slice((page - 1) * PAGE, page * PAGE);
  useEffect(() => { setPage(1); }, [q, classFilter, genderFilter]);

  function downloadCsv(list: Student[], name: string) {
    const header = ["ID", "Name", "Email", "Gender", "Age", "Class", "AvgGrade", "MissingDays"];
    const esc = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = list.map((r) => [r.id, r.name, r.email, r.gender ?? "", r.age ?? "", r.studentClass ?? "", r.avgScore ?? "", r.missingDays].map(esc).join(","));
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `${name}.csv`; a.click(); URL.revokeObjectURL(url);
  }
  const exportCsv = () => downloadCsv(filtered, "students");
  const exportSelected = () => downloadCsv((rows ?? []).filter((r) => sel.has(r.id)), "students-selected");

  return (
    <AdminShell wide>
      <div className="fade-in" onClick={() => setMenu(null)}>
        <PageHeader title={t("acan.title")} subtitle={t("acan.total", { n: rows?.length ?? "…" })}
          actions={<>
            <button onClick={() => setImportOpen(true)} className="btn btn-ghost-teal"><Upload className="h-4 w-4" /> {t("acan.import")}</button>
            <button onClick={exportCsv} className="btn btn-ghost-teal"><Download className="h-4 w-4" /> {t("acan.exportData")}</button>
            <button onClick={() => setAddOpen(true)} className="btn btn-on-teal"><Plus className="h-4 w-4" /> {t("acan.addStudent")}</button>
          </>} />

        {/* Toolbar */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <div className="flex min-w-[240px] flex-1 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3">
            <Search className="h-4 w-4 text-[var(--muted)]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("acan.searchStudents")} className="h-10 flex-1 bg-transparent text-sm outline-none" />
          </div>
          <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)} className="input h-10 w-auto">
            <option value="">{t("acan.allClasses")}</option>
            {classes.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={genderFilter} onChange={(e) => setGenderFilter(e.target.value)} className="input h-10 w-auto">
            <option value="">{t("acan.anyGender")}</option>
            <option value="Male">{t("acan.male")}</option><option value="Female">{t("acan.female")}</option><option value="Other">{t("acan.other")}</option>
          </select>
          {(q || classFilter || genderFilter) && <button onClick={() => { setQ(""); setClassFilter(""); setGenderFilter(""); }} className="text-xs text-[var(--muted)] hover:text-[var(--fg)]">{t("acan.clear")}</button>}
        </div>

        {sel.size > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-[#c6ff34]/40 bg-[rgba(198,255,52,0.08)] px-3 py-2 text-sm">
            <span className="font-semibold">{t("acan.selected", { n: sel.size })}</span>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={exportSelected} className="btn btn-outline h-8 text-xs"><Download className="h-3.5 w-3.5" /> {t("acan.exportSelected")}</button>
              <button onClick={() => setSel(new Set())} className="text-xs font-medium text-[var(--muted)] hover:text-[var(--fg)]">{t("acan.clear")}</button>
            </div>
          </div>
        )}

        {error && <ErrorBanner className="mt-4">{error}</ErrorBanner>}

        {/* Table */}
        <div className="card mt-4">
          {!rows ? (
            <TableSkeleton rows={8} cells={5} />
          ) : rows.length === 0 ? (
            <EmptyState
              className="border-0"
              icon={Users}
              title={t("acan.noStudents")}
              hint={t("acan.noStudentsHint")}
              action={<button onClick={() => setAddOpen(true)} className="btn btn-primary"><Plus className="h-4 w-4" /> {t("acan.addStudent")}</button>}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
                    <th className="w-10 px-4 py-3"><input type="checkbox" checked={pageRows.length > 0 && pageRows.every((r) => sel.has(r.id))} onChange={(e) => { const n = new Set(sel); pageRows.forEach((r) => e.target.checked ? n.add(r.id) : n.delete(r.id)); setSel(n); }} /></th>
                    <th className="hidden px-3 py-3 font-semibold lg:table-cell">{t("acan.colId")}</th>
                    <th className="px-3 py-3 font-semibold">{t("acan.colStudent")}</th>
                    <th className="hidden px-3 py-3 font-semibold md:table-cell">{t("acan.colGender")}</th>
                    <th className="hidden px-3 py-3 text-center font-semibold md:table-cell">{t("acan.colAge")}</th>
                    <th className="hidden px-3 py-3 font-semibold sm:table-cell">{t("acan.colClass")}</th>
                    <th className="px-3 py-3 text-center font-semibold">{t("acan.colAvgGrade")}</th>
                    <th className="hidden px-3 py-3 text-center font-semibold sm:table-cell">{t("acan.colMissingDays")}</th>
                    <th className="px-3 py-3 text-right font-semibold">{t("acan.colActions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 && (
                    <tr><td colSpan={9} className="px-4 py-12 text-center">
                      <p className="text-sm font-medium">{t("acan.noMatch")}</p>
                      <button onClick={() => { setQ(""); setClassFilter(""); setGenderFilter(""); }} className="mt-1.5 text-xs text-[#c6ff34] hover:underline">{t("acan.clearFilters")}</button>
                    </td></tr>
                  )}
                  {pageRows.map((r) => (
                    <tr key={r.id} className={clsx("border-b border-[var(--border)] last:border-0 hover:bg-white/[0.02]", sel.has(r.id) && "bg-[#c6ff34]/10")}>
                      <td className="px-4 py-3"><input type="checkbox" checked={sel.has(r.id)} onChange={(e) => { const n = new Set(sel); e.target.checked ? n.add(r.id) : n.delete(r.id); setSel(n); }} /></td>
                      <td className="hidden px-3 py-3 font-mono text-xs text-[var(--muted)] lg:table-cell">{r.id.slice(-4).toUpperCase()}</td>
                      <td className="px-3 py-3">
                        <button onClick={() => navigate(`/admin/students/${r.id}`)} className="flex items-center gap-2.5 text-left hover:text-[#c6ff34]">
                          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#111110] text-[11px] font-bold text-white">{initials(r.name)}</span>
                          <span><span className="block font-medium">{r.name}</span><span className="block text-xs text-[var(--muted)]">{r.email}</span></span>
                        </button>
                      </td>
                      <td className="hidden px-3 py-3 text-[var(--muted)] md:table-cell">{r.gender ?? "—"}</td>
                      <td className="hidden px-3 py-3 text-center text-[var(--muted)] md:table-cell">{r.age ?? "—"}</td>
                      <td className="hidden px-3 py-3 sm:table-cell">{r.studentClass ? <span className="rounded-md bg-white/[0.05] px-2 py-0.5 text-xs">{r.studentClass}</span> : <span className="text-[var(--muted)]">—</span>}</td>
                      <td className={clsx("px-3 py-3 text-center font-semibold tabular-nums", gradeTone(r.avgScore))}>{r.avgScore === null ? "—" : `${r.avgScore}%`}</td>
                      <td className={clsx("hidden px-3 py-3 text-center tabular-nums sm:table-cell", r.missingDays > 0 ? "text-[#F59E0B]" : "text-[var(--muted)]")}>{r.missingDays}</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <a href={r.phone ? `tel:${r.phone}` : undefined} title={r.phone ? t("acan.callTitle", { phone: r.phone }) : t("acan.noPhone")} className={clsx("rounded-lg p-1.5", r.phone ? "text-[var(--muted)] hover:bg-white/[0.06] hover:text-[var(--fg)]" : "cursor-not-allowed text-[var(--muted)]/40")}><Phone className="h-4 w-4" /></a>
                          <a href={`mailto:${r.email}`} title={t("acan.emailTitle")} className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-white/[0.06] hover:text-[var(--fg)]"><Mail className="h-4 w-4" /></a>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (menu?.id === r.id) { setMenu(null); return; }
                              const rect = e.currentTarget.getBoundingClientRect();
                              const openUp = rect.bottom + 140 > window.innerHeight;
                              setMenu({
                                id: r.id,
                                top: openUp ? rect.top - 140 : rect.bottom + 4,
                                left: Math.max(8, rect.right - 176),
                              });
                            }}
                            className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-white/[0.06] hover:text-[var(--fg)]"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        {rows && filtered.length > 0 && (
          <div className="mt-3 flex items-center justify-between text-sm text-[var(--muted)]">
            <span>{t("acan.rangeOf", { from: (page - 1) * PAGE + 1, to: Math.min(page * PAGE, filtered.length), total: filtered.length })}{sel.size > 0 && ` · ${t("acan.selected", { n: sel.size })}`}</span>
            <div className="flex items-center gap-2">
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-[var(--border)] p-1.5 hover:bg-white/[0.05] disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
              <span>{t("acan.pageOf", { page, pages })}</span>
              <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-[var(--border)] p-1.5 hover:bg-white/[0.05] disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
        )}
      </div>

      {menu && (() => {
        const r = (rows ?? []).find((x) => x.id === menu.id);
        if (!r) return null;
        return createPortal(
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ position: "fixed", top: menu.top, left: menu.left }}
            className="z-50 w-44 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] py-1 shadow-xl"
          >
            <MenuItem icon={Pencil} onClick={() => { setEditing(r); setMenu(null); }}>{t("acan.edit")}</MenuItem>
            <MenuItem icon={BookPlus} onClick={() => { setAssigning(r); setMenu(null); }}>{t("acan.assignToExam")}</MenuItem>
            <MenuItem icon={Send} onClick={() => { setResending(r); setMenu(null); }}>{t("acan.resendInvite")}</MenuItem>
            <MenuItem icon={Trash2} danger onClick={() => { setDeleting(r); setMenu(null); }}>{t("acan.delete")}</MenuItem>
          </div>,
          document.body,
        );
      })()}

      {addOpen && <StudentForm title={t("acan.addStudent")} onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); load(); }} />}
      {importOpen && <ImportModal onClose={() => setImportOpen(false)} onDone={load} />}
      {editing && <StudentForm title={t("acan.editStudent")} student={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {assigning && <AssignModal student={assigning} onClose={() => setAssigning(null)} />}
      {deleting && <DeleteModal student={deleting} onClose={() => setDeleting(null)} onDone={() => { setDeleting(null); setSel(new Set()); load(); }} />}
      {resending && <ResendInviteModal student={resending} onClose={() => setResending(null)} />}
    </AdminShell>
  );
}

function MenuItem({ icon: Icon, children, onClick, danger }: { icon: typeof Pencil; children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={clsx("flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-white/[0.05]", danger ? "text-rose-400" : "text-[var(--fg)]")}>
      <Icon className="h-4 w-4" /> {children}
    </button>
  );
}

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [result, setResult] = useState<{ created: unknown[]; skipped: { email: string; reason: string }[] } | null>(null);
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

  const submit = async () => {
    if (!rows) return;
    setBusy(true); setErr(null);
    try { setResult(await api.post<{ created: unknown[]; skipped: { email: string; reason: string }[] }>("/admin/candidates/bulk", { rows })); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Modal title={t("acan.importStudents")} onClose={onClose}>
      {!result ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-[var(--muted)]">{t("acan.importDesc")}</p>
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-[var(--border)] p-6 text-center hover:bg-[var(--card-2)]">
            <Upload className="h-6 w-6 text-[var(--muted)]" />
            <span className="text-sm font-medium">{rows ? t("acan.readyToImport", { n: rows.length }) : t("acan.chooseFile")}</span>
            <span className="text-xs text-[var(--muted)]">{t("acan.colsHint")}</span>
            <input type="file" accept={IMPORT_ACCEPT} className="hidden" onChange={onFile} />
          </label>
          {err && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">{err}</p>}
          <div className="mt-2 flex items-center justify-between gap-2">
            <a href="/templates/Student-Import-Template.xlsx" download className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--muted)] hover:text-[var(--fg)]" title="Download the student import template (.xlsx)">
              <Download className="h-3.5 w-3.5" /> Download template
            </a>
            <div className="flex gap-2">
              <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--fg)]">{t("acan.cancel")}</button>
              <button onClick={submit} disabled={busy || !rows} className="btn btn-primary disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} {t("acan.importN")} {rows ? rows.length : ""}</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-400">
            <CheckCircle2 className="h-4 w-4" /> {t("acan.addedN", { n: result.created.length })}
          </div>
          {result.skipped.length > 0 && (
            <div className="rounded-lg border border-[var(--border)] p-3">
              <p className="text-xs font-semibold text-[var(--muted)]">{t("acan.skippedN", { n: result.skipped.length })}</p>
              <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto text-xs text-[var(--muted)]">
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

function StudentForm({ title, student, onClose, onSaved }: { title: string; student?: Student; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [name, setName] = useState(student?.name ?? "");
  const [email, setEmail] = useState(student?.email ?? "");
  const [password, setPassword] = useState("");
  const [gender, setGender] = useState(student?.gender ?? "");
  const [age, setAge] = useState(student?.age?.toString() ?? "");
  const [phone, setPhone] = useState(student?.phone ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const editMode = !!student;

  async function save() {
    setErr(null);
    if (!name.trim() || !email.trim()) { setErr(t("acan.errNameEmail")); return; }
    setBusy(true);
    try {
      const body = { name, email, gender: gender || undefined, age: age ? Number(age) : null, phone };
      if (editMode) {
        await api.patch(`/admin/students/${student!.id}`, body);
        if (password) await api.patch(`/admin/candidates/${student!.id}/password`, { password });
      } else {
        await api.post("/admin/candidates", body);
      }
      onSaved();
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <div className="mt-4 space-y-3">
        <Field label={t("acan.fullName")}><input className="input h-10" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label={t("acan.email")}><input className="input h-10" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("acan.colGender")}>
            <select className="input h-10" value={gender} onChange={(e) => setGender(e.target.value)}><option value="">—</option><option value="Male">{t("acan.male")}</option><option value="Female">{t("acan.female")}</option><option value="Other">{t("acan.other")}</option></select>
          </Field>
          <Field label={t("acan.age")}><input type="number" min={0} className="input h-10" value={age} onChange={(e) => setAge(e.target.value)} /></Field>
        </div>
        <Field label={t("acan.phone")}><input className="input h-10" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+233…" /></Field>
        {editMode ? (
          <Field label={t("acan.resetPassword")}>
            <input type="password" className="input h-10" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("acan.leaveBlank")} />
          </Field>
        ) : (
          <p className="text-xs text-[var(--muted)]">{t("acan.setupLinkHint")}</p>
        )}
        {err && <p className="text-sm text-rose-500">{err}</p>}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--fg)]">{t("acan.cancel")}</button>
        <button onClick={save} disabled={busy} className="btn btn-primary disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {editMode ? t("acan.saveChanges") : t("acan.addStudent")}</button>
      </div>
    </Modal>
  );
}

function AssignModal({ student, onClose }: { student: Student; onClose: () => void }) {
  const t = useT();
  const [exams, setExams] = useState<ExamOpt[]>([]);
  const [examId, setExamId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { api.get<{ items: { exam: ExamOpt }[] }>("/admin/exams").then((d) => { const xs = d.items.map((i) => i.exam); setExams(xs); if (xs[0]) setExamId(xs[0].id); }).catch(() => {}); }, []);
  async function assign() {
    setBusy(true);
    try { await api.post(`/admin/exams/${examId}/assign-bulk`, { candidateIds: [student.id], confirm: true }); setMsg(t("acan.assignedConfirmed", { name: student.name })); }
    catch { setMsg(t("acan.couldNotAssign")); } finally { setBusy(false); }
  }
  return (
    <Modal title={t("acan.assignTitle")} onClose={onClose}>
      <p className="mt-2 text-sm text-[var(--muted)]">{t("acan.enrolIn", { name: student.name })}</p>
      <select className="input mt-3 h-10" value={examId} onChange={(e) => setExamId(e.target.value)}>{exams.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select>
      {msg && <p className="mt-3 text-sm text-emerald-500">{msg}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--fg)]">{t("acan.close")}</button>
        <button onClick={assign} disabled={busy || !examId} className="btn btn-primary disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookPlus className="h-4 w-4" />} {t("acan.assign")}</button>
      </div>
    </Modal>
  );
}

function DeleteModal({ student, onClose, onDone }: { student: Student; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  async function del() { setBusy(true); try { await api.del(`/admin/candidates/${student.id}`); onDone(); } catch { setBusy(false); } }
  return (
    <Modal title={t("acan.deleteTitle")} onClose={onClose}>
      <div className="mt-3 flex items-center gap-2.5"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-500/15 text-rose-400"><AlertTriangle className="h-5 w-5" /></span>
        <p className="text-sm text-[var(--muted)]">{t("acan.deleteWarn", { name: student.name })}</p></div>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} disabled={busy} className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--fg)]">{t("acan.cancel")}</button>
        <button onClick={del} disabled={busy} className="btn btn-danger">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} {t("acan.delete")}</button>
      </div>
    </Modal>
  );
}

/**
 * Regenerates a student's password and resends the onboarding email — for a
 * student whose original invitation failed to deliver (e.g. an SMTP outage).
 * We only ever store a bcrypt hash, so this issues a fresh temporary password
 * rather than "resending" the original, which the confirmation copy makes clear.
 */
function ResendInviteModal({ student, onClose }: { student: Student; onClose: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; delivery: string; error: string | null } | null>(null);
  async function resend() {
    setBusy(true);
    try { setResult(await api.post(`/admin/candidates/${student.id}/resend-invite`)); }
    catch (e) { setResult({ ok: false, delivery: "failed", error: (e as Error).message }); }
    finally { setBusy(false); }
  }
  return (
    <Modal title={t("acan.resendInviteTitle")} onClose={onClose}>
      {!result ? (
        <>
          <p className="mt-3 text-sm text-[var(--muted)]">{t("acan.resendInviteWarn", { name: student.name, email: student.email })}</p>
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={onClose} disabled={busy} className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--fg)]">{t("acan.cancel")}</button>
            <button onClick={resend} disabled={busy} className="btn btn-primary disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {t("acan.resendInvite")}</button>
          </div>
        </>
      ) : (
        <>
          {result.ok ? (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-400"><CheckCircle2 className="h-4 w-4 shrink-0" /> {t("acan.resendInviteSent", { email: student.email })}</div>
          ) : (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-400">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t("acan.resendInviteFailed")}{result.error && <span className="mt-1 block text-xs opacity-80">{result.error}</span>}</span>
            </div>
          )}
          <div className="mt-5 flex justify-end"><button onClick={onClose} className="btn btn-primary">{t("acan.done")}</button></div>
        </>
      )}
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-sm font-medium">{label}</span>{children}</label>;
}
