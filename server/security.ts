import helmet from "helmet";
import rateLimit from "express-rate-limit";
import type { Request, Response, NextFunction } from "express";
import dns from "node:dns/promises";
import net from "node:net";

// Security headers (HSTS, no-sniff, frameguard, referrer policy, …) plus an
// explicit Content-Security-Policy tuned for this SPA:
//  - 'unsafe-eval' is required by the Monaco code editor (and WebAssembly);
//  - 'unsafe-inline' covers React's inline style={{…}} attributes and the
//    Tailwind/Google-Fonts stylesheet;
//  - https: lets the Monaco CDN + Google Fonts load.
// object-src/base-uri are locked down. Owning the CSP here means we override
// any stricter default the host/proxy injects (which was blocking eval).
export const securityHeaders = helmet({
  // helmet's HSTS default omits `preload`, which leaves a visitor's very first
  // request (before their browser has ever received this header over HTTPS)
  // vulnerable to SSL-stripping. `preload: true` adds the directive that's a
  // prerequisite for submitting the domain to hstspreload.org's browser-baked
  // preload list — but adding the header alone does NOT submit or enroll the
  // domain. That's a manual, deliberate step (see hstspreload.org) that should
  // only be done once every subdomain of the deployed domain is confirmed to
  // serve HTTPS permanently — removal from browsers' baked-in lists takes months.
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'", "data:", "blob:", "https:"],
      scriptSrc: ["'self'", "'unsafe-eval'", "'unsafe-inline'", "https:"],
      styleSrc: ["'self'", "'unsafe-inline'", "https:"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      fontSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https:", "wss:"],
      workerSrc: ["'self'", "blob:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"], // block clickjacking (no embedding in iframes)
      formAction: ["'self'"],     // forms can only post back to our own origin
    },
  },
});

// Permissions-Policy — explicitly ALLOW the browser features this app legitimately uses
// itself (geolocation for geofencing, camera/microphone for proctoring), scoped to our
// own origin only (no third party ever needs them — matches the CSP's frameAncestors
// 'none' / no-embedding stance). Several hosts (shared cPanel/LiteSpeed stacks especially)
// inject a locked-down default Permissions-Policy that silently disables these features —
// the browser never even shows a permission prompt, it just refuses outright — so this
// must be set explicitly to override that, not merely omitted. Mirrored in public/.htaccess
// for the same "override whatever the host injects" reason the CSP is set in both places.
export function permissionsPolicy(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("Permissions-Policy", "geolocation=(self), camera=(self), microphone=(self)");
  next();
}

// Limiter for credential endpoints — blunts brute-force / credential stuffing.
// Keyed by the ACCOUNT (email) being accessed, NOT by IP. A whole class logging in
// from one shared campus/office network (a single public IP behind NAT) would
// otherwise share one bucket and get "Too many attempts" on their first try. Keying
// by email also makes brute-forcing a single account *stronger* (capped across every
// IP). Requests without an email fall back to a per-IP key.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_RATE_LIMIT ?? 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please wait a few minutes and try again." },
  validate: false, // custom (non-IP) key — skip the built-in IPv6/proxy key validators
  keyGenerator: (req) => {
    const r = req as { body?: { email?: unknown }; ip?: string };
    const email = typeof r.body?.email === "string" ? r.body.email.trim().toLowerCase() : "";
    return email ? `auth:${email}` : `auth-ip:${r.ip ?? "unknown"}`;
  },
});

// Generous global limiter for the rest of the API — stops runaway clients without
// getting in the way of normal use (exam sessions poll frequently). Keyed by SESSION
// when signed in, so each user gets their own budget; many students behind one campus
// IP won't collectively trip a single per-IP limit. Anonymous traffic falls back to IP.
// Also recognizes the Super Admin session cookie — without this, authenticated
// super-admin traffic would fall into the shared anonymous per-IP bucket instead
// of getting its own budget like every other authenticated actor class.
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.API_RATE_LIMIT ?? 600),
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req) => {
    const r = req as { cookies?: Record<string, string>; ip?: string };
    const sess = r.cookies?.orcalis_session ?? r.cookies?.orcalis_superadmin_session;
    return sess ? `sess:${sess}` : `ip:${r.ip ?? "unknown"}`;
  },
});

// Same shape/rationale as authLimiter above, but a fully separate bucket for
// Super Admin login — a shared limiter would mean a credential-stuffing burst
// against tenant logins could exhaust the budget super-admin login itself
// relies on, or vice versa.
export const superAdminAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.SUPER_ADMIN_AUTH_RATE_LIMIT ?? 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please wait a few minutes and try again." },
  validate: false,
  keyGenerator: (req) => {
    const r = req as { body?: { email?: unknown }; ip?: string };
    const email = typeof r.body?.email === "string" ? r.body.email.trim().toLowerCase() : "";
    return email ? `superadmin-auth:${email}` : `superadmin-auth-ip:${r.ip ?? "unknown"}`;
  },
});

// Strict limiter for the 2FA code step. TOTP exposes only ~3 valid codes per window
// and backup codes are bcrypt-checked, so this endpoint must resist online brute
// force. Keyed by the short-lived pending-2FA cookie (per login attempt), else IP.
export const twoFaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.TWOFA_RATE_LIMIT ?? 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please wait a few minutes and try again." },
  validate: false,
  keyGenerator: (req) => {
    const r = req as { cookies?: Record<string, string>; ip?: string };
    const tok = r.cookies?.orcalis_2fa;
    return tok ? `2fa:${tok.slice(0, 32)}` : `2fa-ip:${r.ip ?? "unknown"}`;
  },
});

// ── SSRF guard for outbound webhook URLs ────────────────────────────────────
// Webhooks let an admin make the server issue an HTTP request, which is an SSRF
// vector (internal services, cloud metadata at 169.254.169.254, etc.). We require
// https and reject any host that is — or DNS-resolves to — a private/loopback/
// link-local/reserved address.
function isPrivateIp(ip: string): boolean {
  let addr = ip.toLowerCase();
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped IPv6
  if (mapped) addr = mapped[1];
  if (net.isIPv4(addr)) {
    const o = addr.split(".").map(Number);
    return (
      o[0] === 0 || o[0] === 10 || o[0] === 127 ||
      (o[0] === 169 && o[1] === 254) ||            // link-local incl. cloud metadata
      (o[0] === 172 && o[1] >= 16 && o[1] <= 31) ||
      (o[0] === 192 && o[1] === 168) ||
      (o[0] === 100 && o[1] >= 64 && o[1] <= 127)  // CGNAT
    );
  }
  return addr === "::1" || addr === "::" || addr.startsWith("fe80") || addr.startsWith("fc") || addr.startsWith("fd");
}

/** Synchronous shape check: https only + not a literal private IP / internal name. */
export function webhookUrlShapeOk(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (net.isIP(host) && isPrivateIp(host)) return false;
  return true;
}

/** Full check: shape + DNS resolution to public addresses (mitigates rebinding). */
export async function assertSafeWebhookUrl(raw: string): Promise<boolean> {
  if (!webhookUrlShapeOk(raw)) return false;
  const host = new URL(raw).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (net.isIP(host)) return true; // literal IP already validated public above
  try {
    const addrs = await dns.lookup(host, { all: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
  } catch {
    return false;
  }
}
