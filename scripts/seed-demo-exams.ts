// Additive demo data: four showcase exams (ready now, upcoming, awaiting
// approval, completed with a released result) for one candidate account, plus
// 15 library resources across 11 categories.
//
// Unlike server/seed.ts this NEVER deletes anything — every row is an upsert
// keyed on a `demo_*` id, so it is safe to re-run and safe on a restored DB.
//
// Usage:  npx tsx --env-file=.env scripts/seed-demo-exams.ts [candidate-email]
// (defaults to the first candidate account in the database). Restart the API
// afterwards — it keeps an in-memory mirror of the tables.

import { db, initDb, answerStore } from "../server/db.ts";
import { DEFAULT_LOCKDOWN } from "../shared/types.ts";
import type { Answer, Attempt, Book, Exam, Question, Registration } from "../shared/types.ts";

const DAY = 86_400_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

await initDb();
const wanted = process.argv[2]?.toLowerCase();
const candidates = db.data.users.filter((u) => u.role === "candidate");
const candidate = wanted ? candidates.find((u) => u.email.toLowerCase() === wanted) : candidates[0];
if (!candidate) {
  console.error(wanted ? `No candidate with email ${wanted}.` : "No candidate account found.");
  process.exit(1);
}
const tenantId = candidate.tenantId;
const lockdown = { ...DEFAULT_LOCKDOWN, webcam: false, faceMonitoring: false };
// Exams/questions/library rows are shared; registrations, the attempt and its
// answers are per-candidate, so give each candidate their own ids.
const sfx = candidate.id === "demo_student" ? "_ds" : "";

const mkExam = (id: string, e: Partial<Exam> & Pick<Exam, "title" | "code" | "description" | "durationMinutes" | "passingScore" | "subject">): Exam => ({
  id, tenantId, proctored: false, status: "published", enrollment: "open", lockdown,
  shuffleQuestions: true, shuffleOptions: true, createdAt: iso(-10 * DAY), ...e,
});

let n = 0;
const mkQ = (examId: string, q: Omit<Question, "id" | "examId" | "tenantId">): Question =>
  ({ id: `demo_q_${examId.slice(5)}_${++n}`, examId, tenantId, ...q }) as Question;

// ── 1. Ready now ───────────────────────────────────────────────────────────
const readyExam = mkExam("demo_ready", {
  title: "Demo · Introduction to Programming", code: "DEMO-PROG101", subject: "Computer Science",
  description: "A short, open-book-free quiz on programming basics. Available right now — start it from your Exams page.",
  durationMinutes: 15, passingScore: 60,
  // No availableFrom: the server's 30-minute late rule counts from availableFrom
  // (or the registration's scheduledStart), so a past start would lock the exam.
  availableFrom: null, availableUntil: iso(365 * DAY),
  resources: [{ label: "MDN JavaScript Guide", url: "https://developer.mozilla.org/docs/Web/JavaScript/Guide" }],
});
const readyQs = [
  mkQ(readyExam.id, { type: "mcq", prompt: "Which of these is NOT a primitive type in JavaScript?", options: ["string", "number", "array", "boolean"], correctAnswer: "array", points: 10 }),
  mkQ(readyExam.id, { type: "true_false", prompt: "A function can return another function.", options: ["true", "false"], correctAnswer: "true", points: 10 }),
  mkQ(readyExam.id, { type: "mcq", prompt: "What does `Array.prototype.map` return?", options: ["The original array", "A new array", "A single value", "undefined"], correctAnswer: "A new array", points: 10 }),
  mkQ(readyExam.id, { type: "short", prompt: "Which keyword declares a block-scoped variable that can be reassigned? (one word)", correctAnswer: "let", points: 10 }),
  mkQ(readyExam.id, { type: "mcq", prompt: "What is the result of `typeof null`?", options: ["\"null\"", "\"object\"", "\"undefined\"", "\"number\""], correctAnswer: "\"object\"", points: 10 }),
] as Question[];

// ── 2. Upcoming (scheduled in 3 days) ──────────────────────────────────────
const upcomingExam = mkExam("demo_upcoming", {
  title: "Demo · Database Systems Midterm", code: "DEMO-DB201", subject: "Computer Science",
  description: "Midterm covering relational modelling, SQL joins and normalisation. Scheduled — opens at the start time below.",
  durationMinutes: 45, passingScore: 50,
  availableFrom: iso(3 * DAY), availableUntil: iso(3 * DAY + 3 * 3_600_000),
});
const upcomingQs = [
  mkQ(upcomingExam.id, { type: "mcq", prompt: "Which normal form removes transitive dependencies?", options: ["1NF", "2NF", "3NF", "BCNF only"], correctAnswer: "3NF", points: 10 }),
  mkQ(upcomingExam.id, { type: "true_false", prompt: "A LEFT JOIN returns all rows from the left table.", options: ["true", "false"], correctAnswer: "true", points: 10 }),
] as Question[];

// ── 3. Awaiting approval ──────────────────────────────────────────────────
const pendingExam = mkExam("demo_pending", {
  title: "Demo · Academic Integrity Quiz", code: "DEMO-INTEG", subject: "Orientation",
  description: "Orientation quiz on exam conduct. Your registration is waiting for administrator approval.",
  durationMinutes: 10, passingScore: 70, availableFrom: null, availableUntil: iso(365 * DAY),
});
const pendingQs = [
  mkQ(pendingExam.id, { type: "true_false", prompt: "Sharing exam answers with a classmate is allowed if both agree.", options: ["true", "false"], correctAnswer: "false", points: 50 }),
  mkQ(pendingExam.id, { type: "short", prompt: "What single word describes presenting someone else's work as your own?", correctAnswer: "plagiarism", points: 50 }),
] as Question[];

// ── 3b. Locked: opens tomorrow, can't be started yet ──────────────────────
const lockedExam = mkExam("demo_locked", {
  title: "Demo · Physics Final Examination", code: "DEMO-PHY301", subject: "Physics",
  description: "Final examination on mechanics and thermodynamics. It opens tomorrow — you can't start it until then.",
  durationMinutes: 60, passingScore: 50, proctored: true,
  availableFrom: iso(1 * DAY), availableUntil: iso(1 * DAY + 4 * 3_600_000),
});
const lockedQs = [
  mkQ(lockedExam.id, { type: "mcq", prompt: "What is the SI unit of force?", options: ["Joule", "Newton", "Watt", "Pascal"], correctAnswer: "Newton", points: 10 }),
  mkQ(lockedExam.id, { type: "true_false", prompt: "Energy can be created but not destroyed.", options: ["true", "false"], correctAnswer: "false", points: 10 }),
  mkQ(lockedExam.id, { type: "mcq", prompt: "Which law states F = ma?", options: ["First law", "Second law", "Third law", "Law of gravitation"], correctAnswer: "Second law", points: 10 }),
] as Question[];
// ── 3c. Quick start: open now, no schedule, no proctoring ─────────────────
const quickExam = mkExam("demo_quick", {
  title: "Demo · Quick Start Quiz", code: "DEMO-QUICK", subject: "General",
  description: "A 5-minute, 4-question quiz you can start immediately.",
  durationMinutes: 5, passingScore: 50,
  availableFrom: null, availableUntil: iso(365 * DAY),
});
const quickQs = [
  mkQ(quickExam.id, { type: "mcq", prompt: "What is the capital of France?", options: ["Berlin", "Madrid", "Paris", "Rome"], correctAnswer: "Paris", points: 25 }),
  mkQ(quickExam.id, { type: "true_false", prompt: "The Earth orbits the Sun.", options: ["true", "false"], correctAnswer: "true", points: 25 }),
  mkQ(quickExam.id, { type: "mcq", prompt: "What is 12 × 8?", options: ["86", "96", "108", "112"], correctAnswer: "96", points: 25 }),
  mkQ(quickExam.id, { type: "short", prompt: "What gas do plants absorb from the air? (two words)", correctAnswer: "carbon dioxide", points: 25 }),
] as Question[];
// ── 4. Completed, result released ─────────────────────────────────────────
const doneExam = mkExam("demo_done", {
  title: "Demo · Web Fundamentals", code: "DEMO-WEB110", subject: "Computer Science",
  description: "Completed exam with a released result — open it from My Results to see the breakdown.",
  durationMinutes: 20, passingScore: 60,
  availableFrom: iso(-9 * DAY), availableUntil: iso(-8 * DAY), resultsReleaseAt: iso(-7 * DAY),
  gradeBands: [{ label: "A", min: 80 }, { label: "B", min: 70 }, { label: "C", min: 60 }, { label: "D", min: 50 }, { label: "F", min: 0 }],
});
const doneQs = [
  mkQ(doneExam.id, { type: "mcq", prompt: "Which HTML element holds the page's visible content?", options: ["<head>", "<body>", "<meta>", "<title>"], correctAnswer: "<body>", points: 20 }),
  mkQ(doneExam.id, { type: "true_false", prompt: "CSS stands for Cascading Style Sheets.", options: ["true", "false"], correctAnswer: "true", points: 20 }),
  mkQ(doneExam.id, { type: "mcq", prompt: "Which HTTP status code means \"Not Found\"?", options: ["200", "301", "404", "500"], correctAnswer: "404", points: 20 }),
  mkQ(doneExam.id, { type: "short", prompt: "What does the `fetch` API return? (one word)", correctAnswer: "promise", points: 20 }),
  mkQ(doneExam.id, { type: "mcq", prompt: "Which method sends data to create a resource?", options: ["GET", "POST", "HEAD", "TRACE"], correctAnswer: "POST", points: 20 }),
] as Question[];

// ── Registrations ─────────────────────────────────────────────────────────
const reg = (id: string, examId: string, r: Partial<Registration>): Registration =>
  ({ id, tenantId, examId, candidateId: candidate.id, status: "registered", approval: "confirmed", scheduledStart: null, systemCheckPassed: false, createdAt: iso(-5 * DAY), ...r });
const registrations: Registration[] = [
  reg(`demo_reg_ready${sfx}`, readyExam.id, {}),
  reg(`demo_reg_upcoming${sfx}`, upcomingExam.id, { scheduledStart: iso(3 * DAY) }),
  reg(`demo_reg_pending${sfx}`, pendingExam.id, { approval: "pending" }),
  reg(`demo_reg_locked${sfx}`, lockedExam.id, { scheduledStart: iso(1 * DAY) }),
  reg(`demo_reg_quick${sfx}`, quickExam.id, {}),
  reg(`demo_reg_done${sfx}`, doneExam.id, { status: "submitted", scheduledStart: iso(-9 * DAY + 3_600_000), systemCheckPassed: true, checkedInAt: iso(-9 * DAY + 3_000_000) }),
];

// ── Completed attempt: 4 of 5 correct = 80% ───────────────────────────────
const started = iso(-9 * DAY + 3_600_000);
const submitted = iso(-9 * DAY + 3_600_000 + 14 * 60_000);
const attempt: Attempt = {
  id: `demo_attempt_done${sfx}`, tenantId, registrationId: `demo_reg_done${sfx}`, examId: doneExam.id, candidateId: candidate.id,
  startedAt: started, submittedAt: submitted, durationMinutes: doneExam.durationMinutes,
  score: 80, rawScore: 80, passed: true, status: "submitted", gradingStatus: "auto_graded", releasedAt: iso(-7 * DAY),
  questionIds: doneQs.map((q) => q.id),
};
const picks = ["<body>", "true", "404", "callback", "POST"]; // 4th is wrong
const answers: Answer[] = doneQs.map((q, i) => {
  const correct = picks[i] === q.correctAnswer || (q.type === "short" && picks[i].toLowerCase() === String(q.correctAnswer).toLowerCase());
  return { id: `demo_ans_${i + 1}${sfx}`, attemptId: attempt.id, questionId: q.id, value: picks[i], correct, awardedPoints: correct ? q.points : 0, gradedBy: "auto" };
});

// ── Library resources (so the Library page's category browser has content) ─
// External-link style resources: no file payload, so nothing heavy is stored.
const resource = (id: string, resourceType: Book["resourceType"], title: string, author: string, course: string, extra: Partial<Book> = {}): Book => ({
  id: `demo_book_${id}`, tenantId, title, author, course, resourceType, genre: "Novel", totalPages: 0, visibility: { scope: "institution", classIds: [], studentIds: [] },
  status: "published", canDownload: false, canPreview: true, version: 1, viewCount: 0, downloadCount: 0,
  uploadedBy: candidate.id, createdAt: iso(-2 * DAY), externalUrl: "https://developer.mozilla.org/", ...extra,
});
const library: Book[] = [
  resource("t1", "Textbook", "Structure and Interpretation of Computer Programs", "Abelson & Sussman", "CS101", { totalPages: 657, viewCount: 41, downloadCount: 12 }),
  resource("t2", "Textbook", "Database System Concepts", "Silberschatz et al.", "DB201", { totalPages: 1376, viewCount: 28 }),
  resource("t3", "Textbook", "Computer Networks", "A. Tanenbaum", "NET210", { totalPages: 960 }),
  resource("n1", "Lecture Notes", "Week 3 — Recursion and the Call Stack", "Dr. Boateng", "CS101", { totalPages: 24, viewCount: 19 }),
  resource("n2", "Lecture Notes", "Normalisation Cheat Sheet", "Dr. Boateng", "DB201", { totalPages: 8 }),
  resource("p1", "Past Questions", "CS101 Final — 2025", "Exams Office", "CS101", { totalPages: 6, downloadCount: 33 }),
  resource("p2", "Past Questions", "DB201 Midterm — 2025", "Exams Office", "DB201", { totalPages: 4 }),
  resource("v1", "Video", "How the Browser Renders a Page", "Web Dev Society", "WEB110", { estimatedReadingTime: 18, viewCount: 64 }),
  resource("a1", "Audio", "Podcast: Careers in Software", "Career Centre", "GEN100", { estimatedReadingTime: 32 }),
  resource("l1", "Lab Manual", "Lab 4 — SQL Joins", "Dr. Boateng", "DB201", { totalPages: 12 }),
  resource("r1", "Research Paper", "A Relational Model of Data for Large Shared Data Banks", "E. F. Codd", "DB201", { totalPages: 11, updatedAt: iso(-1 * DAY), version: 2 }),
  resource("s1", "Source Code", "Starter Repo — Todo App", "Web Dev Society", "WEB110"),
  resource("x1", "External Link", "MDN Web Docs", "Mozilla", "WEB110"),
  resource("e1", "eBook", "Eloquent JavaScript", "Marijn Haverbeke", "CS101", { totalPages: 472, viewCount: 52 }),
  resource("c1", "Course Outline", "CS101 — Semester Outline", "Dr. Boateng", "CS101", { totalPages: 3 }),
];
// ── Write (upserts only) ──────────────────────────────────────────────────
const exams = [readyExam, quickExam, upcomingExam, pendingExam, lockedExam, doneExam];
const questions = [...readyQs, ...upcomingQs, ...pendingQs, ...lockedQs, ...quickQs, ...doneQs];
const put = async <T extends { id: string }>(key: "exams" | "questions" | "registrations" | "attempts" | "books", rows: T[]) => {
  const list = db.data[key] as unknown as { id: string }[];
  for (const row of rows) {
    const i = list.findIndex((r) => r.id === row.id);
    if (i >= 0) list[i] = row; else list.push(row);
    await db.upsert(key, row as never);
  }
};
await put("exams", exams);
await put("questions", questions);
// The API auto-enrols candidates in open published exams, so a registration for
// (candidate, exam) may already exist under a random id. /api/exams uses the
// first match, so drop those before inserting ours or the seeded state is ignored.
for (const r of registrations) {
  const dupes = db.data.registrations.filter((x) => x.candidateId === r.candidateId && x.examId === r.examId && x.id !== r.id);
  for (const d of dupes) { await db.remove("registrations", d.id); }
  db.data.registrations = db.data.registrations.filter((x) => !dupes.includes(x));
}
await put("registrations", registrations);
await put("attempts", [attempt]);
await put("books", library);
for (const a of answers) await answerStore.upsert(a);

console.log(`Demo data written for ${candidate.name} <${candidate.email}>:`);
console.log(`  ${exams.length} exams, ${questions.length} questions, ${registrations.length} registrations, 1 completed attempt (80%, passed), ${library.length} library resources.`);
process.exit(0);
