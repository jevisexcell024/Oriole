// Access-control and derived-data helpers for the library resource system,
// extracted from index.ts so the security-relevant logic (who can see a
// given resource) has real, isolated unit test coverage.
import { db } from "./db.ts";
import type { Book, User, AnnouncementAudience, Role } from "../shared/types.ts";

const now = () => new Date().toISOString();

/** Real access-control gate: institution-wide by default, or scoped to
 *  specific classes (via ClassGroup.memberIds — the only real enrollment
 *  primitive this app has) and/or specific students. Faculty/department/
 *  programme/course/level are descriptive metadata only, not gates, since
 *  User has no faculty/department/programme fields to check against. */
export function studentCanSeeBook(book: Book, user: User): boolean {
  if (book.status !== "published") return false;
  const nowIso = now();
  if (book.availableFrom && book.availableFrom > nowIso) return false;
  if (book.availableUntil && book.availableUntil < nowIso) return false;
  if (book.visibility.scope === "institution") return true;
  if (book.visibility.studentIds.includes(user.id)) return true;
  return db.data!.classes.some((c) => book.visibility.classIds.includes(c.id) && c.memberIds.includes(user.id));
}

export function studentsInScope(book: Book): User[] {
  if (book.visibility.scope === "institution") return db.data!.users.filter((u) => u.role === "candidate");
  const ids = new Set(book.visibility.studentIds);
  for (const cls of db.data!.classes) if (book.visibility.classIds.includes(cls.id)) for (const id of cls.memberIds) ids.add(id);
  return db.data!.users.filter((u) => u.role === "candidate" && ids.has(u.id));
}

/** Average rating (0 if none yet) and count for a resource — computed on
 *  read since resourceRatings is small per-book, no need to denormalize. */
export function ratingSummary(bookId: string): { avg: number; count: number } {
  const ratings = db.data!.resourceRatings.filter((r) => r.bookId === bookId);
  if (!ratings.length) return { avg: 0, count: 0 };
  return { avg: Math.round((ratings.reduce((s, r) => s + r.score, 0) / ratings.length) * 10) / 10, count: ratings.length };
}

/** Which announcement audiences a given role can see — candidates see
 *  "everyone"/"students"; staff roles see "everyone"/"admins". */
export function audiencesFor(role: Role): AnnouncementAudience[] {
  return role === "candidate" ? ["everyone", "students"] : ["everyone", "admins"];
}
