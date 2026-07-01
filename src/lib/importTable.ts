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
