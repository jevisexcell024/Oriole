import { z } from "zod";

// Request schemas for the auth-sensitive endpoints. The `validate` middleware
// turns these into 400s with structured field errors, and the handler downstream
// can trust the shape. The same pattern extends to every write endpoint.
export const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(200),
});

// Policy for NEW / changed passwords: length over composition (NIST 800-63B) plus a
// light variety check. A breached-password (HIBP k-anonymity) check is a recommended
// follow-up. Login itself is intentionally lenient (existing passwords must still work).
const strongPassword = z.string()
  .min(12, "Password must be at least 12 characters.")
  .max(200)
  .refine((pw) => new Set(pw).size >= 5, "Password is too simple — use a longer, more varied passphrase.");

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

export const passwordResetSchema = z.object({
  password: strongPassword,
});

// Two-factor: the verify/enable steps take a 6-digit TOTP or a backup code;
// disable accepts either the current password or a current code.
export const twoFaCodeSchema = z.object({
  code: z.string().trim().min(1).max(20),
});

export const twoFaDisableSchema = z.object({
  password: z.string().max(200).optional(),
  code: z.string().trim().max(20).optional(),
});
