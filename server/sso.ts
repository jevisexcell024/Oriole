/**
 * Microsoft (Entra / Microsoft 365) Single Sign-On via the OAuth 2.0 authorization-code
 * flow. Self-contained — uses global fetch, no SDK. Disabled until configured:
 *
 *   MS_CLIENT_ID       Application (client) ID from the Entra app registration
 *   MS_CLIENT_SECRET   a client secret for that app
 *   MS_TENANT          "organizations" (default, any work/school account),
 *                      "common", or a specific tenant ID to lock to your org
 *   MS_REDIRECT_URI    optional override; otherwise derived from the request host
 *
 * We only ever sign in a user who ALREADY exists in Oriole (matched by email) —
 * SSO never creates accounts, so a tenant member can't self-provision access.
 */
const TENANT = process.env.MS_TENANT || "organizations";
const SCOPE = "openid profile email";

export function microsoftEnabled(): boolean {
  return !!(process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET);
}

export function authorizeUrl(redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID!,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: SCOPE,
    state,
  });
  return `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize?${p.toString()}`;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const part = token.split(".")[1];
    const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Exchange the auth code for tokens and return the verified email + name, or null. */
export async function exchangeCode(code: string, redirectUri: string): Promise<{ email: string; name: string } | null> {
  const body = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID!,
    client_secret: process.env.MS_CLIENT_SECRET!,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    scope: SCOPE,
  });
  const res = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) return null;
  const json = (await res.json().catch(() => null)) as { id_token?: string } | null;
  if (!json?.id_token) return null;
  // The id_token came directly from Microsoft's token endpoint over TLS, so its
  // claims are trusted for this server-to-server exchange.
  const claims = decodeJwtPayload(json.id_token);
  // Defence-in-depth: the token already arrived directly from Microsoft's token
  // endpoint over TLS, but we still pin audience, issuer and expiry so a wrong or
  // expired token can never sign anyone in.
  const nowSec = Math.floor(Date.now() / 1000);
  if (String(claims.aud ?? "") !== process.env.MS_CLIENT_ID) return null;
  if (!String(claims.iss ?? "").startsWith("https://login.microsoftonline.com/")) return null;
  const exp = Number(claims.exp ?? 0);
  if (!exp || exp < nowSec) return null;
  const email = String(claims.email || claims.preferred_username || claims.upn || "").toLowerCase().trim();
  const name = String(claims.name || email);
  if (!email) return null;
  return { email, name };
}
