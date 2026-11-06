import { nanoid } from "nanoid";
import { db } from "./db.ts";
import type { PlatformNotification } from "../shared/types.ts";

// The one real, persisted notification system for the whole platform — every
// category (maintenance/security/billing/tenant/license/system) writes
// through here, not a parallel per-module implementation. Tenant users see
// these merged into their existing derived /api/notifications feed; Super
// Admins get their own list (they had none before).

async function notify(recipientType: PlatformNotification["recipientType"], recipientId: string, params: {
  category: PlatformNotification["category"]; title: string; body: string; severity?: PlatformNotification["severity"]; link?: string;
}): Promise<void> {
  const n: PlatformNotification = {
    id: nanoid(12),
    recipientType, recipientId,
    category: params.category,
    title: params.title,
    body: params.body,
    severity: params.severity ?? "info",
    link: params.link,
    createdAt: new Date().toISOString(),
    readAt: null,
  };
  db.data!.platformNotifications.push(n);
  await db.upsert("platformNotifications", n);
}

export async function notifyUsers(userIds: string[], params: Parameters<typeof notify>[2]): Promise<void> {
  for (const id of userIds) await notify("user", id, params);
}

/** Every tenant admin, platform-wide — the real audience for a platform-wide
 *  event like scheduled maintenance (there's no per-tenant targeting concept
 *  for maintenance windows today, so this matches that reality). */
export async function notifyAllTenantAdmins(params: Parameters<typeof notify>[2]): Promise<void> {
  const adminIds = db.data!.users.filter((u) => u.role === "admin").map((u) => u.id);
  await notifyUsers(adminIds, params);
}

export async function notifyAllSuperAdmins(params: Parameters<typeof notify>[2]): Promise<void> {
  const ids = db.data!.superAdmins.map((s) => s.id);
  for (const id of ids) await notify("superAdmin", id, params);
}

export function listNotificationsFor(recipientType: PlatformNotification["recipientType"], recipientId: string): PlatformNotification[] {
  return db.data!.platformNotifications
    .filter((n) => n.recipientType === recipientType && n.recipientId === recipientId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Returns false (caller should 404) if no matching, unread notification
 *  exists for this recipient — a notification id can never be used to mark
 *  someone else's notification read. */
export async function markNotificationRead(recipientType: PlatformNotification["recipientType"], recipientId: string, id: string): Promise<boolean> {
  const n = db.data!.platformNotifications.find((x) => x.id === id && x.recipientType === recipientType && x.recipientId === recipientId);
  if (!n) return false;
  if (!n.readAt) { n.readAt = new Date().toISOString(); await db.upsert("platformNotifications", n); }
  return true;
}
