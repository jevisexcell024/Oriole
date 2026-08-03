import { z } from "zod";
import { createHash } from "node:crypto";

// Have I Been Pwned "Pwned Passwords" range API — free, no key, and k-anonymous:
// only the first 5 hex chars of the password's SHA-1 hash are ever sent, never the
// password or the full hash, so HIBP can't learn what password was checked.
// Fails OPEN (treats the password as not-breached) on any network error or
// timeout — this is a supplementary check, not the primary defense, and a slow/
// down third party must never block account creation or password changes.
async function isPasswordBreached(password: string): Promise<boolean> {
  const sha1 = createHash("sha1").update(password).digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  try {
    const r = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true" },
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) {
      console.warn(`⚠️  HIBP breach check got HTTP ${r.status} — this password was NOT screened, only the length/variety rule applied.`);
      return false;
    }
    const body = await r.text();
    return body.split("\n").some((line) => line.trim().split(":")[0] === suffix);
  } catch (err) {
    // Fails open by design (see comment above) — but a host with no outbound
    // internet access (common on locked-down shared hosting) means this check
    // silently never runs, ever, for any password. Log it so that's visible
    // in production instead of a permanently-dark safety net.
    console.warn(`⚠️  HIBP breach check unreachable (${err instanceof Error ? err.message : err}) — this password was NOT screened, only the length/variety rule applied.`);
    return false;
  }
}

// Request schemas for the auth-sensitive endpoints. The `validate` middleware
// turns these into 400s with structured field errors, and the handler downstream
// can trust the shape. The same pattern extends to every write endpoint.
export const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(200),
});

// Policy for NEW / changed passwords: length over composition (NIST 800-63B), a
// light variety check, and a live breached-password check against HIBP. Login
// itself is intentionally lenient (existing passwords must still work even if
// they'd fail this policy today).
const strongPassword = z.string()
  .min(12, "Password must be at least 12 characters.")
  .max(200)
  .refine((pw) => new Set(pw).size >= 5, "Password is too simple — use a longer, more varied passphrase.")
  .refine(async (pw) => !(await isPasswordBreached(pw)), "This password has appeared in a known data breach. Please choose a different one.");

export const teamCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  password: strongPassword,
  role: z.enum(["admin", "facilitator", "proctor"]),
});

export const passwordChangeSchema = z.object({
  current: z.string().min(1).max(200),
  password: strongPassword,
});

export const passwordSetupSchema = z.object({
  token: z.string().min(1),
  password: strongPassword,
});

export const passwordResetSchema = z.object({
  password: strongPassword,
});

// No password field — mirrors the bootstrap pattern (server/db.ts): an
// inviting super admin never chooses another account's password, the server
// generates a one-time one and the invite flow forces its rotation.
export const superAdminCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
});

// New tenant (school) + its first admin account, in one step — same no-password
// convention as superAdminCreateSchema above (the platform operator never
// chooses another organization's admin password).
export const tenantCreateSchema = z.object({
  tenantName: z.string().trim().min(1).max(160),
  adminName: z.string().trim().min(1).max(120),
  adminEmail: z.string().trim().email().max(254),
  /** Optional — redeems a LicenseKey against the new school in the same step. */
  licenseKeyCode: z.string().trim().min(1).max(64).optional(),
});

// Licensing — Subscription Plans. A limit field of null means "unlimited";
// a limit of 0 is rejected below since "allow zero students" isn't a usable
// plan, it's a misconfiguration.
const planLimitSchema = z.number().int().min(1).max(1_000_000).nullable();
const nonNegativePrice = z.number().min(0).max(1_000_000).nullable().optional();
export const planCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]+$/, "Letters, numbers, - and _ only").max(30).optional(),
  description: z.string().trim().max(500).optional(),
  features: z.array(z.string().trim().max(120)).max(20).optional(),
  priceMonthly: nonNegativePrice,
  priceYearly: nonNegativePrice,
  currency: z.string().trim().toUpperCase().length(3).optional(),
  limits: z.object({
    maxStudents: planLimitSchema,
    maxStaff: planLimitSchema,
    maxActiveExams: planLimitSchema,
  }),
});
export const planUpdateSchema = planCreateSchema.partial();

export const licenseKeyCreateSchema = z.object({
  planId: z.string().trim().min(1),
  note: z.string().trim().max(200).optional(),
  maxRedemptions: z.number().int().min(1).max(1000).default(1),
  expiresAt: z.string().trim().nullable().optional(),
});

export const licenseKeyRedeemSchema = z.object({
  code: z.string().trim().min(1).max(64),
});

const parseableDate = z.string().trim().min(1).refine((v) => !Number.isNaN(new Date(v).getTime()), { message: "Not a valid date/time." });
export const maintenanceWindowCreateSchema = z.object({
  startAt: parseableDate,
  endAt: parseableDate,
  message: z.string().trim().max(500),
}).refine((v) => new Date(v.endAt).getTime() > new Date(v.startAt).getTime(), { message: "End time must be after start time.", path: ["endAt"] });

// Two-factor: the verify/enable steps take a 6-digit TOTP or a backup code;
// disable accepts either the current password or a current code.
export const twoFaCodeSchema = z.object({
  code: z.string().trim().min(1).max(20),
});

export const twoFaDisableSchema = z.object({
  password: z.string().max(200).optional(),
  code: z.string().trim().max(20).optional(),
});

// Custom role CRUD (see shared/permissions.ts for the permission catalog and
// shared/types.ts for the CustomRole shape). `permissions` is validated as a
// plain string array here — membership in the actual catalog is checked in the
// handler (server/index.ts) so the error message can list the specific bad keys.
const roleScopeSchema = z.object({
  facultyId: z.string().trim().max(60).nullable().optional(),
  departmentId: z.string().trim().max(60).nullable().optional(),
  campusId: z.string().trim().max(60).nullable().optional(),
}).nullable().optional();

export const customRoleCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(400).optional(),
  permissions: z.array(z.string().trim().min(1).max(60)).max(200).default([]),
  parentRoleId: z.string().trim().max(60).nullable().optional(),
  scope: roleScopeSchema,
});

export const customRoleUpdateSchema = customRoleCreateSchema.partial();

export const roleAssignSchema = z.object({
  customRoleId: z.string().trim().max(60).nullable(),
  expiresAt: z.string().trim().max(40).nullable().optional(),
});
