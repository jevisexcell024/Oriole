import { nanoid } from "nanoid";
import type { EmailMessage } from "../shared/types.ts";
import { emailStore } from "./db.ts";

const now = () => new Date().toISOString();

// Transport is chosen by env so the app is safe by default:
//   MAIL_TRANSPORT=mock      (default) — record to the in-app outbox only, never send.
//   MAIL_TRANSPORT=smtp      — send via SMTP_HOST/PORT/USER/PASS (SES, Mailgun, Resend, Gmail…).
//   MAIL_TRANSPORT=ethereal  — auto test inbox (catches mail, returns a preview URL; never delivered).
const MODE = (process.env.MAIL_TRANSPORT || "mock").toLowerCase();
const FROM = process.env.MAIL_FROM || "Oriole <no-reply@oriole.app>";

type Transporter = {
  sendMail: (opts: { from: string; to: string; subject: string; text: string; html?: string }) => Promise<unknown>;
  verify?: () => Promise<boolean>;
};

let transporterPromise: Promise<Transporter | null> | null = null;
let lastError: string | null = null;

async function getTransporter(): Promise<Transporter | null> {
  if (MODE === "mock") return null;
  if (!transporterPromise) {
    transporterPromise = (async () => {
      const nodemailer = (await import("nodemailer")).default;
      if (MODE === "ethereal") {
        const acct = await nodemailer.createTestAccount();
        return nodemailer.createTransport({
          host: "smtp.ethereal.email", port: 587, secure: false,
          auth: { user: acct.user, pass: acct.pass },
        }) as unknown as Transporter;
      }
      return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === "true",
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        // Reuse SMTP connections instead of a fresh handshake per message — a bulk
        // student import can send dozens/hundreds of invitation emails back to back.
        pool: true,
        maxConnections: 5,
        maxMessages: 100,
      }) as unknown as Transporter;
    })().catch((e: unknown) => { lastError = (e as Error).message; return null; });
  }
  return transporterPromise;
}

export function mailerStatus() {
  return {
    mode: MODE,
    live: MODE !== "mock",
    from: FROM,
    host: MODE === "smtp" ? (process.env.SMTP_HOST ?? null) : MODE === "ethereal" ? "smtp.ethereal.email" : null,
    lastError,
  };
}

/** Verify the SMTP connection is working — call once at startup when MODE=smtp. */
export async function verifySmtp(): Promise<{ ok: boolean; error: string | null }> {
  if (MODE !== "smtp") return { ok: true, error: null };
  try {
    const t = await getTransporter();
    if (!t) return { ok: false, error: "Transporter failed to initialise" };
    if (typeof t.verify === "function") await t.verify();
    return { ok: true, error: null };
  } catch (e) {
    const msg = (e as Error).message;
    lastError = msg;
    return { ok: false, error: msg };
  }
}

// ── HTML email template ───────────────────────────────────────────────────────
/**
 * Escape a value for safe interpolation into email HTML. Any dynamic value that
 * originates from a user (names, exam titles, emails, credentials) MUST be passed
 * through this before being placed in an HTML template — otherwise a value like
 * `<a href="…">` injected into a display name renders as live markup in the
 * recipient's inbox (a phishing / content-spoofing vector, and broken rendering
 * for perfectly innocent names containing & or <).
 */
export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Inline styles only — most email clients strip <head> stylesheets.
export function buildHtml(bodyHtml: string, to: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f3f4f6">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f3f4f6;padding:32px 16px">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden">
      <tr>
        <td style="background:#111110;padding:20px 28px">
          <span style="font-size:20px;font-weight:700;color:#c6ff34;letter-spacing:-.3px">Oriole</span>
          <span style="font-size:12px;color:#6b7280;margin-left:8px">Secure Examinations</span>
        </td>
      </tr>
      <tr>
        <td style="padding:28px 28px 24px;font-size:14px;color:#374151;line-height:1.6">
          ${bodyHtml}
        </td>
      </tr>
      <tr>
        <td style="padding:14px 28px;border-top:1px solid #f0f0f0;background:#fafafa">
          <p style="margin:0;font-size:11px;color:#9ca3af">Sent to ${esc(to)}. If you didn't expect this email, you can ignore it.</p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

/** Render a primary CTA button. `href` is always an app-internal, server-built URL;
 *  `label` is escaped in case a caller ever passes dynamic text. */
export function ctaButton(label: string, href: string): string {
  return `<p style="margin:20px 0 0">
    <a href="${esc(href)}" style="display:inline-block;background:#c6ff34;color:#000000;font-weight:700;font-size:14px;padding:11px 22px;border-radius:6px;text-decoration:none">${esc(label)}</a>
  </p>`;
}

// ── Send ─────────────────────────────────────────────────────────────────────

export interface SendResult {
  delivery: "logged" | "sent" | "failed";
  error: string | null;
  previewUrl: string | null;
}

/**
 * Send (or, in mock mode, just record) one message. Always writes to the in-app
 * outbox so the message log is complete regardless of transport.
 *
 * When a real transport is configured it delivers via SMTP with one automatic
 * retry (after 3 s) for transient connection failures.
 */
export async function sendMail(
  to: string,
  subject: string,
  text: string,
  html?: string,
  tenantId?: string,
): Promise<SendResult> {
  let delivery: SendResult["delivery"] = "logged";
  let error: string | null = null;
  let previewUrl: string | null = null;

  const transporter = await getTransporter();
  if (transporter) {
    const attempt = async () => transporter.sendMail({ from: FROM, to, subject, text, html });
    try {
      const info = await attempt();
      delivery = "sent";
      const nodemailer = (await import("nodemailer")).default;
      previewUrl = nodemailer.getTestMessageUrl(info as never) || null;
    } catch (e) {
      // One retry after 3 s for transient errors (connection reset, timeout, etc.)
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const info = await attempt();
        delivery = "sent";
        const nodemailer = (await import("nodemailer")).default;
        previewUrl = nodemailer.getTestMessageUrl(info as never) || null;
      } catch (e2) {
        delivery = "failed";
        error = (e2 as Error).message;
        lastError = error;
      }
    }
  }

  const msg: EmailMessage = {
    id: nanoid(10), tenantId, to, subject,
    body: text,
    sentAt: now(),
    delivery, error, provider: transporter ? MODE : "mock",
  };
  // A failure here is a logging problem, not a delivery problem — don't let it
  // turn an otherwise-successful send into a rejected promise for the caller
  // (a caller looping over many recipients would otherwise abort the rest of
  // the batch on one transient outbox-write error).
  try { await emailStore.add(msg); } catch { /* best-effort log */ }
  return { delivery, error, previewUrl };
}
