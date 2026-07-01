// Central, validated configuration. In production we refuse to boot with
// insecure defaults (missing session secret, ephemeral storage, no encryption key).
import { randomBytes } from "node:crypto";

// No hardcoded fallback secret: an unset JWT_SECRET gets a fresh random per-process
// key, so sessions can never be forged with a known default. They simply don't
// survive a restart until JWT_SECRET is set (assertProductionEnv still requires it
// in production, so prod gets stable, explicit secrets).
const FALLBACK_JWT = randomBytes(48).toString("base64");

export const env = {
  isProd: process.env.NODE_ENV === "production",
  // Hosts (Render/Railway/etc.) inject PORT; fall back to API_PORT then 8787.
  port: Number(process.env.PORT) || Number(process.env.API_PORT) || 8787,
  jwtSecret: process.env.JWT_SECRET || FALLBACK_JWT,
  databaseUrl: process.env.DATABASE_URL,
  /** base64-encoded 32-byte key for AES-256-GCM field encryption (PII / proctoring media). */
  encryptionKey: process.env.DATA_ENCRYPTION_KEY,
  /** Days to retain proctoring snapshots; 0 disables the sweep. */
  retentionDays: Number(process.env.PROCTOR_RETENTION_DAYS ?? 0),
  /** True when JWT_SECRET is unset — sessions use a random per-process key (reset on restart). */
  jwtIsDefault: !process.env.JWT_SECRET,
  logLevel: process.env.LOG_LEVEL,
  /** Public URL of the app — used in outbound emails so links work in production.
   *  Set APP_URL on the host (e.g. https://lockdown.jevislab.com). */
  appUrl: (process.env.APP_URL ?? "").replace(/\/$/, "") || "https://lockdown.jevislab.com",
};

/** Fail fast in production rather than running with insecure defaults. */
export function assertProductionEnv() {
  if (!env.isProd) return;
  const problems: string[] = [];
  if (!process.env.JWT_SECRET) {
    problems.push("JWT_SECRET must be set to a strong, unique value (sessions reset on every restart otherwise)");
  }
  if (!process.env.DATABASE_URL && !process.env.ALLOW_EMBEDDED_DB) {
    problems.push("DATABASE_URL must point to a managed Postgres instance — or set ALLOW_EMBEDDED_DB=1 to use the on-disk embedded database (only safe on a single, persistent host like cPanel)");
  }
  if (!process.env.DATA_ENCRYPTION_KEY) {
    problems.push("DATA_ENCRYPTION_KEY (base64-encoded 32 bytes) must be set to encrypt proctoring media / PII at rest");
  }
  if (problems.length) {
    console.error("✖ Refusing to start in production with insecure configuration:");
    for (const p of problems) console.error("   - " + p);
    process.exit(1);
  }
}
