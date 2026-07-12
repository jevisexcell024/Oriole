import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Book, User } from "../shared/types.ts";

// Same in-memory PGlite pattern as db.test.ts — studentCanSeeBook/studentsInScope
// read the live db.data mirror, so we seed fixtures directly into it.
process.env.PGLITE_DIR = "memory://";
delete process.env.DATABASE_URL;

let db: typeof import("../server/db.ts")["db"];
let studentCanSeeBook: typeof import("../server/library.ts")["studentCanSeeBook"];
let studentsInScope: typeof import("../server/library.ts")["studentsInScope"];
let ratingSummary: typeof import("../server/library.ts")["ratingSummary"];
let audiencesFor: typeof import("../server/library.ts")["audiencesFor"];

beforeAll(async () => {
  const dbMod = await import("../server/db.ts");
  db = dbMod.db;
  await dbMod.initDb();
  const lib = await import("../server/library.ts");
  studentCanSeeBook = lib.studentCanSeeBook;
  studentsInScope = lib.studentsInScope;
  ratingSummary = lib.ratingSummary;
  audiencesFor = lib.audiencesFor;
}, 30000);

afterAll(async () => { await db.close(); });

function mkUser(id: string, role: User["role"] = "candidate"): User {
  return { id, email: `${id}@x.com`, name: id, role, passwordHash: "x" } as unknown as User;
}

function mkBook(overrides: Partial<Book> = {}): Book {
  return {
    id: "book1", title: "T", author: "A", genre: "Fiction", resourceType: "eBook", totalPages: 10,
    visibility: { scope: "institution", classIds: [], studentIds: [] },
    status: "published", canDownload: true, canPreview: true, version: 1, viewCount: 0, downloadCount: 0,
    uploadedBy: "admin1", createdAt: new Date().toISOString(),
    ...overrides,
  } as Book;
}

describe("studentCanSeeBook", () => {
  const alice = mkUser("alice");
  const bob = mkUser("bob");

  it("an institution-wide published book is visible to any candidate", () => {
    expect(studentCanSeeBook(mkBook(), alice)).toBe(true);
  });

  it("a draft book is never visible to a candidate", () => {
    expect(studentCanSeeBook(mkBook({ status: "draft" }), alice)).toBe(false);
  });

  it("scoped by studentIds is visible only to the listed students", () => {
    const book = mkBook({ id: "book-scoped-student", visibility: { scope: "scoped", classIds: [], studentIds: ["alice"] } });
    expect(studentCanSeeBook(book, alice)).toBe(true);
    expect(studentCanSeeBook(book, bob)).toBe(false);
  });

  it("scoped by classIds is visible only to members of that class", () => {
    db.data!.classes.push({ id: "cls1", name: "Class 1", memberIds: ["bob"], assignments: [], createdAt: new Date().toISOString() });
    const book = mkBook({ id: "book-scoped-class", visibility: { scope: "scoped", classIds: ["cls1"], studentIds: [] } });
    expect(studentCanSeeBook(book, bob)).toBe(true);
    expect(studentCanSeeBook(book, alice)).toBe(false);
  });

  it("respects availableFrom/availableUntil windows", () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(studentCanSeeBook(mkBook({ id: "not-yet", availableFrom: future }), alice)).toBe(false);
    expect(studentCanSeeBook(mkBook({ id: "expired", availableUntil: past }), alice)).toBe(false);
    expect(studentCanSeeBook(mkBook({ id: "currently-open", availableFrom: past, availableUntil: future }), alice)).toBe(true);
  });

  it("staff never goes through this gate (callers only apply it to candidates)", () => {
    // studentCanSeeBook itself doesn't special-case role — callers guard with
    // `user.role === "candidate" && !studentCanSeeBook(...)`. Confirm it still
    // evaluates a draft as not-visible even for a non-candidate id, since the
    // role check is the caller's job, not this function's.
    const staff = mkUser("staffA", "admin");
    expect(studentCanSeeBook(mkBook({ status: "draft" }), staff)).toBe(false);
  });
});

describe("studentsInScope", () => {
  it("returns every candidate for an institution-wide book", () => {
    db.data!.users.push(mkUser("carol"), mkUser("dave"));
    const ids = studentsInScope(mkBook()).map((u) => u.id);
    expect(ids).toEqual(expect.arrayContaining(["carol", "dave"]));
  });

  it("returns only class members + explicitly listed students for a scoped book", () => {
    db.data!.classes.push({ id: "cls2", name: "Class 2", memberIds: ["carol"], assignments: [], createdAt: new Date().toISOString() });
    const book = mkBook({ id: "book-scoped-2", visibility: { scope: "scoped", classIds: ["cls2"], studentIds: ["dave"] } });
    const ids = studentsInScope(book).map((u) => u.id).sort();
    expect(ids).toEqual(["carol", "dave"]);
  });
});

describe("ratingSummary", () => {
  it("returns 0/0 for a book with no ratings", () => {
    expect(ratingSummary("no-such-book")).toEqual({ avg: 0, count: 0 });
  });

  it("averages ratings for a book, rounded to 1 decimal", () => {
    const at = new Date().toISOString();
    db.data!.resourceRatings.push(
      { id: "r1", bookId: "bookX", candidateId: "alice", score: 4, createdAt: at },
      { id: "r2", bookId: "bookX", candidateId: "bob", score: 5, createdAt: at },
    );
    expect(ratingSummary("bookX")).toEqual({ avg: 4.5, count: 2 });
  });
});

describe("audiencesFor", () => {
  it("candidates see everyone + students announcements", () => {
    expect(audiencesFor("candidate")).toEqual(["everyone", "students"]);
  });

  it("staff roles see everyone + admins announcements", () => {
    expect(audiencesFor("admin")).toEqual(["everyone", "admins"]);
    expect(audiencesFor("facilitator")).toEqual(["everyone", "admins"]);
    expect(audiencesFor("proctor")).toEqual(["everyone", "admins"]);
  });
});
