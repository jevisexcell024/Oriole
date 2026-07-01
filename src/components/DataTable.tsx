import { useMemo, useState, type ReactNode } from "react";
import { Search, ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight, Download, Filter } from "lucide-react";
import { clsx } from "clsx";

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Provide to make the column sortable (returns a comparable value). */
  sortValue?: (row: T) => string | number;
  /** Provide to include the column in CSV export. */
  csv?: (row: T) => string;
  th?: string;   // header cell className (e.g. "text-right", "hidden md:table-cell")
  td?: string;   // body cell className
}

export interface TableFilter<T> {
  id: string;
  label: string;
  options: { value: string; label: string }[];
  match: (row: T, value: string) => boolean;
}

interface Props<T> {
  rows: T[];
  columns: Column<T>[];
  getId: (row: T) => string;
  /** Text used for the search box match. */
  searchText?: (row: T) => string;
  searchPlaceholder?: string;
  filters?: TableFilter<T>[];
  pageSize?: number;
  selectable?: boolean;
  /** Rendered (with the selected rows) when one or more rows are selected. */
  bulkActions?: (selected: T[], clear: () => void) => ReactNode;
  /** Filename (without extension) — enables the CSV export button. */
  exportName?: string;
  onRowClick?: (row: T) => void;
  initialSort?: { key: string; dir: "asc" | "desc" };
  empty?: ReactNode;
}

function toCsv<T>(rows: T[], cols: Column<T>[]): string {
  const exp = cols.filter((c) => c.csv);
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const header = exp.map((c) => esc(c.header)).join(",");
  const lines = rows.map((r) => exp.map((c) => esc(String(c.csv!(r)))).join(","));
  return [header, ...lines].join("\n");
}

export function DataTable<T>({
  rows, columns, getId, searchText, searchPlaceholder = "Search…", filters = [],
  pageSize = 10, selectable, bulkActions, exportName, onRowClick, initialSort, empty,
}: Props<T>) {
  const [q, setQ] = useState("");
  const [filterVals, setFilterVals] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(initialSort ?? null);
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (query && searchText && !searchText(r).toLowerCase().includes(query)) return false;
      for (const f of filters) {
        const v = filterVals[f.id];
        if (v && !f.match(r, v)) return false;
      }
      return true;
    });
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col?.sortValue) {
        const sv = col.sortValue;
        out = [...out].sort((a, b) => {
          const av = sv(a), bv = sv(b);
          const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
          return sort.dir === "asc" ? cmp : -cmp;
        });
      }
    }
    return out;
  }, [rows, q, filterVals, sort, columns, filters, searchText]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pages - 1);
  const shown = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize);

  const reset = () => setPage(0);
  const toggleSort = (key: string) => {
    setSort((s) => (s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
    reset();
  };
  const selectedRows = filtered.filter((r) => sel.has(getId(r)));
  const allOnPageSelected = shown.length > 0 && shown.every((r) => sel.has(getId(r)));
  const toggleAll = () => {
    setSel((cur) => {
      const next = new Set(cur);
      if (allOnPageSelected) shown.forEach((r) => next.delete(getId(r)));
      else shown.forEach((r) => next.add(getId(r)));
      return next;
    });
  };
  const toggleOne = (id: string) => setSel((cur) => { const n = new Set(cur); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const clearSel = () => setSel(new Set());

  const exportCsv = () => {
    const data = selectedRows.length ? selectedRows : filtered;
    const blob = new Blob([toCsv(data, columns)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${exportName}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {searchText && (
          <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card-2)] px-3 py-2">
            <Search className="h-4 w-4 text-[var(--muted)]" />
            <input value={q} onChange={(e) => { setQ(e.target.value); reset(); }} placeholder={searchPlaceholder} className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--muted)]" />
          </div>
        )}
        {filters.map((f) => (
          <div key={f.id} className="relative">
            <Filter className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted)]" />
            <select value={filterVals[f.id] ?? ""} onChange={(e) => { setFilterVals((v) => ({ ...v, [f.id]: e.target.value })); reset(); }}
              className="h-10 rounded-lg border border-[var(--border)] bg-[var(--card-2)] pl-8 pr-7 text-sm font-medium outline-none">
              <option value="">{f.label}</option>
              {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        ))}
        {exportName && (
          <button onClick={exportCsv} className="btn btn-outline h-10" title="Export to CSV">
            <Download className="h-4 w-4" /> Export
          </button>
        )}
      </div>

      {/* Bulk action bar */}
      {selectable && selectedRows.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-[#c6ff34]/40 bg-[rgba(198,255,52,0.08)] px-3 py-2 text-sm">
          <span className="font-semibold">{selectedRows.length} selected</span>
          <div className="ml-auto flex items-center gap-2">
            {bulkActions?.(selectedRows, clearSel)}
            <button onClick={clearSel} className="text-xs font-medium text-[var(--muted)] hover:text-[var(--fg)]">Clear</button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="card overflow-hidden rounded-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--card-2)] text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
                {selectable && (
                  <th className="w-10 px-4 py-2.5">
                    <input type="checkbox" className="h-3.5 w-3.5 accent-[#c6ff34]" checked={allOnPageSelected} onChange={toggleAll} />
                  </th>
                )}
                {columns.map((c) => (
                  <th key={c.key} className={clsx("px-4 py-2.5 font-semibold", c.th)}>
                    {c.sortValue ? (
                      <button onClick={() => toggleSort(c.key)} className="inline-flex items-center gap-1 hover:text-[var(--fg)]">
                        {c.header}
                        {sort?.key === c.key ? (sort.dir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />) : <ChevronsUpDown className="h-3 w-3 opacity-50" />}
                      </button>
                    ) : c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr><td colSpan={columns.length + (selectable ? 1 : 0)} className="px-4 py-12 text-center text-[var(--muted)]">{empty ?? "No rows match your filters."}</td></tr>
              ) : shown.map((r) => {
                const id = getId(r);
                return (
                  <tr key={id} onClick={onRowClick ? () => onRowClick(r) : undefined}
                    className={clsx("border-b border-[var(--border)] last:border-0 transition", onRowClick && "cursor-pointer", "hover:bg-[var(--card-2)]", sel.has(id) && "bg-[rgba(198,255,52,0.06)]")}>
                    {selectable && (
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" className="h-3.5 w-3.5 accent-[#c6ff34]" checked={sel.has(id)} onChange={() => toggleOne(id)} />
                      </td>
                    )}
                    {columns.map((c) => <td key={c.key} className={clsx("px-4 py-3", c.td)}>{c.render(r)}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer / pagination */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] px-4 py-2.5 text-xs text-[var(--muted)]">
          <span>{filtered.length} {filtered.length === 1 ? "row" : "rows"}{filtered.length > pageSize ? ` · page ${safePage + 1} of ${pages}` : ""}</span>
          {pages > 1 && (
            <div className="flex items-center gap-1">
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={safePage === 0} className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border)] disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
              <button onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={safePage >= pages - 1} className="flex h-7 w-7 items-center justify-center rounded-lg text-white disabled:opacity-40" style={{ background: "#111110" }}><ChevronRight className="h-4 w-4" /></button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
