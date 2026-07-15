// Parse uploaded table files into header-keyed rows. CSV is parsed inline;
// Excel (SheetJS) and Word (mammoth) parsers are lazy-loaded so they stay out of
// the main bundle until someone actually imports a spreadsheet or document.

/** Accept string for the file inputs (CSV, Excel, Word). */
export const IMPORT_ACCEPT =
  ".csv,text/csv,.xlsx,.xls,.docx," +
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet," +
  "application/vnd.ms-excel," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Robust CSV/TSV parser -> array of objects keyed by the lower-cased header row. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let cur: string[] = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { cur.push(field); field = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; cur.push(field); rows.push(cur); cur = []; field = ""; }
    else field += c;
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }
  return rowsToObjects(rows);
}

/** Turn a 2D grid (first non-empty row = headers) into header-keyed objects. */
function rowsToObjects(grid: unknown[][]): Record<string, string>[] {
  const norm = grid.map((r) => (r ?? []).map((c) => (c == null ? "" : String(c)).trim()));
  const nonEmpty = norm.filter((r) => r.some((c) => c !== ""));
  if (nonEmpty.length < 2) return [];
  const header = nonEmpty[0].map((h) => h.toLowerCase());
  return nonEmpty.slice(1).map((r) => {
    const o: Record<string, string> = {};
    header.forEach((h, i) => { if (h) o[h] = r[i] ?? ""; });
    return o;
  });
}

async function parseXlsx(file: File): Promise<Record<string, string>[]> {
  const mod = await import("xlsx");
  const XLSX: typeof import("xlsx") = (mod as { default?: typeof import("xlsx") }).default ?? mod;
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: "" });
  return rowsToObjects(grid);
}

async function parseDocx(file: File): Promise<Record<string, string>[]> {
  const mod = await import("mammoth");
  // mammoth exposes convertToHtml on the module (or its default in ESM interop).
  const mammoth = (mod as { default?: unknown }).default ?? mod;
  const { value: html } = await (mammoth as { convertToHtml: (i: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }> })
    .convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  const dom = new DOMParser().parseFromString(html, "text/html");
  const table = dom.querySelector("table");
  if (!table) return [];
  const grid = Array.from(table.querySelectorAll("tr")).map((tr) =>
    Array.from(tr.querySelectorAll("th,td")).map((c) => (c.textContent ?? "").trim()));
  return rowsToObjects(grid);
}

/** Parse a CSV, Excel (.xlsx/.xls) or Word (.docx) file into header-keyed rows. */
export async function parseTableFile(file: File): Promise<Record<string, string>[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) return parseXlsx(file);
  if (name.endsWith(".docx")) return parseDocx(file);
  return parseCsv(await file.text());
}

// ── Student-row shape shared by every student-import flow (candidates, class rosters) ──

export interface ImportRow { name?: string; email?: string; studentClass?: string; gender?: string; age?: string; phone?: string }

/** Header-aware CSV → student rows. Falls back to name,email,class column order if no header. */
export function parseStudentCsv(text: string): ImportRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const split = (l: string) => l.split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
  const first = split(lines[0]).map((h) => h.toLowerCase());
  const hasHeader = first.includes("email") || first.includes("name");
  const headers = hasHeader ? first : ["name", "email", "class"];
  const body = (hasHeader ? lines.slice(1) : lines).map(split);
  const at = (...names: string[]) => headers.findIndex((h) => names.includes(h));
  const iN = at("name", "full name", "fullname"), iE = at("email", "e-mail"), iC = at("class", "studentclass", "student class", "cohort"), iG = at("gender", "sex"), iA = at("age"), iP = at("phone", "mobile", "tel");
  return body.map((c) => ({
    name: iN >= 0 ? c[iN] : c[0], email: iE >= 0 ? c[iE] : c[1],
    studentClass: iC >= 0 ? c[iC] : undefined, gender: iG >= 0 ? c[iG] : undefined,
    age: iA >= 0 ? c[iA] : undefined, phone: iP >= 0 ? c[iP] : undefined,
  })).filter((r) => r.name || r.email);
}

/** Map a header-keyed row (from Excel / Word) to a student row, honouring column aliases. */
export function rowToStudent(o: Record<string, string>): ImportRow {
  const get = (...keys: string[]) => { for (const k of keys) { const v = o[k]; if (v != null && String(v).trim() !== "") return String(v).trim(); } return undefined; };
  return {
    name: get("name", "full name", "fullname"),
    email: get("email", "e-mail"),
    studentClass: get("class", "studentclass", "student class", "cohort"),
    gender: get("gender", "sex"),
    age: get("age"),
    phone: get("phone", "mobile", "tel"),
  };
}

/** Parse any supported file (CSV, Excel, Word) into student rows in one call. */
export async function parseStudentFile(file: File): Promise<ImportRow[]> {
  const isSheetOrDoc = /\.(xlsx|xls|docx)$/i.test(file.name);
  const parsed = isSheetOrDoc
    ? (await parseTableFile(file)).map(rowToStudent)
    : parseStudentCsv(await file.text());
  return parsed.filter((r) => r.name || r.email);
}
