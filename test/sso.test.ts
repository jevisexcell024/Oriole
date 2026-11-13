import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import jwt from "jsonwebtoken";
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { microsoftConfig, verifyMicrosoftIdToken, resetSigningKeyCache, clientAssertion, exchangeMicrosoftCode, autoCreateDomains, emailInDomains, displayNameFor, type MicrosoftConfig } from "../server/sso.ts";

const TENANT = "11111111-2222-3333-4444-555555555555";
const cfg: MicrosoftConfig = { clientId: "client-abc", clientSecret: "s3cret", tenant: TENANT };

let privateKey: KeyObject;
beforeAll(() => {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  privateKey = pair.privateKey;
  const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1", use: "sig", alg: "RS256" };
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200 })));
});
afterEach(() => resetSigningKeyCache());

function idToken(claims: Record<string, unknown> = {}, opts: { aud?: string; iss?: string } = {}) {
  return jwt.sign(
    { tid: TENANT, oid: "oid-1", nonce: "n1", email: "Student@School.edu", name: "Stu Dent", ...claims },
    privateKey,
    { algorithm: "RS256", keyid: "k1", audience: opts.aud ?? cfg.clientId, issuer: opts.iss ?? `https://login.microsoftonline.com/${TENANT}/v2.0`, expiresIn: "5m" },
  );
}

describe("microsoftConfig", () => {
  it("is off unless all three settings are present, and the tenant is a GUID", () => {
    const save = { ...process.env };
    try {
      delete process.env.MS_CLIENT_ID; delete process.env.MS_CLIENT_SECRET; delete process.env.MS_TENANT;
      expect(microsoftConfig()).toBeNull();
      process.env.MS_CLIENT_ID = "a"; process.env.MS_CLIENT_SECRET = "b"; process.env.MS_TENANT = "organizations";
      expect(microsoftConfig()).toBeNull(); // "any directory" is refused
      process.env.MS_TENANT = TENANT.toUpperCase();
      expect(microsoftConfig()).toEqual({ clientId: "a", clientSecret: "b", tenant: TENANT });
    } finally { process.env = save; }
  });
});

describe("verifyMicrosoftIdToken", () => {
  it("accepts a valid token and returns a stable subject + lowercased email", async () => {
    const who = await verifyMicrosoftIdToken(cfg, idToken(), "n1");
    expect(who).toEqual({ subject: `${TENANT}:oid-1`, email: "student@school.edu", name: "Stu Dent" });
  });
  it("falls back to preferred_username when there's no email claim", async () => {
    const who = await verifyMicrosoftIdToken(cfg, idToken({ email: undefined, preferred_username: "upn@school.edu" }), "n1");
    expect(who.email).toBe("upn@school.edu");
  });
  it("rejects a wrong nonce", async () => {
    await expect(verifyMicrosoftIdToken(cfg, idToken(), "other")).rejects.toThrow(/nonce/);
  });
  it("rejects a token from a different directory", async () => {
    await expect(verifyMicrosoftIdToken(cfg, idToken({ tid: "99999999-2222-3333-4444-555555555555" }), "n1")).rejects.toThrow(/directory/);
  });
  it("rejects a token for another app, another issuer, or signed with another key", async () => {
    await expect(verifyMicrosoftIdToken(cfg, idToken({}, { aud: "someone-else" }), "n1")).rejects.toThrow();
    await expect(verifyMicrosoftIdToken(cfg, idToken({}, { iss: "https://evil.example/v2.0" }), "n1")).rejects.toThrow();
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    const forged = jwt.sign({ tid: TENANT, oid: "x", nonce: "n1", email: "a@b.c" }, other, { algorithm: "RS256", keyid: "k1", audience: cfg.clientId, issuer: `https://login.microsoftonline.com/${TENANT}/v2.0` });
    await expect(verifyMicrosoftIdToken(cfg, forged, "n1")).rejects.toThrow();
  });
  it("rejects a token with no email", async () => {
    await expect(verifyMicrosoftIdToken(cfg, idToken({ email: undefined }), "n1")).rejects.toThrow(/email/);
  });
});

describe("certificate credential (no client secret)", () => {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const thumb = "aa".repeat(20); // 40 hex = SHA-1 thumbprint
  const setEnv = (extra: Record<string, string | undefined>) => {
    for (const k of ["MS_CLIENT_ID", "MS_CLIENT_SECRET", "MS_TENANT", "MS_CLIENT_CERT_KEY", "MS_CLIENT_CERT_KEY_PATH", "MS_CLIENT_CERT_THUMBPRINT"]) delete process.env[k];
    Object.assign(process.env, { MS_CLIENT_ID: "client-abc", MS_TENANT: TENANT }, extra);
  };

  it("turns SSO on with a certificate and no secret; accepts a colon-separated thumbprint and \\n-escaped key", () => {
    const save = { ...process.env };
    try {
      setEnv({ MS_CLIENT_CERT_KEY: pem.replace(/\n/g, "\\n"), MS_CLIENT_CERT_THUMBPRINT: thumb.match(/../g)!.join(":").toUpperCase() });
      const c = microsoftConfig()!;
      expect(c.certificate?.thumbprint).toBe(thumb);
      expect(c.clientSecret).toBeUndefined();
    } finally { process.env = save; }
  });
  it("stays off when the key or thumbprint is unusable and there is no secret", () => {
    const save = { ...process.env };
    try {
      setEnv({ MS_CLIENT_CERT_KEY: "not a key", MS_CLIENT_CERT_THUMBPRINT: thumb });
      expect(microsoftConfig()).toBeNull();
      setEnv({ MS_CLIENT_CERT_KEY: pem, MS_CLIENT_CERT_THUMBPRINT: "abcd" });
      expect(microsoftConfig()).toBeNull();
      setEnv({ MS_CLIENT_CERT_KEY: pem, MS_CLIENT_CERT_THUMBPRINT: "abcd", MS_CLIENT_SECRET: "fallback" });
      expect(microsoftConfig()?.clientSecret).toBe("fallback"); // a working secret still works
    } finally { process.env = save; }
  });
  it("signs a client assertion Microsoft can verify, naming the certificate by thumbprint", () => {
    const certCfg: MicrosoftConfig = { clientId: "client-abc", tenant: TENANT, certificate: { privateKey: pem, thumbprint: thumb } };
    const token = clientAssertion(certCfg);
    const p = jwt.verify(token, pair.publicKey, { algorithms: ["RS256"], audience: `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, issuer: "client-abc", subject: "client-abc" }) as { jti?: string; exp: number; iat: number };
    expect(p.jti).toBeTruthy();
    expect(p.exp - p.iat).toBeLessThanOrEqual(300);
    expect((jwt.decode(token, { complete: true })!.header as { x5t?: string }).x5t).toBe(Buffer.from(thumb, "hex").toString("base64url"));
  });
  it("sends the assertion, not a secret, when exchanging the code", async () => {
    const certCfg: MicrosoftConfig = { clientId: "client-abc", tenant: TENANT, certificate: { privateKey: pem, thumbprint: thumb } };
    const previous = globalThis.fetch;
    const spy = vi.fn(async (_url: unknown, init?: { body?: URLSearchParams }) => { void init; return new Response(JSON.stringify({ id_token: "t" }), { status: 200 }); });
    vi.stubGlobal("fetch", spy);
    try {
      expect(await exchangeMicrosoftCode(certCfg, "the-code", "verifier")).toBe("t");
      const body = spy.mock.calls[0][1]!.body as URLSearchParams;
      expect(body.get("client_assertion_type")).toBe("urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
      expect(body.get("client_assertion")).toBeTruthy();
      expect(body.has("client_secret")).toBe(false);
    } finally { vi.stubGlobal("fetch", previous); }
  });
});
describe("auto-creating students on first sign-in", () => {
  const withEnv = (env: Record<string, string | undefined>, fn: () => void) => {
    const save = { ...process.env };
    try { delete process.env.MS_AUTO_CREATE_STUDENTS; delete process.env.MS_ALLOWED_EMAIL_DOMAINS; Object.assign(process.env, env); fn(); } finally { process.env = save; }
  };
  it("is off unless explicitly enabled AND a domain allow-list is given", () => {
    withEnv({}, () => expect(autoCreateDomains()).toBeNull());
    withEnv({ MS_AUTO_CREATE_STUDENTS: "true" }, () => expect(autoCreateDomains()).toBeNull());
    withEnv({ MS_AUTO_CREATE_STUDENTS: "false", MS_ALLOWED_EMAIL_DOMAINS: "school.edu" }, () => expect(autoCreateDomains()).toBeNull());
    withEnv({ MS_AUTO_CREATE_STUDENTS: "TRUE", MS_ALLOWED_EMAIL_DOMAINS: " School.edu , @other.ac.gh " }, () => expect(autoCreateDomains()).toEqual(["school.edu", "other.ac.gh"]));
  });
  it("only lets allow-listed domains through, and never guest addresses", () => {
    const d = ["school.edu"];
    expect(emailInDomains("kofi@school.edu", d)).toBe(true);
    expect(emailInDomains("KOFI@SCHOOL.EDU", d)).toBe(true);
    expect(emailInDomains("kofi@gmail.com", d)).toBe(false);
    expect(emailInDomains("kofi@evil-school.edu", d)).toBe(false);
    expect(emailInDomains("kofi_gmail.com#EXT#@school.edu", d)).toBe(false);
  });
  it("names a new account from Microsoft's display name, else from the email", () => {
    expect(displayNameFor({ subject: "s", email: "a.b@school.edu", name: "Ama Boateng" })).toBe("Ama Boateng");
    expect(displayNameFor({ subject: "s", email: "ama.boateng@school.edu", name: null })).toBe("ama boateng");
  });
});