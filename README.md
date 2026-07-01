# Orcalis Assess v2 — Candidate Exam Experience

A fresh, from-scratch rebuild focused on the **candidate exam experience**, with
real, working, end-to-end features (no stubs).

## Stack
- **Frontend:** Vite + React 19 + TypeScript + Tailwind v4 + React Router 7
- **Backend:** Express API (same-origin via Vite proxy)
- **Persistence:** lowdb (JSON file at `server/data.json`) — real data, survives restarts, zero native deps
- **Auth:** signed cookie sessions (JWT) + bcrypt password hashing
- **Proctoring:** real `getUserMedia` webcam capture, browser `FaceDetector` face-presence
  checks (graceful fallback when unsupported), and tab-blur / fullscreen-exit violation logging

## Run it
```bash
npm install
npm run seed     # creates demo accounts + exams
npm run dev      # web → http://localhost:5180  ·  api → http://localhost:8787
```

### Demo accounts
| Role | Email | Password |
|------|-------|----------|
| Candidate | candidate@orcalis.dev | password123 |
| Admin | admin@orcalis.dev | password123 |

## What works end-to-end
1. **Login** — real auth, hashed passwords, session cookie
2. **My Exams** — registrations + exams pulled live from the API
3. **System check / check-in** — real network latency check; camera/mic acquisition for proctored exams
4. **Proctored session** — server-timed countdown (auto-submit on expiry), per-question
   autosave, question navigator, **resume after disconnect** (answers persist server-side)
5. **Submit → server-side auto-grading** (MCQ / true-false / short answer)
6. **Certificate issuance** on pass
7. **Results** — score, pass/fail, proctoring summary, full answer review
8. **Public certificate verification** — `/verify/:certNumber`, no auth required

## Project layout
```
server/        Express API + lowdb store
  index.ts     routes (auth, exams, attempts, grading, certificates, verify)
  db.ts        lowdb schema + init
  seed.ts      demo data
  auth.ts      session / bcrypt helpers
shared/        types shared by client + server
src/
  pages/       Login, Exams, Checkin, Session, Result, Certificates, Verify
  lib/         api client, auth context, proctoring hook
  components/  Shell
```

## Roadmap (next phases)
- **Admin console:** exam authoring, question bank, scheduling, live monitor, results analytics
- **Proctoring depth:** server-side recording storage, reviewer timeline, ID liveness
- **Production backend:** swap lowdb for Postgres (Drizzle) — the data layer is isolated in `server/db.ts`
- **Payments / billing**, notifications, multi-tenant institutions
