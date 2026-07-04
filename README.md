# Orcalis — Online Examination & Remote-Proctoring Platform

A single-institution exam platform: admins/facilitators author and grade exams,
candidates check in and sit proctored exams, results and certificates are
issued automatically. See [MIGRATION.md](MIGRATION.md) for deployment,
environment variables, and full handoff details; see
[SECURITY-ROUTE-MATRIX.md](SECURITY-ROUTE-MATRIX.md) for the authz audit.

## Stack
- **Frontend:** Vite 6 + React 19 + TypeScript + Tailwind v4 + React Router 7
- **Backend:** Express 4 (ESM)
- **Persistence:** embedded PGlite (Postgres compiled to WASM) by default, or
  managed Postgres (`pg`) when `DATABASE_URL` is set — swappable backend in
  `server/db.ts`
- **Auth:** JWT httpOnly-cookie sessions + bcrypt, 2FA (TOTP), SSO via
  Microsoft Entra
- **Security:** helmet, rate limiting, AES-256-GCM field encryption for
  PII/proctoring media at rest, HSTS preload
- **Proctoring:** real `getUserMedia` webcam capture, face-presence checks,
  tab-blur / fullscreen-exit violation logging, Safe Exam Browser lockdown
- **i18n:** 5 languages (English, French, Spanish, Portuguese, Arabic/RTL)

## Run it
```bash
npm install
npm run seed     # creates schema + demo accounts + exams
npm run dev      # web + api, concurrently — see package.json for the exact ports
```

### Demo accounts (from `npm run seed`)
| Role | Email | Password |
|------|-------|----------|
| Candidate | candidate@orcalis.dev | password123 |
| Admin | admin@orcalis.dev | password123 |

## What works end-to-end
1. **Auth** — login, 2FA, Microsoft SSO, session cookies
2. **Candidate flow** — my exams, check-in, proctored session (server-timed,
   autosave, resume after disconnect), submit, auto-grading (MCQ / true-false /
   short answer / code), certificates, results review
3. **Admin console** (~28 pages) — exam authoring, question bank, scheduling,
   live monitor, grading + regrades, analytics, communication, SIS, classes,
   attendance, audit logs, integrations/webhooks/API keys, reports, settings
4. **Public certificate verification** — `/verify/:certNumber`, no auth required
5. **Scheduled off-host-ready database backups**, optional cloud AV scanning on
   uploaded exam answers

## Project layout
```
orcalis-v2/
├─ server/        Express API + swappable PGlite/Postgres store
│  index.ts       routes (large — see SECURITY-ROUTE-MATRIX.md for the full list)
│  db.ts          storage backend, schema, seed helpers
│  auth.ts / totp.ts / sso.ts / crypto.ts / security.ts
├─ src/
│  pages/         ~50 route pages (candidate + admin)
│  components/    AdminShell, Shell, Charts, DataTable, LanguageSwitcher, ...
│  lib/           api client, auth/i18n context, proctoring hook, ...
├─ shared/        types shared by client + server
└─ scripts/       load-test.mjs (npm run loadtest)
```

## Known gaps (not yet built)
- **Multi-tenant / super-admin.** This app is explicitly single-tenant — one
  deployment serves one institution, no `orgId` scoping. See
  `SECURITY-ROUTE-MATRIX.md` §3 and the `project-v160-super-admin-panel`
  planning notes for what a multi-tenant version would require.
- **Payments / billing.**
- **Proctoring depth:** server-side recording storage, reviewer timeline, ID
  liveness checks.
