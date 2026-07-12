import { useEffect, useMemo, useState } from "react";
import Editor from "@monaco-editor/react";
import { Play, Loader2, CheckCircle2, XCircle, Eye, EyeOff } from "lucide-react";
import { api } from "@/lib/api";
import type { PublicQuestion } from "@shared/types";
import { clsx } from "clsx";

const LANG_LABEL: Record<string, string> = {
  python: "Python", javascript: "JavaScript", typescript: "TypeScript", c: "C", cpp: "C++",
  java: "Java", go: "Go", ruby: "Ruby", php: "PHP", rust: "Rust", csharp: "C#",
  html: "HTML", css: "CSS",
};
const MONACO_LANG: Record<string, string> = {
  python: "python", javascript: "javascript", typescript: "typescript", c: "c", cpp: "cpp",
  java: "java", go: "go", ruby: "ruby", php: "php", rust: "rust", csharp: "csharp",
  html: "html", css: "css",
};

// A generic demo page CSS-only answers are styled against, so a bare stylesheet
// still has something visible to preview (there's no separate markup field on
// a `code` question — a "css" question is just a stylesheet).
const CSS_PREVIEW_SCAFFOLD = `
  <div class="demo">
    <h1>Heading</h1>
    <p>Paragraph text for previewing your styles.</p>
    <button>Button</button>
    <a href="#">A link</a>
  </div>
`;

interface RunResult { stdout: string; stderr: string; output: string; code: number | null; }
interface TestRow { pass: boolean; got: string; expected: string }

/** Monaco-based code editor for `code` questions, with a Run button (custom stdin)
 *  and an optional "Run sample tests" button that checks against the visible cases. */
export function CodeAnswer({ q, value, onChange, disabled, runner }: {
  q: PublicQuestion; value: string; onChange: (v: string) => void; disabled?: boolean; runner?: boolean;
}) {
  const lang = q.codeLanguage ?? "python";
  // HTML/CSS render in the browser rather than executing on a server — they never
  // go through the Piston runner, so preview works even when codeRunner is off.
  const isMarkup = lang === "html" || lang === "css";
  const [stdin, setStdin] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [tests, setTests] = useState<TestRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(isMarkup);

  // Seed the editor with starter code the first time, if the candidate hasn't typed yet.
  useEffect(() => {
    if (!value && q.starterCode) onChange(q.starterCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const previewDoc = useMemo(() => {
    if (lang === "html") return value;
    if (lang === "css") return `<!DOCTYPE html><html><head><style>${value}</style></head><body>${CSS_PREVIEW_SCAFFOLD}</body></html>`;
    return "";
  }, [lang, value]);

  async function run() {
    setRunning(true); setErr(null); setTests(null); setResult(null);
    try { setResult(await api.post<RunResult>("/code/run", { language: lang, code: value, stdin })); }
    catch (e) { setErr((e as Error).message); }
    finally { setRunning(false); }
  }
  async function runTests() {
    if (!q.testCases?.length) return;
    setRunning(true); setErr(null); setResult(null);
    try {
      const rows: TestRow[] = [];
      for (const tc of q.testCases) {
        const r = await api.post<RunResult>("/code/run", { language: lang, code: value, stdin: tc.input });
        const got = (r.stdout || "").trim();
        rows.push({ pass: got === tc.expected.trim(), got, expected: tc.expected.trim() });
      }
      setTests(rows);
    } catch (e) { setErr((e as Error).message); }
    finally { setRunning(false); }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--muted)]">{LANG_LABEL[lang] ?? lang}</span>
        {isMarkup ? (
          <button type="button" onClick={() => setShowPreview((s) => !s)} className="btn btn-outline h-8 text-xs">
            {showPreview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />} {showPreview ? "Hide preview" : "Show preview"}
          </button>
        ) : runner && (
          <div className="flex gap-2">
            {(q.testCases?.length ?? 0) > 0 && (
              <button type="button" onClick={runTests} disabled={running || disabled} className="btn btn-outline h-8 text-xs disabled:opacity-50">Run sample tests</button>
            )}
            <button type="button" onClick={run} disabled={running || disabled} className="btn btn-primary h-8 text-xs disabled:opacity-50">
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Run
            </button>
          </div>
        )}
      </div>
      <div className={clsx("grid gap-2", isMarkup && showPreview && "sm:grid-cols-2")}>
        <div className="overflow-hidden rounded-[3px] border border-[var(--border)]">
          <Editor
            height="300px"
            theme="vs-dark"
            language={MONACO_LANG[lang] ?? "plaintext"}
            value={value}
            onChange={(v) => onChange(v ?? "")}
            loading={<div className="flex h-[300px] items-center justify-center text-sm text-[var(--muted)]"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading editor…</div>}
            options={{ readOnly: disabled, minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false, automaticLayout: true, tabSize: 2, lineNumbersMinChars: 3 }}
          />
        </div>
        {isMarkup && showPreview && (
          <iframe
            title="Live preview"
            srcDoc={previewDoc}
            sandbox=""
            className="h-[300px] w-full rounded-[3px] border border-[var(--border)] bg-white"
          />
        )}
      </div>
      {!isMarkup && runner && (
        <div>
          <label className="text-[11px] text-[var(--muted)]">Custom input (stdin)</label>
          <textarea className="input mt-1 min-h-[44px] resize-y font-mono text-xs" value={stdin} onChange={(e) => setStdin(e.target.value)} placeholder="Optional input passed to your program" />
        </div>
      )}
      {err && <p className="text-xs text-rose-400">{err}</p>}
      {result && (
        <pre className="max-h-44 overflow-auto rounded-[3px] border border-[var(--border)] bg-[var(--bg-subtle)] p-3 text-xs leading-relaxed">
          <span className="text-[var(--muted)]">Output{result.code != null ? ` · exit ${result.code}` : ""}:</span>{"\n"}{result.stdout || "(no output)"}{result.stderr ? `\n\n${result.stderr}` : ""}
        </pre>
      )}
      {tests && (
        <div className="space-y-1.5">
          {tests.map((t, i) => (
            <div key={i} className={clsx("flex items-start gap-2 rounded-[3px] border px-3 py-2 text-xs", t.pass ? "border-emerald-500/30 bg-emerald-500/10" : "border-rose-500/30 bg-rose-500/10")}>
              {t.pass ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />}
              <div className="min-w-0">
                <p className="font-medium">{t.pass ? "Passed" : "Failed"} · sample test {i + 1}</p>
                {!t.pass && <p className="mt-0.5 break-words text-[var(--muted)]">expected <code>{t.expected || "∅"}</code>, got <code>{t.got || "∅"}</code></p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
