import jwt from "jsonwebtoken";
import fs from "node:fs";
import { createHash, createPrivateKey, createPublicKey, randomBytes, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { env } from "./env.ts";

// Microsoft (Entra ID) sign-in for the student portal, via OpenID Connect: the authorization-code
// flow with PKCE. No extra dependency — the ID token is verified here against Microsoft's published
// signing keys. Switched on by setting MS_CLIENT_ID, MS_TENANT and ONE way for this app to prove
// itself to Microsoft: a client secret (MS_CLIENT_SECRET) or a certificate (MS_CLIENT_CERT_KEY_PATH
// or MS_CLIENT_CERT_KEY, plus MS_CLIENT_CERT_THUMBPRINT). See .env.example.

const TXN_COOKIE = "orcalis_sso";
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface MicrosoftConfig {
  clientId: string;
  tenant: string;
  /** Set when the app registration uses a client secret. */
  clientSecret?: string;
  /** Set when it uses a certificate: the private key (PEM) and the certificate's thumbprint (hex). */
  certificate?: { privateKey: string; thumbprint: string };
}

let warnedBadCert = false;
function certificateFromEnv(): MicrosoftConfig["certificate"] | null {
  const path = process.env.MS_CLIENT_CERT_KEY_PATH?.trim();
  const inline = process.env.MS_CLIENT_CERT_KEY?.trim();
  const thumbprint = (process.env.MS_CLIENT_CERT_THUMBPRINT ?? "").replace(/[^0-9a-f]/gi, "").toLowerCase();
  if ((!path && !inline) || !thumbprint) return null;
  try {
    const privateKey = path ? fs.readFileSync(path, "utf8") : inline!.replace(/\\n/g, "\n");
    createPrivateKey(privateKey); // throws if it isn't a usable PEM private key
    if (thumbprint.length !== 40 && thumbprint.length !== 64) throw new Error("thumbprint must be 40 (SHA-1) or 64 (SHA-256) hex characters");
    return { privateKey, thumbprint };
  } catch (e) {
    if (!warnedBadCert) { warnedBadCert = true; console.warn(`Microsoft SSO disabled: certificate settings are not usable (${(e as Error).message}).`); }
    return null;
  }
}

/** null (SSO off) unless the client id, a directory and a credential (certificate preferred, else
 *  secret) are present. The tenant must be the directory's GUID, not "common"/"organizations":
 *  accepting sign-ins from any Microsoft directory would let anyone with a Microsoft account claim
 *  an email address in it. */
export function microsoftConfig(): MicrosoftConfig | null {
  const clientId = process.env.MS_CLIENT_ID?.trim();
  const clientSecret = process.env.MS_CLIENT_SECRET?.trim();
  const tenant = process.env.MS_TENANT?.trim();
  if (!clientId || !tenant || !GUID.test(tenant)) return null;
  const certificate = certificateFromEnv();
  if (!certificate && !clientSecret) return null;
  return { clientId, tenant: tenant.toLowerCase(), ...(certificate ? { certificate } : { clientSecret }) };
}

/** The signed proof of identity sent in place of a client secret: a short-lived JWT, signed with the
 *  certificate's private key, naming the certificate by thumbprint in its header. */
export function clientAssertion(cfg: MicrosoftConfig): string {
  const cert = cfg.certificate!;
  const bytes = Buffer.from(cert.thumbprint, "hex").toString("base64url");
  return jwt.sign({}, cert.privateKey, {
    algorithm: "RS256",
    header: { alg: "RS256", typ: "JWT", ...(cert.thumbprint.length === 64 ? { "x5t#S256": bytes } : { x5t: bytes }) },
    audience: `${authority(cfg.tenant)}/oauth2/v2.0/token`,
    issuer: cfg.clientId, subject: cfg.clientId, jwtid: randomUUID(), expiresIn: "5m",
  });
}

export const microsoftRedirectUri = () => process.env.MS_REDIRECT_URI?.trim() || `${env.appUrl}/api/auth/sso/microsoft/callback`;
const authority = (tenant: string) => `https://login.microsoftonline.com/${tenant}`;
const sha256b64url = (s: string) => createHash("sha256").update(s).digest("base64url");

/** Starts a sign-in: remembers state/nonce/PKCE verifier in a short-lived signed cookie, returns the
 *  Microsoft URL to send the browser to. */
export function beginMicrosoftSignIn(res: Response, cfg: MicrosoftConfig): string {
  const state = randomBytes(16).toString("base64url");
  const nonce = randomBytes(16).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  res.cookie(TXN_COOKIE, jwt.sign({ state, nonce, verifier }, env.jwtSecret, { expiresIn: "10m" }), {
    httpOnly: true, sameSite: "lax", secure: env.isProd, maxAge: 10 * 60 * 1000,
  });
  const q = new URLSearchParams({
    client_id: cfg.clientId, response_type: "code", redirect_uri: microsoftRedirectUri(), response_mode: "query",
    scope: "openid profile email", state, nonce, code_challenge: sha256b64url(verifier), code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `${authority(cfg.tenant)}/oauth2/v2.0/authorize?${q}`;
}

export function readSignInTxn(req: Request): { state: string; nonce: string; verifier: string } | null {
  const token = req.cookies?.[TXN_COOKIE];
  if (!token) return null;
  try { return jwt.verify(token, env.jwtSecret) as { state: string; nonce: string; verifier: string }; } catch { return null; }
}
export const clearSignInTxn = (res: Response) => { res.clearCookie(TXN_COOKIE); };

export async function exchangeMicrosoftCode(cfg: MicrosoftConfig, code: string, verifier: string): Promise<string> {
  const r = await fetch(`${authority(cfg.tenant)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId, grant_type: "authorization_code", code,
      redirect_uri: microsoftRedirectUri(), code_verifier: verifier, scope: "openid profile email",
      ...(cfg.certificate
        ? { client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer", client_assertion: clientAssertion(cfg) }
        : { client_secret: cfg.clientSecret! }),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await r.json().catch(() => ({})) as { id_token?: string };
  if (!r.ok || !body.id_token) throw new Error(`token exchange failed (${r.status})`);
  return body.id_token;
}

interface Jwk { kid?: string; kty: string; [k: string]: unknown }
let jwksCache: { tenant: string; at: number; keys: Jwk[] } | null = null;
async function signingKeys(tenant: string, force = false): Promise<Jwk[]> {
  if (!force && jwksCache && jwksCache.tenant === tenant && Date.now() - jwksCache.at < 60 * 60 * 1000) return jwksCache.keys;
  const r = await fetch(`${authority(tenant)}/discovery/v2.0/keys`, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`could not fetch signing keys (${r.status})`);
  const { keys } = await r.json() as { keys: Jwk[] };
  jwksCache = { tenant, at: Date.now(), keys };
  return keys;
}
export const resetSigningKeyCache = () => { jwksCache = null; };

export interface MicrosoftIdentity { subject: string; email: string; name: string | null }

/** Auto-creating a student account on their first Microsoft sign-in is opt-in
 *  (MS_AUTO_CREATE_STUDENTS=true) and needs a domain allow-list (MS_ALLOWED_EMAIL_DOMAINS, comma
 *  separated, e.g. "school.edu.gh"). Sign-in is already limited to the school's own directory, but a
 *  directory can also hold invited outside guests (personal Gmail etc.) — the allow-list keeps
 *  them out. Returns the allowed domains, or null when auto-creation is off. */
export function autoCreateDomains(): string[] | null {
  if (process.env.MS_AUTO_CREATE_STUDENTS?.trim().toLowerCase() !== "true") return null;
  const domains = (process.env.MS_ALLOWED_EMAIL_DOMAINS ?? "").split(",").map((s) => s.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
  return domains.length ? domains : null;
}

/** True when the email's domain is on the allow-list and it isn't a guest-account address. */
export function emailInDomains(email: string, domains: string[]): boolean {
  const e = email.trim().toLowerCase();
  return !e.includes("#ext#") && domains.includes(e.split("@").pop() ?? "");
}

/** A readable name for a brand-new account: Microsoft's display name, else the part before the @. */
export function displayNameFor(who: MicrosoftIdentity): string {
  return (who.name?.trim() || who.email.split("@")[0].replace(/[._-]+/g, " ")).slice(0, 120);
}

/** Checks the ID token's signature, issuer, audience, expiry, nonce and directory, and returns who it
 *  says signed in. `subject` is tenant + object id — stable for the person, unlike their email. */
export async function verifyMicrosoftIdToken(cfg: MicrosoftConfig, idToken: string, nonce: string): Promise<MicrosoftIdentity> {
  const kid = (jwt.decode(idToken, { complete: true })?.header as { kid?: string } | undefined)?.kid;
  let key = (await signingKeys(cfg.tenant)).find((k) => k.kid === kid);
  if (!key) key = (await signingKeys(cfg.tenant, true)).find((k) => k.kid === kid); // keys rotate
  if (!key) throw new Error("unknown signing key");
  const p = jwt.verify(idToken, createPublicKey({ key: key as never, format: "jwk" }), {
    algorithms: ["RS256"], audience: cfg.clientId, issuer: `${authority(cfg.tenant)}/v2.0`,
  }) as { nonce?: string; tid?: string; oid?: string; email?: string; preferred_username?: string; name?: string };
  if (p.nonce !== nonce) throw new Error("nonce mismatch");
  if (p.tid?.toLowerCase() !== cfg.tenant) throw new Error("wrong directory");
  if (!p.oid) throw new Error("no object id");
  const email = String(p.email || p.preferred_username || "").trim().toLowerCase();
  if (!email.includes("@")) throw new Error("no email in token");
  return { subject: `${cfg.tenant}:${p.oid}`, email, name: p.name ?? null };
}
