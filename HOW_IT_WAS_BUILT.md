# How Orcalis Assess v2 Was Built

A build narrative + architecture reference for **Orcalis Assess v2** — a from-scratch,
fully-working online examination & AI-proctoring platform. This document explains the
stack, structure, data model, and the phase-by-phase way the project was assembled.

---

## 1. What it is

An end-to-end exam platform with two roles:

- **Candidates** — see assigned exams, pass a check-in (identity + rules + system check),
  take a timed, optionally **locked-down & proctored** exam, get auto-graded results and a
  verifiable certificate.
- **Admins** — author exams (Microsoft-Forms-style), manage a question bank, schedule
  availability, assign candidates, watch a **live proctoring wall**, and review results,
  analytics, certificates, and candidate activity.

Everything is real and persisted — no mock data.

---

## 2. Tech stack (and why)

| Layer | Choice | Why |
|-------|--------|-----|
| Frontend | **Vite + React 19 + TypeScript** | Fast dev server, modern React, type safety |
| Styling | **Tailwind v4** (+ CSS variables) | Utility-first with a small custom design system |
| Routing | **React Router 7** | Simple client routing with role-gated routes |
| Backend | **Express** (same-origin via Vite proxy) | Minimal, well-understood REST API |
| Persistence | **lowdb** (JSON file) | Real persistence, **zero native deps** (reliable on Windows); swappable for Postgres |
| Auth | **JWT in an httpOnly cookie** + **bcryptjs** | Stateless sessions, hashed passwords, no native crypto deps |
| Icons | **lucide-react** | Consistent icon set |
| Proctoring | Browser **getUserMedia** + **FaceDetector** + Fullscreen/Visibility APIs | Real, in-browser monitoring |

One command runs both servers: `concurrently` starts Vite (web :5180) and `tsx watch`
(API :8787); Vite proxies `/api` → the Express server.

---

## 3. Project structure

```
orcalis-v2/
├── server/                 # Express API (run with tsx)
│   ├── index.ts            # all routes (auth, exams, attempts, admin, grading, integrity)
│   ├── db.ts               # lowdb schema + init + migrations
│   ├── auth.ts             # JWT/cookie session + bcrypt + role guards
│   ├── seed.ts             # demo accounts, exams, questions, registrations
│   └── data.json           # the database (gitignore in real use)
├── shared/
│   └── types.ts            # domain types shared by client + server
├── src/
│   ├── main.tsx            # router + role-gated <Protected> routes
│   ├── index.css           # Tailwind import + design tokens + lockdown CSS
│   ├── lib/
│   │   ├── api.ts          # fetch wrapper (get/post/patch/del, credentials: include)
│   │   ├── auth.tsx        # AuthProvider + useAuth (session context)
│   │   ├── proctoring.ts   # useProctoring hook (camera, face detection, tab/fullscreen)
│   │   └── lockdown.ts     # useExamLockdown hook (copy/paste/shortcut/screenshot lockdown)
│   ├── components/
│   │   ├── Shell.tsx        # candidate top-nav shell
│   │   └── AdminShell.tsx   # admin left-sidebar shell (Examination / Platform sections)
│   └── pages/
│       ├── Login, Exams, Checkin, Session, Result, Certificates, Verify   # candidate
│       └── AdminExams, ExamBuilder, AdminQuestionBank, AdminScheduler,
│          AdminResults, AdminAttemptReview, AdminLiveMonitor,
│          AdminAnalytics, AdminCertificates, AdminCandidates              # admin
└── HOW_IT_WAS_BUILT.md
```

---

## 4. Data model (`shared/types.ts` → `server/db.ts`)

Collections in the lowdb store:

- **users** — `{ id, email, passwordHash, name, role: candidate|admin, avatarUrl? }`
- **exams** — `{ id, title, code, description, durationMinutes, passingScore, proctored,
  status: draft|published, enrollment: open|assigned, lockdown: LockdownConfig,
  availableFrom?, availableUntil? }`
- **questions** — `{ id, examId, type: mcq|true_false|short, prompt, options?, correctAnswer, points }`
- **registrations** — candidate↔exam link `{ status, scheduledStart, systemCheckPassed,
  studentRef?, rulesAcceptedAt?, verificationPhoto? }`
- **attempts** — `{ id, registrationId, examId, candidateId, startedAt, submittedAt,
  durationMinutes, score, passed, status: in_progress|submitted }`
- **answers** — `{ attemptId, questionId, value, correct }`
- **proctorEvents** — `{ attemptId, type, severity: info|warning|high, message, at }`
- **certificates** — `{ certNumber, attemptId, candidateId, examId, score, issuedAt }`
- **snapshots** — latest webcam frame per attempt `{ attemptId, dataUrl, at }`

**Migrations** run in `initDb()` — they backfill new fields on existing records
(`enrollment`, `lockdown`) so the store evolves without wiping data.

---

## 5. Backend design (`server/index.ts`)

- **Auth:** `POST /api/auth/login` verifies bcrypt hash → issues a signed JWT cookie.
  `requireAuth` / `requireRole("admin")` middleware guard routes.
- **Candidate API:** `/api/exams` (published + auto-enroll/assigned), `/api/exams/:reg`,
  `/api/registrations/:id/checkin`, `/api/attempts` (start/resume + schedule enforcement),
  `/api/attempts/:id/answer|snapshot|proctor-event|submit|result`.
- **Grading** happens server-side on submit; a certificate is issued on pass.
- **Integrity score** = `100 − (12·high + 5·warning)` per attempt, computed on read.
- **Admin API:** exam CRUD + publish (with validation), question CRUD + reorder, question
  bank, candidate assignment, scheduler (availability windows), results/analytics,
  attempt reviewer, live monitor feed, certificates, candidate directory.
- **Public:** `/api/verify/:certNumber` (no auth) for employer verification.

---

## 6. Frontend design

- **`<Protected role?>`** wraps routes — redirects unauthenticated users to `/login` and
  off-role users to their home.
- **`AuthProvider`** loads `/auth/me` once and exposes `user / login / logout`.
- **Candidate** uses `Shell` (top nav); **admin** uses `AdminShell` (left sidebar with
  *Examination* and *Platform* sections, navy active-item, live badge).
- The **exam builder** runs full-width (no sidebar) like Microsoft Forms.
- Charts use lightweight CSS bars (no chart library) to stay dependency-free.

---

## 7. Proctoring & lockdown

- **`useProctoring`** — acquires camera/mic, runs periodic **FaceDetector** checks
  (no-face / multiple-faces), and watches tab-blur / fullscreen-exit.
- **`useExamLockdown`** — per-exam configurable: fullscreen enforcement (blocking overlay),
  copy/cut/paste/selection/right-click disabling, blocked shortcuts (Ctrl/⌘+C/V/A/P/S, F12,
  devtools), and screenshot **deterrence** (PrintScreen intercept + clipboard wipe +
  screen-blank on focus loss).
- **Escalation engine** — every violation is logged + scored; warnings escalate
  (recorded → final warning → **auto-submit** at the configurable limit).
- **Live wall** — webcam frames upload every ~15s and render as live thumbnails in the
  invigilator Live Monitor; a verification photo is captured at check-in.

> **Honest limit:** a web page cannot truly block OS-level screenshots, screen recording,
> Alt+Tab/Win-key, or detect multiple monitors reliably — those require a native/Electron
> lockdown client. The web app deters and **logs** everything it can.

---

## 8. Build phases (the order it was assembled)

1. **Candidate experience** — auth, exam list, check-in (real system check), proctored
   session (timer, autosave, navigator, resume), submit → auto-grade → results →
   certificate → public verification. *(Found & fixed a Vite-watch reload bug that reset
   exam state.)*
2. **Admin authoring** — Microsoft-Forms-style exam builder (question cards, inline options,
   mark-correct, type switching, points, duplicate/reorder, autosave, preview, publish).
   *(Found & fixed an autosave race that overwrote fields.)*
3. **Published-only candidate feed** — students only see published exams (auto-enroll).
4. **Admin monitoring** — Results & Analytics, attempt Reviewer, Live Monitor.
5. **Targeted assignment** — per-exam audience (open vs assigned) + candidate assignment.
6. **Exam lockdown** — fullscreen/copy/paste/shortcut lockdown + violation logging.
7. **Configurable rules + integrity** — per-exam rule toggles, identity + rules-agreement
   gate at check-in, escalation → configurable auto-submit, live integrity score.
8. **Live proctoring wall** — webcam snapshot capture + invigilator thumbnails + reviewer imagery.
9. **Admin sidebar redesign** — left vertical nav (Examination / Platform sections).
10. **Question Bank + Scheduler** — central question repository; availability-window scheduling
    (enforced server-side).
11. **Platform pages** — Analytics, Certificates directory, Candidates directory.

Every phase was verified live in the browser before moving on.

---

## 9. Running it

```bash
npm install
npm run seed      # demo accounts + exams (resets demo data)
npm run dev       # web → http://localhost:5180 · API → http://localhost:8787
```

| Role | Email | Password |
|------|-------|----------|
| Candidate | candidate@orcalis.dev | password123 |
| Admin | admin@orcalis.dev | password123 |

---

## 10. Roadmap / not yet done

- **Browser-feasible:** audio risk scoring, network disconnect alerts, head-movement/look-away
  (face-landmark model), accessibility audit.
- **Native-only (separate client):** hard screenshot/screen-recording blocking,
  Alt+Tab/Win-key blocking, multi-monitor detection, Android/iOS app lockdown.
- **Production:** swap lowdb → Postgres (data layer is isolated in `server/db.ts`), move
  snapshots/photos to object storage, add rate-limiting and email notifications.
