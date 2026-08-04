import type { Request } from "express";
import type { OrgSettings, Exam } from "../shared/types.ts";
import { db } from "./db.ts";
import { currentUser } from "./auth.ts";

/** The tenant the currently-authenticated request belongs to, or null for an
 *  unauthenticated request. Every tenant-scoped query should filter by this —
 *  see the tenant-retrofit plan for which routes have been migrated so far
 *  (Phase C, in progress; only GET /api/admin/exams today). */
export function currentTenantId(req: Request): string | null {
  return currentUser(req)?.tenantId ?? null;
}

/** OrgSettings is one row per tenant (id === that tenant's id) — this
 *  replaces every `db.data.settings.find(s => s.id === "org")` call site,
 *  which broke the instant OrgSettings.id stopped being the literal
 *  constant "org". Throws rather than returning undefined: every tenant is
 *  guaranteed a settings row by the boot-time migration (server/db.ts), so a
 *  miss here means a real bug, not a legitimate "no settings yet" state. */
export function getOrgSettings(tenantId: string): OrgSettings {
  const settings = db.data!.settings.find((s) => s.id === tenantId);
  if (!settings) throw new Error(`No OrgSettings row for tenant ${tenantId} — this should be impossible after the boot-time migration.`);
  return settings;
}

/** First of a growing library of scoped-query helpers Phase C introduces
 *  batch-by-batch alongside the routes that need them — see GET
 *  /api/admin/exams (server/index.ts), the one route migrated so far. */
export function tenantExams(tenantId: string | null): Exam[] {
  return db.data!.exams.filter((e) => e.tenantId === tenantId);
}

const FALLBACK_BRAND_COLOR = "#c6ff34";

/** A tenant's own OrgSettings.brandColor if they've set one, else the
 *  current platform default (Super Admin's Branding Defaults), else the
 *  built-in lime fallback if neither has ever been set (fresh install,
 *  before any Super Admin has touched branding). Always a real hex string —
 *  every caller (the client's brand-color injection) can use it as-is. */
export function effectiveBrandColor(tenantId: string | null): string {
  if (tenantId) {
    const settings = db.data!.settings.find((s) => s.id === tenantId);
    if (settings?.brandColor) return settings.brandColor;
  }
  return db.data!.branding.find((b) => b.id === "platform")?.defaultBrandColor ?? FALLBACK_BRAND_COLOR;
}
