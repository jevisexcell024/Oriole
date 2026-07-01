// Sandboxed code execution for `code` questions.
//
// Student code is NEVER executed on our server (it shares the box that serves
// exams). Instead we proxy to a hosted Piston runner over HTTPS — the same
// outbound channel the keep-alive cron uses. If the runner is unreachable the
// caller gets a clean 502 and the student's code stays saved regardless.

// Point PISTON_URL at a reachable Piston instance. The free public emkc.org host
// became whitelist-only on 2026-02-15, so for real use self-host Piston (Docker)
// or use a whitelisted/commercial instance. PISTON_AUTH (optional) is sent as the
// Authorization header. With no working runner the /run endpoint degrades to a
// friendly "runner unavailable" message — the editor and manual grading still work.
const PISTON = (process.env.PISTON_URL || "https://emkc.org/api/v2/piston").replace(/\/$/, "");
const PISTON_AUTH = process.env.PISTON_AUTH || "";
const authHeaders = (): Record<string, string> => (PISTON_AUTH ? { Authorization: PISTON_AUTH } : {});

/** Languages we expose to authors/candidates. */
export const CODE_LANGUAGES = [
  "python", "javascript", "typescript", "c", "cpp", "java", "go", "ruby", "php", "rust", "csharp",
] as const;
export type CodeLanguage = (typeof CODE_LANGUAGES)[number];

/** Our language keys → Piston language identifiers. */
const PISTON_LANG: Record<string, string> = {
  python: "python", javascript: "javascript", typescript: "typescript",
  c: "c", cpp: "c++", java: "java", go: "go", ruby: "ruby", php: "php", rust: "rust", csharp: "csharp",
};

function cmpVer(a: string, b: string): number {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}

// Cache the runner's available versions for an hour so we don't fetch /runtimes per request.
let runtimeCache: { at: number; map: Map<string, string> } | null = null;
async function resolveVersion(pistonLang: string): Promise<string | null> {
  if (!runtimeCache || Date.now() - runtimeCache.at > 3_600_000) {
    const r = await fetch(`${PISTON}/runtimes`, { headers: authHeaders(), signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error("runtimes fetch failed");
    const list = (await r.json()) as { language: string; version: string; aliases?: string[] }[];
    const map = new Map<string, string>();
    for (const rt of list) {
      for (const key of [rt.language, ...(rt.aliases ?? [])]) {
        const prev = map.get(key);
        if (!prev || cmpVer(rt.version, prev) > 0) map.set(key, rt.version);
      }
    }
    runtimeCache = { at: Date.now(), map };
  }
  return runtimeCache.map.get(pistonLang) ?? null;
}

export interface RunResult { stdout: string; stderr: string; output: string; code: number | null; }

export async function runCode(language: string, code: string, stdin = ""): Promise<RunResult> {
  const pistonLang = PISTON_LANG[language];
  if (!pistonLang) throw new Error(`Unsupported language: ${language}`);
  const version = await resolveVersion(pistonLang);
  if (!version) throw new Error(`No runtime available for ${language}`);
  const r = await fetch(`${PISTON}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      language: pistonLang, version, stdin,
      files: [{ content: code }],
      compile_timeout: 10000, run_timeout: 8000,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`Runner error ${r.status}`);
  const j = (await r.json()) as {
    run?: { stdout?: string; stderr?: string; output?: string; code?: number };
    compile?: { stderr?: string };
  };
  const run = j.run ?? {};
  const compileErr = j.compile?.stderr ? `${j.compile.stderr}\n` : "";
  return {
    stdout: run.stdout ?? "",
    stderr: compileErr + (run.stderr ?? ""),
    output: run.output ?? "",
    code: run.code ?? null,
  };
}
