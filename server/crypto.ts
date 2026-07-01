import crypto from "node:crypto";
import { env } from "./env.ts";

// Transparent field-level encryption for sensitive values at rest (proctoring
// webcam frames, and any PII we choose to wrap). AES-256-GCM with a per-value
// random IV; the auth tag guarantees integrity. Values are tagged "enc:v1:" so
// reads can detect and pass through legacy plaintext during/after rollout.
const PREFIX = "enc:v1:";

function keyBuffer(): Buffer | null {
  if (!env.encryptionKey) return null;
  const buf = Buffer.from(env.encryptionKey, "base64");
  if (buf.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must be base64-encoded 32 bytes (256-bit).");
  return buf;
}

export const encryptionEnabled = () => !!env.encryptionKey;

export function encryptString(plain: string): string {
  const key = keyBuffer();
  if (!key || plain.startsWith(PREFIX)) return plain; // no key configured, or already encrypted
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptString(value: string | null | undefined): string | null | undefined {
  if (!value || !value.startsWith(PREFIX)) return value; // plaintext / legacy — pass through
  const key = keyBuffer();
  if (!key) return value;
  const raw = Buffer.from(value.slice(PREFIX.length), "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
