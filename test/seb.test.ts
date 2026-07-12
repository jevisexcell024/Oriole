import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import type { Request } from "express";
import { verifySeb, absoluteUrl } from "../server/seb.ts";
import { DEFAULT_LOCKDOWN, type Exam } from "../shared/types.ts";

const sha256 = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

function mkReq(headers: Record<string, string>, originalUrl = "/api/attempts/abc"): Request {
  return { headers, originalUrl, protocol: "https" } as unknown as Request;
}

function mkExam(lockdown: Partial<Exam["lockdown"]>): Exam {
  return {
    id: "e1", title: "T", code: "C", description: "", durationMinutes: 10, passingScore: 50,
    proctored: true, status: "published", enrollment: "open",
    lockdown: { ...DEFAULT_LOCKDOWN, ...lockdown }, createdAt: "2026-01-01T00:00:00Z",
  } as Exam;
}

const CONFIG_KEY = "a".repeat(64);
const BEK = "b".repeat(64);
const HOST = "oriole.jevislab.com";

describe("verifySeb", () => {
  it("passes through when the exam doesn't require SEB", () => {
    const exam = mkExam({ requireSafeExamBrowser: false });
    expect(verifySeb(mkReq({ host: HOST }), exam).ok).toBe(true);
  });

  it("rebuilds the absolute URL from proxy headers", () => {
    const req = mkReq({ "x-forwarded-proto": "https", "x-forwarded-host": HOST }, "/api/attempts/abc?x=1");
    expect(absoluteUrl(req)).toBe(`https://${HOST}/api/attempts/abc?x=1`);
  });

  it("accepts a correct Config Key hash", () => {
    const exam = mkExam({ requireSafeExamBrowser: true, sebConfigKeys: [CONFIG_KEY] });
    const url = `https://${HOST}/api/attempts/abc`;
    const req = mkReq({ host: HOST, "x-safeexambrowser-configkeyhash": sha256(url + CONFIG_KEY) });
    expect(verifySeb(req, exam).ok).toBe(true);
  });

  it("accepts a correct Browser Exam Key hash", () => {
    const exam = mkExam({ requireSafeExamBrowser: true, sebConfigKeys: [], sebBrowserExamKeys: [BEK] });
    const url = `https://${HOST}/api/attempts/abc`;
    const req = mkReq({ host: HOST, "x-safeexambrowser-requesthash": sha256(url + BEK) });
    expect(verifySeb(req, exam).ok).toBe(true);
  });

  it("rejects when SEB headers are missing", () => {
    const exam = mkExam({ requireSafeExamBrowser: true, sebConfigKeys: [CONFIG_KEY] });
    const r = verifySeb(mkReq({ host: HOST }), exam);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Safe Exam Browser/i);
  });

  it("rejects a wrong/forged hash", () => {
    const exam = mkExam({ requireSafeExamBrowser: true, sebConfigKeys: [CONFIG_KEY] });
    const req = mkReq({ host: HOST, "x-safeexambrowser-configkeyhash": sha256("https://evil.test/x" + CONFIG_KEY) });
    expect(verifySeb(req, exam).ok).toBe(false);
  });

  it("fails closed when SEB is required but no key is configured", () => {
    const exam = mkExam({ requireSafeExamBrowser: true, sebConfigKeys: [], sebBrowserExamKeys: [] });
    const url = `https://${HOST}/api/attempts/abc`;
    const req = mkReq({ host: HOST, "x-safeexambrowser-configkeyhash": sha256(url + CONFIG_KEY) });
    const r = verifySeb(req, exam);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no SEB key/i);
  });

  it("matches the hash case-insensitively (SEB may send upper or lower hex)", () => {
    const exam = mkExam({ requireSafeExamBrowser: true, sebConfigKeys: [CONFIG_KEY] });
    const url = `https://${HOST}/api/attempts/abc`;
    const req = mkReq({ host: HOST, "x-safeexambrowser-configkeyhash": sha256(url + CONFIG_KEY).toUpperCase() });
    expect(verifySeb(req, exam).ok).toBe(true);
  });
});
