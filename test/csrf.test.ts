import { describe, it, expect } from "vitest";
import { sameOriginGuard } from "../server/security.ts";

type Hdrs = Record<string, string | undefined>;
function run(method: string, headers: Hdrs) {
  let status = 0, body: unknown = null, passed = false;
  const res = { status(c: number) { status = c; return res; }, json(b: unknown) { body = b; return res; } };
  sameOriginGuard({ method, headers } as never, res as never, () => { passed = true; });
  return { passed, status, body };
}

describe("sameOriginGuard (CSRF)", () => {
  it("lets safe methods through whatever the origin", () => {
    expect(run("GET", { origin: "https://evil.example", host: "oriole.jevislab.com" }).passed).toBe(true);
    expect(run("HEAD", { origin: "https://evil.example", host: "oriole.jevislab.com" }).passed).toBe(true);
  });
  it("lets state-changing requests through when there is no Origin (curl, server-to-server)", () => {
    expect(run("POST", { host: "oriole.jevislab.com" }).passed).toBe(true);
  });
  it("lets same-origin browser requests through", () => {
    expect(run("POST", { origin: "https://oriole.jevislab.com", host: "oriole.jevislab.com" }).passed).toBe(true);
    expect(run("DELETE", { origin: "https://oriole.jevislab.com", "x-forwarded-host": "oriole.jevislab.com", host: "127.0.0.1:3000" }).passed).toBe(true);
  });
  it("blocks cross-site state-changing requests with a 403", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const r = run(method, { origin: "https://evil.example", host: "oriole.jevislab.com" });
      expect(r.passed).toBe(false);
      expect(r.status).toBe(403);
    }
  });
  it("blocks look-alike hosts and opaque/malformed origins", () => {
    expect(run("POST", { origin: "https://oriole.jevislab.com.evil.example", host: "oriole.jevislab.com" }).passed).toBe(false);
    expect(run("POST", { origin: "https://evil-oriole.jevislab.com", host: "oriole.jevislab.com" }).passed).toBe(false);
    expect(run("POST", { origin: "null", host: "oriole.jevislab.com" }).passed).toBe(false);
    expect(run("POST", { origin: "not a url", host: "oriole.jevislab.com" }).passed).toBe(false);
  });
  it("allows localhost origins outside production (Vite dev proxy rewrites Host)", () => {
    expect(run("POST", { origin: "http://localhost:5180", host: "localhost:8787" }).passed).toBe(true);
  });
});
