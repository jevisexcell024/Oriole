import crypto from "node:crypto";
import type { Request } from "express";
import type { Exam } from "../shared/types.ts";

// ── Safe Exam Browser request verification ──────────────────────────────────
//
// SEB proves a request originated from a locked-down browser session by sending
// a hash header on every request. Per the SEB spec, for the Config Key:
//
//     X-SafeExamBrowser-ConfigKeyHash = SHA256( absoluteURL + ConfigKey )
//
// and analogously for the Browser Exam Key:
//
//     X-SafeExamBrowser-RequestHash   = SHA256( absoluteURL + BrowserExamKey )
//
// where `absoluteURL` is the full request URL (scheme://host/path?query) with
// any `#fragment` removed, UTF-8 encoded. The server recomputes the hash with
// the key(s) the admin configured for the exam and compares. A web page can't
// forge this, so it's the real gate that makes screenshot/recording/app-switch
// prevention effective.

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

function timingSafeEqHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Rebuild the absolute URL SEB hashed — honouring the proxy headers LiteSpeed
 *  sets in production — and strip any fragment. */
export function absoluteUrl(req: Request): string {
  const fwdProto = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim();
  const fwdHost = String(req.headers["x-forwarded-host"] ?? "").split(",")[0].trim();
  const proto = fwdProto || req.protocol || "https";
  const host = fwdHost || req.headers.host || "";
  const url = `${proto}://${host}${req.originalUrl}`;
  const hashAt = url.indexOf("#");
  return hashAt === -1 ? url : url.slice(0, hashAt);
}

export interface SebCheck {
  ok: boolean;
  /** Human-readable reason when `ok` is false. */
  reason?: string;
}

/**
 * Verify a request against an exam's SEB requirement.
 * - Returns ok when the exam doesn't require SEB.
 * - When it does, requires a valid Config Key OR Browser Exam Key hash.
 * - Fails closed if SEB is required but no key is configured.
 */
export function verifySeb(req: Request, exam: Exam | undefined): SebCheck {
  const ld = exam?.lockdown;
  if (!ld?.requireSafeExamBrowser) return { ok: true };

  const configKeys = (ld.sebConfigKeys ?? []).map((k) => k.trim().toLowerCase()).filter(Boolean);
  const bekKeys = (ld.sebBrowserExamKeys ?? []).map((k) => k.trim().toLowerCase()).filter(Boolean);
  if (configKeys.length === 0 && bekKeys.length === 0) {
    return { ok: false, reason: "This exam requires Safe Exam Browser, but no SEB key has been configured. Contact your administrator." };
  }

  const url = absoluteUrl(req);
  const configHash = String(req.headers["x-safeexambrowser-configkeyhash"] ?? "").toLowerCase();
  const requestHash = String(req.headers["x-safeexambrowser-requesthash"] ?? "").toLowerCase();

  if (!configHash && !requestHash) {
    return { ok: false, reason: "This exam must be opened in Safe Exam Browser." };
  }

  const okConfig = !!configHash && configKeys.some((key) => timingSafeEqHex(sha256Hex(url + key), configHash));
  const okBek = !!requestHash && bekKeys.some((key) => timingSafeEqHex(sha256Hex(url + key), requestHash));
  if (okConfig || okBek) return { ok: true };

  return { ok: false, reason: "Safe Exam Browser verification failed — the browser configuration doesn't match this exam." };
}
