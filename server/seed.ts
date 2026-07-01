import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { db, initDb } from "./db.ts";
import type { Exam, Question, Registration, User } from "../shared/types.ts";
import { DEFAULT_LOCKDOWN } from "../shared/types.ts";

const now = () => new Date().toISOString();

function q(examId: string, partial: Omit<Question, "id" | "examId">): Question {
  return { id: nanoid(10), examId, ...partial };
}

export async function seed() {
  await initDb();

  // Reset core catalog (keep attempts/answers so a re-seed doesn't wipe progress
  // unless this is a clean DB).
  const candidatePw = bcrypt.hashSync("password123", 10);
  const adminPw = bcrypt.hashSync("password123", 10);

  const candidate: User = {
    id: "user_candidate",
    email: "candidate@orcalis.dev",
    passwordHash: candidatePw,
    name: "Ama Mensah",
    role: "candidate",
  };
  const admin: User = {
    id: "user_admin",
    email: "admin@orcalis.dev",
    passwordHash: adminPw,
    name: "Dr. Kwame Boateng",
    role: "admin",
  };

  db.data!.users = [candidate, admin];

  // ---- Exam 1: CS Fundamentals (multiple types, proctored) ----
  const exam1: Exam = {
    id: "exam_cs101",
    title: "CS101 — Computer Science Fundamentals",
    code: "CS101-F2026",
    description:
      "Final examination covering data structures, algorithms, and core programming concepts. Closed book, AI-proctored.",
    durationMinutes: 20,
    passingScore: 60,
    proctored: true,
    status: "published",
    enrollment: "open",
    lockdown: { ...DEFAULT_LOCKDOWN },
    createdAt: now(),
  };

  const exam1Questions: Question[] = [
    q(exam1.id, {
      type: "mcq",
      prompt: "What is the time complexity of binary search on a sorted array of n elements?",
      options: ["O(n)", "O(log n)", "O(n log n)", "O(1)"],
      correctAnswer: "O(log n)",
      points: 10,
    }),
    q(exam1.id, {
      type: "mcq",
      prompt: "Which data structure uses FIFO (first-in, first-out) ordering?",
      options: ["Stack", "Queue", "Binary Tree", "Hash Map"],
      correctAnswer: "Queue",
      points: 10,
    }),
    q(exam1.id, {
      type: "true_false",
      prompt: "A hash table guarantees O(1) worst-case lookup time.",
      options: ["true", "false"],
      correctAnswer: "false",
      points: 10,
    }),
    q(exam1.id, {
      type: "mcq",
      prompt: "Which sorting algorithm has the best average-case time complexity?",
      options: ["Bubble sort", "Insertion sort", "Quick sort", "Selection sort"],
      correctAnswer: "Quick sort",
      points: 10,
    }),
    q(exam1.id, {
      type: "short",
      prompt: "What keyword declares a constant in JavaScript? (one word)",
      correctAnswer: "const",
      points: 10,
    }),
    q(exam1.id, {
      type: "true_false",
      prompt: "Depth-first search can be implemented using a stack.",
      options: ["true", "false"],
      correctAnswer: "true",
      points: 10,
    }),
  ];

  // ---- Exam 2: Academic Integrity (short, not proctored) ----
  const exam2: Exam = {
    id: "exam_ai_quiz",
    title: "Academic Integrity Orientation Quiz",
    code: "AI-ORIENT",
    description: "A short orientation quiz on exam conduct and integrity policies.",
    durationMinutes: 10,
    passingScore: 70,
    proctored: false,
    status: "published",
    enrollment: "open",
    lockdown: { ...DEFAULT_LOCKDOWN, webcam: false, faceMonitoring: false },
    createdAt: now(),
  };

  const exam2Questions: Question[] = [
    q(exam2.id, {
      type: "true_false",
      prompt: "Using another person to take your exam is a violation of academic integrity.",
      options: ["true", "false"],
      correctAnswer: "true",
      points: 25,
    }),
    q(exam2.id, {
      type: "mcq",
      prompt: "If your camera disconnects mid-exam, you should:",
      options: [
        "Keep going and ignore it",
        "Reconnect immediately and notify the proctor",
        "Close the exam and walk away",
        "Switch to a phone",
      ],
      correctAnswer: "Reconnect immediately and notify the proctor",
      points: 25,
    }),
    q(exam2.id, {
      type: "true_false",
      prompt: "Opening another browser tab during a proctored exam may be flagged as a violation.",
      options: ["true", "false"],
      correctAnswer: "true",
      points: 25,
    }),
    q(exam2.id, {
      type: "short",
      prompt: "What single word describes presenting someone else's work as your own?",
      correctAnswer: "plagiarism",
      points: 25,
    }),
  ];

  db.data!.exams = [exam1, exam2];
  db.data!.questions = [...exam1Questions, ...exam2Questions];

  const inTwoDays = new Date(Date.now() + 2 * 86400000).toISOString();
  const registrations: Registration[] = [
    {
      id: "reg_cs101",
      examId: exam1.id,
      candidateId: candidate.id,
      status: "registered",
      approval: "confirmed",
      scheduledStart: inTwoDays,
      systemCheckPassed: false,
      createdAt: now(),
    },
    {
      id: "reg_ai_quiz",
      examId: exam2.id,
      candidateId: candidate.id,
      status: "registered",
      approval: "pending",
      scheduledStart: null,
      systemCheckPassed: false,
      createdAt: now(),
    },
  ];
  db.data!.registrations = registrations;

  // Fresh attempts/certs on seed. (answers/proctorEvents/snapshots live in their
  // own off-mirror tables; any rows there reference the now-removed attempts and
  // are never queried.)
  db.data!.attempts = [];
  db.data!.certificates = [];

  await db.write();
  console.log("✅ Seeded database.");
  console.log("   Candidate login: candidate@orcalis.dev / password123");
  console.log("   Admin login:     admin@orcalis.dev / password123");
}

// Run when invoked directly (npm run seed)
seed();
