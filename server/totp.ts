import { createHmac, randomBytes } from "node:crypto";

/**
 * Self-contained TOTP (RFC 6238) — no third-party library, so it works offline and
 * needs no extra dependency. Compatible with Google Authenticator, Authy, 1Password,
 * Microsoft Authenticator, etc. (SHA1, 6 digits, 30-second period.)
 */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/=+$/, "").replace(/\s/g, "");
  let bits = 0, value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(bytes);
}

/** A fresh 160-bit secret as base32 (32 chars). */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

function hotp(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x1_0000_0000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return (code % 1_000_000).toString().padStart(6, "0");
}

export function totp(secret: string, t = Date.now()): string {
  return hotp(secret, Math.floor(t / 30_000));
}

/** Verify a 6-digit code, allowing ±`window` 30s steps to tolerate clock drift. */
export function verifyTotp(secret: string, token: string, window = 1): boolean {
  const clean = (token || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  const counter = Math.floor(Date.now() / 30_000);
  for (let w = -window; w <= window; w++) {
    if (hotp(secret, counter + w) === clean) return true;
  }
  return false;
}

/** The otpauth:// URI an authenticator app scans (rendered as a QR by the client). */
export function otpauthUrl(secret: string, account: string, issuer = "Oriole"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: "6", period: "30" });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Human-friendly one-time recovery codes, e.g. "a1b2-c3d4-e5". */
export function generateBackupCodes(n = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < n; i++) {
    const hex = randomBytes(5).toString("hex"); // 10 chars
    codes.push(`${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8)}`);
  }
  return codes;
}
