import { useEffect, useState } from "react";
import {
  Building2, Loader2, Save, CheckCircle2, GraduationCap, BookOpen, Library, MapPin, CalendarRange, Plus, Trash2,
} from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { PageHeader } from "@/components/PageHeader";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { clsx } from "clsx";

interface Settings {
  id: string; name: string; type?: string; accreditation?: string; website: string; phone?: string; address?: string; plan?: string;
  supportEmail: string; timezone: string; defaultPassingScore: number; defaultProctored: boolean; autoConfirmEnrollment: boolean;
}
interface Faculty { id: string; name: string; }
interface Department { id: string; name: string; facultyId?: string | null; }
interface Program { id: string; name: string; departmentId?: string | null; level?: string; }
interface Campus { id: string; name: string; location?: string; }
interface AcademicYear { id: string; name: string; startDate?: string | null; endDate?: string | null; current?: boolean; }
interface Inst {
  settings: Settings;
  counts: { faculties: number; departments: number; programs: number; campuses: number; academicYears: number };
  faculties: Faculty[]; departments: Department[]; programs: Program[]; campuses: Campus[]; academicYears: AcademicYear[];
}

const TABS = [
  { key: "overview", labelKey: "aorg.tabOverview", icon: Building2 },
  { key: "faculties", labelKey: "aorg.faculties", icon: GraduationCap },
  { key: "departments", labelKey: "aorg.departments", icon: BookOpen },
  { key: "programs", labelKey: "aorg.programs", icon: Library },
  { key: "campuses", labelKey: "aorg.campuses", icon: MapPin },
  { key: "academic", labelKey: "aorg.tabAcademic", icon: CalendarRange },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const TYPES = ["University", "College", "Polytechnic", "Secondary School", "Training Institute", "Other"];
const TYPE_KEY: Record<string, string> = {
  University: "aorg.typeUniversity", College: "aorg.typeCollege", Polytechnic: "aorg.typePolytechnic",
  "Secondary School": "aorg.typeSecondary", "Training Institute": "aorg.typeTraining", Other: "aorg.typeOther",
};

export function AdminOrganization() {
  const t = useT();
  const [data, setData] = useState<Inst | null>(null);
  const [tab, setTab] = useState<TabKey>("overview");
  const [profile, setProfile] = useState<Partial<Settings>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.get<Inst>("/admin/institution").then((d) => { setData(d); setProfile(d.settings); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const websiteOk = !profile.website?.trim() || /^https?:\/\/\S+\.\S+/i.test(profile.website.trim());

  async function saveProfile() {
    if (!websiteOk) { setError(t("aorg.errWebsite")); return; }
    setSaving(true); setMsg(null); setError(null);
    try {
      await api.patch("/admin/settings", {
        name: profile.name, type: profile.type, accreditation: profile.accreditation,
        website: profile.website, phone: profile.phone, address: profile.address,
      });
      setMsg(t("aorg.saved"));
      load();
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }

  return (
    <AdminShell wide>
      <div className="fade-in">
        <PageHeader title={t("aorg.title")} subtitle={t("aorg.subtitle")}
          actions={tab === "overview" ? <>
            {msg && <span className="inline-flex items-center gap-1.5 text-sm text-white"><CheckCircle2 className="h-4 w-4" /> {msg}</span>}
            {error && <span className="text-sm text-rose-200">{error}</span>}
            <button onClick={saveProfile} disabled={saving || !websiteOk} className="btn btn-on-teal disabled:opacity-50">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {t("aorg.saveProfile")}
            </button>
          </> : undefined} />

        {/* Tabs */}
        <div className="flex flex-wrap gap-1 rounded-xl border border-[var(--border)] bg-[var(--card)] p-1">
          {TABS.map((tb) => (
            <button key={tb.key} onClick={() => setTab(tb.key)}
              className={clsx("flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition",
                tab === tb.key ? "bg-[var(--color-navy)] text-white shadow-sm" : "text-[var(--muted)] hover:text-[var(--fg)]")}>
              <tb.icon className="h-4 w-4" /> {t(tb.labelKey)}
            </button>
          ))}
        </div>

        {!data ? (
          <div className="mt-8 flex items-center gap-2 text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}</div>
        ) : tab === "overview" ? (
          <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[340px_1fr]">
            {/* Stat cards */}
            <div className="space-y-3">
              <StatCard icon={GraduationCap} label={t("aorg.faculties")} value={data.counts.faculties} onClick={() => setTab("faculties")} />
              <StatCard icon={BookOpen} label={t("aorg.departments")} value={data.counts.departments} onClick={() => setTab("departments")} />
              <StatCard icon={Library} label={t("aorg.programs")} value={data.counts.programs} onClick={() => setTab("programs")} />
              <StatCard icon={MapPin} label={t("aorg.campuses")} value={data.counts.campuses} onClick={() => setTab("campuses")} />
            </div>

            {/* Profile */}
            <div className="card p-6">
              <h2 className="flex items-center gap-2 text-base font-bold"><Building2 className="h-4 w-4 text-brand-400" /> {t("aorg.profile")}</h2>
              <div className="mt-4 space-y-4">
                <Field label={t("aorg.instName")}>
                  <input className="input h-10" value={profile.name ?? ""} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
                </Field>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label={t("aorg.instType")}>
                    <select className="input h-10" value={profile.type ?? "University"} onChange={(e) => setProfile({ ...profile, type: e.target.value })}>
                      {TYPES.map((ty) => <option key={ty} value={ty}>{t(TYPE_KEY[ty] ?? ty)}</option>)}
                    </select>
                  </Field>
                  <Field label={t("aorg.accreditation")}>
                    <input className="input h-10" value={profile.accreditation ?? ""} placeholder="e.g. NUC, NAAC, WAEC" onChange={(e) => setProfile({ ...profile, accreditation: e.target.value })} />
                  </Field>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label={t("aorg.website")}>
                    <input className="input h-10" value={profile.website ?? ""} placeholder="https://..." onChange={(e) => setProfile({ ...profile, website: e.target.value })} />
                    {!websiteOk && <span className="mt-1 block text-xs text-rose-400">{t("aorg.websiteErr")}</span>}
                  </Field>
                  <Field label={t("aorg.phone")}>
                    <input className="input h-10" value={profile.phone ?? ""} placeholder="+1 555 000 0000" onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />
                  </Field>
                </div>
                <Field label={t("aorg.address")}>
                  <input className="input h-10" value={profile.address ?? ""} placeholder="123 University Ave, City, Country" onChange={(e) => setProfile({ ...profile, address: e.target.value })} />
                </Field>
                <div className="flex items-center justify-between rounded-xl border border-[var(--border)] p-4">
                  <div>
                    <p className="text-sm font-semibold">{t("aorg.currentPlan")}</p>
                    <p className="text-xs text-[var(--muted)]">{t("aorg.planDesc")}</p>
                  </div>
                  <span className="rounded-lg border border-[var(--border)] px-3 py-1 text-sm font-semibold">{data.settings.plan ?? "Starter"}</span>
                </div>
              </div>
            </div>
          </div>
        ) : tab === "faculties" ? (
          <SimpleTab kind="faculties" title={t("aorg.faculties")} placeholder={t("aorg.facultyPh")} empty={t("aorg.noFaculties")} items={data.faculties} onChanged={load} />
        ) : tab === "departments" ? (
          <DepartmentsTab data={data} onChanged={load} />
        ) : tab === "programs" ? (
          <ProgramsTab data={data} onChanged={load} />
        ) : tab === "campuses" ? (
          <CampusesTab items={data.campuses} onChanged={load} />
        ) : (
          <AcademicYearsTab items={data.academicYears} onChanged={load} />
        )}
      </div>
    </AdminShell>
  );
}

function StatCard({ icon: Icon, label, value, onClick }: { icon: typeof Building2; label: string; value: number; onClick: () => void }) {
  return (
    <button onClick={onClick} className="card flex w-full items-center gap-3 p-4 text-left transition hover:shadow-md">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/[0.04] text-[var(--muted)]"><Icon className="h-5 w-5" /></div>
      <div>
        <p className="text-2xl font-bold tabular-nums">{value}</p>
        <p className="text-sm text-[var(--muted)]">{label}</p>
      </div>
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold">{label}</span>
      {children}
    </label>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <h2 className="text-base font-bold">{title}</h2>
      <div className="card mt-3 p-5">{children}</div>
    </div>
  );
}

function DeleteBtn({ onClick }: { onClick: () => void }) {
  const t = useT();
  return <button onClick={onClick} title={t("aorg.deleteBtn")} className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-rose-500/15 hover:text-rose-400"><Trash2 className="h-4 w-4" /></button>;
}

function useCreate(kind: string, onChanged: () => void) {
  const [busy, setBusy] = useState(false);
  const create = async (body: Record<string, unknown>) => {
    setBusy(true);
    try { await api.post(`/admin/institution/${kind}`, body); onChanged(); } finally { setBusy(false); }
  };
  const del = async (id: string) => { await api.del(`/admin/institution/${kind}/${id}`); onChanged(); };
  return { busy, create, del };
}

function SimpleTab({ kind, title, placeholder, empty, items, onChanged }: { kind: string; title: string; placeholder: string; empty: string; items: { id: string; name: string }[]; onChanged: () => void }) {
  const t = useT();
  const { busy, create, del } = useCreate(kind, onChanged);
  const [name, setName] = useState("");
  return (
    <Panel title={title}>
      <div className="flex gap-2">
        <input className="input h-10 flex-1" placeholder={placeholder} value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) { create({ name }); setName(""); } }} />
        <button disabled={busy || !name.trim()} onClick={() => { create({ name }); setName(""); }} className="btn btn-primary disabled:opacity-50"><Plus className="h-4 w-4" /> {t("aorg.add")}</button>
      </div>
      <List items={items} onDelete={del} render={(i) => i.name} empty={empty} />
    </Panel>
  );
}

function List<T extends { id: string }>({ items, render, onDelete, empty }: { items: T[]; render: (i: T) => React.ReactNode; onDelete: (id: string) => void; empty: string }) {
  if (items.length === 0) return <p className="mt-4 text-sm text-[var(--muted)]">{empty}</p>;
  return (
    <ul className="mt-4 divide-y divide-[var(--border)]">
      {items.map((i) => (
        <li key={i.id} className="flex items-center justify-between py-2.5">
          <span className="text-sm">{render(i)}</span>
          <DeleteBtn onClick={() => onDelete(i.id)} />
        </li>
      ))}
    </ul>
  );
}

function DepartmentsTab({ data, onChanged }: { data: Inst; onChanged: () => void }) {
  const t = useT();
  const { busy, create, del } = useCreate("departments", onChanged);
  const [name, setName] = useState("");
  const [facultyId, setFacultyId] = useState("");
  const facultyName = (id?: string | null) => data.faculties.find((f) => f.id === id)?.name;
  return (
    <Panel title={t("aorg.departments")}>
      <div className="flex flex-wrap gap-2">
        <input className="input h-10 flex-1" placeholder={t("aorg.deptPh")} value={name} onChange={(e) => setName(e.target.value)} />
        <select className="input h-10" value={facultyId} onChange={(e) => setFacultyId(e.target.value)}>
          <option value="">{t("aorg.noFaculty")}</option>
          {data.faculties.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <button disabled={busy || !name.trim()} onClick={() => { create({ name, facultyId: facultyId || null }); setName(""); }} className="btn btn-primary disabled:opacity-50"><Plus className="h-4 w-4" /> {t("aorg.add")}</button>
      </div>
      <List items={data.departments} onDelete={del} empty={t("aorg.noDepartments")}
        render={(d) => <>{d.name}{facultyName(d.facultyId) && <span className="ml-2 text-xs text-[var(--muted)]">· {facultyName(d.facultyId)}</span>}</>} />
    </Panel>
  );
}

function ProgramsTab({ data, onChanged }: { data: Inst; onChanged: () => void }) {
  const t = useT();
  const { busy, create, del } = useCreate("programs", onChanged);
  const [name, setName] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [level, setLevel] = useState("");
  const deptName = (id?: string | null) => data.departments.find((x) => x.id === id)?.name;
  return (
    <Panel title={t("aorg.programs")}>
      <div className="flex flex-wrap gap-2">
        <input className="input h-10 flex-1" placeholder={t("aorg.programPh")} value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input h-10 w-28" placeholder={t("aorg.level")} value={level} onChange={(e) => setLevel(e.target.value)} />
        <select className="input h-10" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
          <option value="">{t("aorg.noDepartment")}</option>
          {data.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <button disabled={busy || !name.trim()} onClick={() => { create({ name, departmentId: departmentId || null, level }); setName(""); setLevel(""); }} className="btn btn-primary disabled:opacity-50"><Plus className="h-4 w-4" /> {t("aorg.add")}</button>
      </div>
      <List items={data.programs} onDelete={del} empty={t("aorg.noPrograms")}
        render={(p) => <>{p.name}{p.level && <span className="ml-2 rounded bg-[var(--bg)] px-1.5 py-0.5 text-[11px] text-[var(--muted)]">{p.level}</span>}{deptName(p.departmentId) && <span className="ml-2 text-xs text-[var(--muted)]">· {deptName(p.departmentId)}</span>}</>} />
    </Panel>
  );
}

function CampusesTab({ items, onChanged }: { items: Campus[]; onChanged: () => void }) {
  const t = useT();
  const { busy, create, del } = useCreate("campuses", onChanged);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  return (
    <Panel title={t("aorg.campuses")}>
      <div className="flex flex-wrap gap-2">
        <input className="input h-10 flex-1" placeholder={t("aorg.campusPh")} value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input h-10 flex-1" placeholder={t("aorg.locationPh")} value={location} onChange={(e) => setLocation(e.target.value)} />
        <button disabled={busy || !name.trim()} onClick={() => { create({ name, location }); setName(""); setLocation(""); }} className="btn btn-primary disabled:opacity-50"><Plus className="h-4 w-4" /> {t("aorg.add")}</button>
      </div>
      <List items={items} onDelete={del} empty={t("aorg.noCampuses")}
        render={(c) => <>{c.name}{c.location && <span className="ml-2 text-xs text-[var(--muted)]">· {c.location}</span>}</>} />
    </Panel>
  );
}

function AcademicYearsTab({ items, onChanged }: { items: AcademicYear[]; onChanged: () => void }) {
  const t = useT();
  const { busy, create, del } = useCreate("academic-years", onChanged);
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [current, setCurrent] = useState(false);
  const fmt = (s?: string | null) => (s ? new Date(s).toLocaleDateString() : "");
  return (
    <Panel title={t("aorg.academicYears")}>
      <div className="flex flex-wrap items-end gap-2">
        <input className="input h-10 flex-1" placeholder={t("aorg.yearPh")} value={name} onChange={(e) => setName(e.target.value)} />
        <label className="text-xs text-[var(--muted)]"><span className="mb-1 block">{t("aorg.start")}</span><input type="date" className="input h-10" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
        <label className="text-xs text-[var(--muted)]"><span className="mb-1 block">{t("aorg.end")}</span><input type="date" className="input h-10" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>
        <label className="flex items-center gap-1.5 pb-2.5 text-xs"><input type="checkbox" checked={current} onChange={(e) => setCurrent(e.target.checked)} /> {t("aorg.current")}</label>
        <button disabled={busy || !name.trim()} onClick={() => { create({ name, startDate: startDate || null, endDate: endDate || null, current }); setName(""); setStartDate(""); setEndDate(""); setCurrent(false); }} className="btn btn-primary disabled:opacity-50"><Plus className="h-4 w-4" /> {t("aorg.add")}</button>
      </div>
      <List items={items} onDelete={del} empty={t("aorg.noYears")}
        render={(y) => <>{y.name}{y.current && <span className="ml-2 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">{t("aorg.current")}</span>}{(y.startDate || y.endDate) && <span className="ml-2 text-xs text-[var(--muted)]">· {fmt(y.startDate)} – {fmt(y.endDate)}</span>}</>} />
    </Panel>
  );
}
