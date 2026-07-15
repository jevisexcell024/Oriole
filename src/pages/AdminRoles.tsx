import { Fragment, useEffect, useMemo, useState } from "react";
import {
  ShieldCheck, ClipboardCheck, Radio, Plus, Loader2, X, Copy, Trash2, Pencil, Search, Check,
  Lock, GitBranch, Building2, Scale, ScrollText, Users,
} from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { PageHeader } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { api } from "@/lib/api";
import { useT, type TFn } from "@/lib/i18n";
import { clsx } from "clsx";

interface PermissionDef { key: string; category: string; label: string; description: string; }
interface RoleScope { facultyId?: string | null; departmentId?: string | null; campusId?: string | null }
interface CustomRole {
  id: string; name: string; description?: string; permissions: string[];
  parentRoleId?: string | null; scope?: RoleScope | null;
  createdAt: string; updatedAt: string; createdBy?: string; memberCount: number;
}
interface Inst { faculties: { id: string; name: string }[]; departments: { id: string; name: string }[]; campuses: { id: string; name: string }[]; }
interface Log { id: string; at: string; actorId: string; actorName: string; action: string; target: string; }
interface Member { id: string; name: string; email: string; role: string; customRoleId?: string | null; }

const SYSTEM_ROLES = ["admin", "facilitator", "proctor"] as const;
type SystemRole = (typeof SYSTEM_ROLES)[number];
const SYSTEM_META: Record<SystemRole, { labelKey: string; icon: typeof ShieldCheck; pill: string }> = {
  admin: { labelKey: "ateam.roleAdmin", icon: ShieldCheck, pill: "bg-[#c6ff34]/15 text-[#c6ff34]" },
  facilitator: { labelKey: "ateam.roleFacilitator", icon: ClipboardCheck, pill: "bg-[#06B6D4]/15 text-[#06B6D4]" },
  proctor: { labelKey: "ateam.roleProctor", icon: Radio, pill: "bg-[#F59E0B]/15 text-[#F59E0B]" },
};
const systemParentId = (r: SystemRole) => `system:${r}`;
const parseSystemParentId = (id: string | null | undefined): SystemRole | null => {
  if (!id || !id.startsWith("system:")) return null;
  const r = id.slice("system:".length);
  return (SYSTEM_ROLES as readonly string[]).includes(r) ? (r as SystemRole) : null;
};

const fmtDate = (s: string) => new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export function AdminRoles() {
  const t = useT();
  const [permissions, setPermissions] = useState<PermissionDef[] | null>(null);
  const [systemPerms, setSystemPerms] = useState<Record<SystemRole, string[]> | null>(null);
  const [roles, setRoles] = useState<CustomRole[] | null>(null);
  const [team, setTeam] = useState<Member[] | null>(null);
  const [inst, setInst] = useState<Inst | null>(null);
  const [logs, setLogs] = useState<Log[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<CustomRole | "new" | null>(null);
  const [del, setDel] = useState<CustomRole | null>(null);
  const [compare, setCompare] = useState(false);

  const load = () => Promise.all([
    api.get<{ permissions: PermissionDef[]; systemRoles: Record<SystemRole, string[]> }>("/admin/permissions"),
    api.get<{ roles: CustomRole[] }>("/admin/roles"),
    api.get<{ team: Member[] }>("/admin/team"),
    api.get<Inst>("/admin/institution"),
    api.get<{ logs: Log[] }>("/admin/audit-logs"),
  ]).then(([p, r, tm, i, l]) => {
    setPermissions(p.permissions); setSystemPerms(p.systemRoles); setRoles(r.roles); setTeam(tm.team); setInst(i); setLogs(l.logs);
  }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const categories = useMemo(() => [...new Set((permissions ?? []).map((p) => p.category))], [permissions]);

  /** Resolve a role's own + inherited permissions (mirrors server/auth.ts resolveCustomRolePermissions). */
  const resolveInherited = (parentRoleId: string | null | undefined, seen: Set<string> = new Set()): string[] => {
    if (!parentRoleId || seen.has(parentRoleId)) return [];
    seen.add(parentRoleId);
    const sys = parseSystemParentId(parentRoleId);
    if (sys) return systemPerms?.[sys] ?? [];
    const parent = (roles ?? []).find((r) => r.id === parentRoleId);
    if (!parent) return [];
    return [...resolveInherited(parent.parentRoleId, seen), ...parent.permissions];
  };

  const allRoleOptions = useMemo(() => [
    ...SYSTEM_ROLES.map((r) => ({ id: systemParentId(r), name: t(SYSTEM_META[r].labelKey), system: true as const })),
    ...(roles ?? []).map((r) => ({ id: r.id, name: r.name, system: false as const })),
  ], [roles, t]);

  const roleName = (id: string | null | undefined): string => {
    if (!id) return t("arole.none");
    const sys = parseSystemParentId(id);
    if (sys) return t(SYSTEM_META[sys].labelKey);
    return (roles ?? []).find((r) => r.id === id)?.name ?? t("arole.none");
  };

  const scopeLabel = (scope: RoleScope | null | undefined): string | null => {
    if (!scope) return null;
    const parts: string[] = [];
    if (scope.facultyId) parts.push(inst?.faculties.find((f) => f.id === scope.facultyId)?.name ?? "");
    if (scope.departmentId) parts.push(inst?.departments.find((d) => d.id === scope.departmentId)?.name ?? "");
    if (scope.campusId) parts.push(inst?.campuses.find((c) => c.id === scope.campusId)?.name ?? "");
    const filtered = parts.filter(Boolean);
    return filtered.length ? filtered.join(" · ") : null;
  };

  const columns: Column<CustomRole>[] = [
    {
      key: "name", header: t("arole.colName"), sortValue: (r) => r.name, csv: (r) => r.name,
      render: (r) => (
        <div>
          <p className="font-semibold">{r.name}</p>
          {r.description && <p className="mt-0.5 max-w-xs truncate text-xs text-[var(--muted)]">{r.description}</p>}
        </div>
      ),
    },
    {
      key: "permissions", header: t("arole.colPermissions"), sortValue: (r) => resolveInherited(r.parentRoleId).length + r.permissions.length, csv: (r) => String(r.permissions.length),
      render: (r) => {
        const total = new Set([...resolveInherited(r.parentRoleId), ...r.permissions]).size;
        return <span className="rounded-full bg-[var(--card-2)] px-2 py-0.5 text-xs font-semibold">{t("arole.permissionsN", { n: total })}</span>;
      },
    },
    {
      key: "parent", header: t("arole.colInheritsFrom"), csv: (r) => roleName(r.parentRoleId),
      render: (r) => r.parentRoleId
        ? <span className="inline-flex items-center gap-1 text-xs text-[var(--muted)]"><GitBranch className="h-3 w-3" /> {roleName(r.parentRoleId)}</span>
        : <span className="text-xs text-[var(--muted)]">—</span>,
    },
    {
      key: "scope", header: t("arole.colScope"), csv: (r) => scopeLabel(r.scope) ?? "",
      render: (r) => scopeLabel(r.scope)
        ? <span className="inline-flex items-center gap-1 text-xs text-[var(--muted)]"><Building2 className="h-3 w-3" /> {scopeLabel(r.scope)}</span>
        : <span className="text-xs text-[var(--muted)]">{t("arole.scopeAny")}</span>,
    },
    {
      key: "members", header: t("arole.colMembers"), th: "text-right", td: "text-right", sortValue: (r) => r.memberCount, csv: (r) => String(r.memberCount),
      render: (r) => <span className="inline-flex items-center gap-1 text-xs font-medium"><Users className="h-3 w-3 text-[var(--muted)]" /> {r.memberCount}</span>,
    },
    {
      key: "actions", header: "", th: "text-right", td: "text-right",
      render: (r) => (
        <div className="flex items-center justify-end gap-1">
          <button title={t("arole.edit")} onClick={(e) => { e.stopPropagation(); setForm(r); }} className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-white/[0.05] hover:text-[var(--fg)]"><Pencil className="h-3.5 w-3.5" /></button>
          <button title={t("arole.clone")} onClick={async (e) => { e.stopPropagation(); try { await api.post(`/admin/roles/${r.id}/clone`); load(); } catch (err) { setError((err as Error).message); } }} className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-white/[0.05] hover:text-[var(--fg)]"><Copy className="h-3.5 w-3.5" /></button>
          <button title={t("arole.delete")} onClick={(e) => { e.stopPropagation(); setDel(r); }} className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-rose-500/10 hover:text-rose-400"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      ),
    },
  ];

  return (
    <AdminShell wide>
      <div className="fade-in">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PageHeader title={t("arole.title")} subtitle={t("arole.subtitle")} />
          <div className="flex items-center gap-2">
            <button onClick={() => setCompare(true)} className="btn btn-outline"><Scale className="h-4 w-4" /> {t("arole.compare")}</button>
            <button onClick={() => setForm("new")} className="btn btn-primary"><Plus className="h-4 w-4" /> {t("arole.newRole")}</button>
          </div>
        </div>

        {error && <p className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</p>}

        {/* System roles */}
        <div className="mt-6 flex items-center gap-2">
          <h2 className="text-sm font-semibold">{t("arole.systemRoles")}</h2>
          <span className="text-xs text-[var(--muted)]">{t("arole.systemRolesDesc")}</span>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {SYSTEM_ROLES.map((r) => {
            const meta = SYSTEM_META[r];
            const count = systemPerms?.[r].length ?? 0;
            return (
              <div key={r} className="rounded-2xl border border-[var(--border)] p-4">
                <div className="flex items-center gap-2.5">
                  <span className={clsx("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", meta.pill)}><meta.icon className="h-5 w-5" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold">{t(meta.labelKey)}</p>
                    <p className="text-xs text-[var(--muted)]">{t("arole.permissionsN", { n: count })}</p>
                  </div>
                  <span title={t("ateam.systemRoleTitle")} className="flex shrink-0 items-center gap-1 rounded-full bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]"><Lock className="h-2.5 w-2.5" /> {t("ateam.systemRole")}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Custom roles */}
        <div className="mt-6 flex items-center gap-2">
          <h2 className="text-sm font-semibold">{t("arole.customRoles")}</h2>
          <span className="text-xs text-[var(--muted)]">{t("arole.customRolesDesc")}</span>
        </div>
        <div className="mt-3">
          {!roles ? (
            <div className="flex items-center gap-2 text-sm text-[var(--muted)]"><Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}</div>
          ) : (
            <DataTable
              rows={roles}
              columns={columns}
              getId={(r) => r.id}
              searchText={(r) => `${r.name} ${r.description ?? ""}`}
              searchPlaceholder={t("arole.searchPlaceholder")}
              onRowClick={(r) => setForm(r)}
              pageSize={10}
              exportName="orcalis-roles"
              empty={<div className="flex flex-col items-center gap-2 text-sm text-[var(--muted)]"><ShieldCheck className="h-8 w-8" /> {t("arole.none")}</div>}
            />
          )}
        </div>
      </div>

      {form && permissions && systemPerms && (
        <RoleFormModal
          role={form === "new" ? null : form}
          permissions={permissions} categories={categories} roles={roles ?? []} inst={inst} logs={logs ?? []}
          resolveInherited={resolveInherited} roleName={roleName}
          onClose={() => setForm(null)} onDone={() => { setForm(null); load(); }}
        />
      )}
      {del && (
        <DeleteRoleModal
          role={del} roles={roles ?? []} team={team ?? []} roleOptions={allRoleOptions} roleName={roleName}
          onClose={() => setDel(null)} onDone={() => { setDel(null); load(); }}
        />
      )}
      {compare && permissions && systemPerms && (
        <CompareModal options={allRoleOptions} permissions={permissions} categories={categories} resolveInherited={resolveInherited} systemPerms={systemPerms} roles={roles ?? []} onClose={() => setCompare(false)} />
      )}
    </AdminShell>
  );
}

function RoleFormModal({ role, permissions, categories, roles, inst, logs, resolveInherited, roleName, onClose, onDone }: {
  role: CustomRole | null;
  permissions: PermissionDef[]; categories: string[]; roles: CustomRole[]; inst: Inst | null; logs: Log[];
  resolveInherited: (parentRoleId: string | null | undefined, seen?: Set<string>) => string[];
  roleName: (id: string | null | undefined) => string;
  onClose: () => void; onDone: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [parentRoleId, setParentRoleId] = useState<string | null>(role?.parentRoleId ?? null);
  const [selected, setSelected] = useState<Set<string>>(new Set(role?.permissions ?? []));
  const [facultyId, setFacultyId] = useState<string | null>(role?.scope?.facultyId ?? null);
  const [departmentId, setDepartmentId] = useState<string | null>(role?.scope?.departmentId ?? null);
  const [campusId, setCampusId] = useState<string | null>(role?.scope?.campusId ?? null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const inherited = useMemo(() => new Set(resolveInherited(parentRoleId)), [parentRoleId, resolveInherited]);
  const valid = name.trim().length > 0;

  const parentOptions = [
    ...SYSTEM_ROLES.map((r) => ({ id: systemParentId(r), name: t(SYSTEM_META[r].labelKey) })),
    ...roles.filter((r) => r.id !== role?.id).map((r) => ({ id: r.id, name: r.name })),
  ];

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? permissions.filter((p) => p.label.toLowerCase().includes(q) || p.key.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)) : permissions;
    const map = new Map<string, PermissionDef[]>();
    for (const p of filtered) {
      if (!map.has(p.category)) map.set(p.category, []);
      map.get(p.category)!.push(p);
    }
    return map;
  }, [permissions, query]);

  const toggle = (key: string) => setSelected((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const setCategory = (cat: string, on: boolean) => {
    const keys = permissions.filter((p) => p.category === cat).map((p) => p.key);
    setSelected((s) => { const n = new Set(s); keys.forEach((k) => on ? n.add(k) : n.delete(k)); return n; });
  };

  const roleLogs = role ? logs.filter((l) => l.target.includes(role.name) && (l.action.startsWith("role.") || l.action === "team.custom_role_assigned")).slice(0, 8) : [];

  async function save() {
    if (!valid) return;
    setBusy(true); setErr(null);
    const scope = (facultyId || departmentId || campusId) ? { facultyId, departmentId, campusId } : null;
    const payload = { name: name.trim(), description: description.trim() || undefined, permissions: [...selected], parentRoleId: parentRoleId || null, scope };
    try {
      if (role) await api.patch(`/admin/roles/${role.id}`, payload);
      else await api.post("/admin/roles", payload);
      onDone();
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
          <h2 className="text-lg font-bold">{role ? t("arole.editTitle") : t("arole.newTitle")}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-[var(--muted)] hover:bg-white/[0.05]"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2"><span className="mb-1 block text-sm font-medium">{t("arole.name")}</span><input className="input h-10" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("arole.namePlaceholder")} /></label>
            <label className="block sm:col-span-2"><span className="mb-1 block text-sm font-medium">{t("arole.description")}</span><textarea className="input min-h-[60px]" value={description} onChange={(e) => setDescription(e.target.value)} /></label>
            <label className="block"><span className="mb-1 block text-sm font-medium">{t("arole.inheritsFrom")}</span>
              <select className="input h-10" value={parentRoleId ?? ""} onChange={(e) => setParentRoleId(e.target.value || null)}>
                <option value="">{t("arole.none")}</option>
                {parentOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>
            <div />
            <label className="block"><span className="mb-1 block text-sm font-medium">{t("arole.scopeFaculty")}</span>
              <select className="input h-10" value={facultyId ?? ""} onChange={(e) => setFacultyId(e.target.value || null)}>
                <option value="">{t("arole.scopeAny")}</option>
                {inst?.faculties.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
            <label className="block"><span className="mb-1 block text-sm font-medium">{t("arole.scopeDepartment")}</span>
              <select className="input h-10" value={departmentId ?? ""} onChange={(e) => setDepartmentId(e.target.value || null)}>
                <option value="">{t("arole.scopeAny")}</option>
                {inst?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
            <label className="block sm:col-span-2"><span className="mb-1 block text-sm font-medium">{t("arole.scopeCampus")}</span>
              <select className="input h-10" value={campusId ?? ""} onChange={(e) => setCampusId(e.target.value || null)}>
                <option value="">{t("arole.scopeAny")}</option>
                {inst?.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">{t("arole.permissions")}</span>
              <span className="text-xs text-[var(--muted)]">{t("arole.permissionsN", { n: new Set([...inherited, ...selected]).size })}</span>
            </div>
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card-2)] px-3 py-2">
              <Search className="h-4 w-4 text-[var(--muted)]" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("arole.searchPermissions")} className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--muted)]" />
            </div>
            <div className="mt-3 space-y-3">
              {categories.filter((c) => grouped.has(c)).map((cat) => {
                const items = grouped.get(cat)!;
                const allOn = items.every((p) => selected.has(p.key) || inherited.has(p.key));
                return (
                  <div key={cat} className="rounded-xl border border-[var(--border)] p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{t(`arole.cat.${cat}`)}</span>
                      <button type="button" onClick={() => setCategory(cat, !allOn)} className="text-[11px] font-medium text-[#c6ff34] hover:underline">
                        {allOn ? t("arole.clearAll") : t("arole.selectAll")}
                      </button>
                    </div>
                    <div className="mt-2 space-y-1.5">
                      {items.map((p) => {
                        const isInherited = inherited.has(p.key);
                        const on = isInherited || selected.has(p.key);
                        return (
                          <label key={p.key} className={clsx("flex items-start gap-2 rounded-lg px-2 py-1.5", isInherited ? "cursor-not-allowed opacity-70" : "cursor-pointer hover:bg-white/[0.03]")}>
                            <span className={clsx("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border", on ? "border-[#c6ff34] bg-[#c6ff34]" : "border-[var(--border-strong)]")}>
                              {on && <Check className="h-3 w-3 text-[#111110]" />}
                            </span>
                            <input type="checkbox" className="hidden" checked={on} disabled={isInherited} onChange={() => !isInherited && toggle(p.key)} />
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-medium">{p.label}{isInherited && <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">{t("arole.inherited")}</span>}</span>
                              <span className="block text-xs text-[var(--muted)]">{p.description}</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {role && roleLogs.length > 0 && (
            <div className="mt-5">
              <span className="flex items-center gap-1.5 text-sm font-semibold"><ScrollText className="h-3.5 w-3.5" /> {t("arole.history")}</span>
              <ul className="mt-2 space-y-1.5">
                {roleLogs.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2 text-xs text-[var(--muted)]">
                    <span>{l.actorName} · {l.target}</span>
                    <span className="shrink-0 whitespace-nowrap">{fmtDate(l.at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {err && <p className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">{err}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-6 py-4">
          <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--fg)]">{t("ateam.cancel")}</button>
          <button onClick={save} disabled={busy || !valid} className="btn btn-primary disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {t("arole.save")}</button>
        </div>
      </div>
    </div>
  );
}

function DeleteRoleModal({ role, roles, team, roleOptions, roleName, onClose, onDone }: {
  role: CustomRole; roles: CustomRole[]; team: Member[]; roleOptions: { id: string; name: string; system: boolean }[];
  roleName: (id: string | null | undefined) => string;
  onClose: () => void; onDone: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const affectedMembers = team.filter((m) => m.customRoleId === role.id);
  const affectedChildren = roles.filter((r) => r.parentRoleId === role.id);
  const blocked = affectedMembers.length > 0 || affectedChildren.length > 0;
  const [reassignMemberTo, setReassignMemberTo] = useState("");
  const [reassignChildTo, setReassignChildTo] = useState("");

  async function del() {
    setBusy(true); setErr(null);
    try {
      for (const m of affectedMembers) {
        await api.patch(`/admin/team/${m.id}/custom-role`, { customRoleId: reassignMemberTo || null, expiresAt: null });
      }
      for (const child of affectedChildren) {
        await api.patch(`/admin/roles/${child.id}`, { parentRoleId: reassignChildTo || null });
      }
      await api.del(`/admin/roles/${role.id}`);
      onDone();
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h2 className="text-lg font-bold">{t("arole.deleteTitle")}</h2><button onClick={onClose} className="rounded-lg p-1 text-[var(--muted)] hover:bg-white/[0.05]"><X className="h-5 w-5" /></button></div>
        <p className="mt-3 text-sm text-[var(--muted)]">{t("arole.deleteWarn", { name: role.name })}</p>

        {affectedMembers.length > 0 && (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-500">{t("arole.deleteBlockedMembers", { n: affectedMembers.length })}</p>
            <ul className="mt-1.5 max-h-24 space-y-0.5 overflow-y-auto text-xs text-[var(--muted)]">
              {affectedMembers.map((m) => <li key={m.id}>{m.name}</li>)}
            </ul>
            <label className="mt-2 block">
              <span className="mb-1 block text-xs font-medium">{t("arole.reassignMembersTo")}</span>
              <select className="input h-9 text-sm" value={reassignMemberTo} onChange={(e) => setReassignMemberTo(e.target.value)}>
                <option value="">{t("arole.none")}</option>
                {roleOptions.filter((o) => o.id !== role.id && !o.system).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>
          </div>
        )}

        {affectedChildren.length > 0 && (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-500">{t("arole.deleteBlockedChildren", { n: affectedChildren.length })}</p>
            <ul className="mt-1.5 max-h-24 space-y-0.5 overflow-y-auto text-xs text-[var(--muted)]">
              {affectedChildren.map((c) => <li key={c.id}>{c.name} <span className="text-[var(--muted)]">← {roleName(role.id)}</span></li>)}
            </ul>
            <label className="mt-2 block">
              <span className="mb-1 block text-xs font-medium">{t("arole.reassignChildrenTo")}</span>
              <select className="input h-9 text-sm" value={reassignChildTo} onChange={(e) => setReassignChildTo(e.target.value)}>
                <option value="">{t("arole.none")}</option>
                {roleOptions.filter((o) => o.id !== role.id && !affectedChildren.some((c) => c.id === o.id)).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>
          </div>
        )}

        {err && <p className="mt-2 text-sm text-rose-500">{err}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--fg)]">{t("ateam.cancel")}</button>
          <button onClick={del} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            {blocked ? t("arole.reassignAndDelete") : t("arole.delete")}
          </button>
        </div>
      </div>
    </div>
  );
}

function CompareModal({ options, permissions, categories, resolveInherited, systemPerms, roles, onClose }: {
  options: { id: string; name: string; system: boolean }[];
  permissions: PermissionDef[]; categories: string[];
  resolveInherited: (parentRoleId: string | null | undefined, seen?: Set<string>) => string[];
  systemPerms: Record<SystemRole, string[]>; roles: CustomRole[];
  onClose: () => void;
}) {
  const t = useT();
  const [picked, setPicked] = useState<string[]>(options.slice(0, 2).map((o) => o.id));

  const permsFor = (id: string): Set<string> => {
    const sys = parseSystemParentId(id);
    if (sys) return new Set(systemPerms[sys]);
    const role = roles.find((r) => r.id === id);
    if (!role) return new Set();
    return new Set([...resolveInherited(role.parentRoleId), ...role.permissions]);
  };

  const pickedSets = picked.map((id) => ({ id, name: options.find((o) => o.id === id)?.name ?? id, perms: permsFor(id) }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
          <h2 className="text-lg font-bold">{t("arole.compareTitle")}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-[var(--muted)] hover:bg-white/[0.05]"><X className="h-5 w-5" /></button>
        </div>
        <div className="border-b border-[var(--border)] px-6 py-3">
          <div className="flex flex-wrap gap-1.5">
            {options.map((o) => {
              const on = picked.includes(o.id);
              return (
                <button key={o.id} onClick={() => setPicked((p) => on ? p.filter((x) => x !== o.id) : [...p, o.id])}
                  className={clsx("rounded-full px-3 py-1 text-xs font-medium transition", on ? "bg-[#c6ff34] text-[#111110]" : "bg-[var(--card-2)] text-[var(--muted)] hover:text-[var(--fg)]")}>
                  {o.name}
                </button>
              );
            })}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
          {pickedSets.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">{t("arole.comparePick")}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                  <th className="py-2 pr-3 font-semibold">{t("arole.permissions")}</th>
                  {pickedSets.map((s) => <th key={s.id} className="px-2 py-2 text-center font-semibold">{s.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {categories.map((cat) => {
                  const items = permissions.filter((p) => p.category === cat);
                  if (!items.length) return null;
                  return (
                    <Fragment key={cat}>
                      <tr><td colSpan={pickedSets.length + 1} className="pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">{t(`arole.cat.${cat}`)}</td></tr>
                      {items.map((p) => (
                        <tr key={p.key} className="border-b border-[var(--border)] last:border-0">
                          <td className="py-1.5 pr-3 text-xs">{p.label}</td>
                          {pickedSets.map((s) => (
                            <td key={s.id} className="px-2 py-1.5 text-center">
                              {s.perms.has(p.key) ? <Check className="mx-auto h-3.5 w-3.5 text-[#c6ff34]" /> : <span className="text-[var(--muted)]">—</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
