# Orcalis v2 — Project Handoff & Migration Guide

> **Purpose:** everything needed to move this project to another local PC and get it
> running, building, and deploying. Written 2026-06-22.
>
> **This is the LIVE project.** Orcalis v2 (this folder) is the Express + embedded-Postgres
> app deployed to **lockdown.jevislab.com**. A separate folder on the Desktop,
> `orcalis-assess-sign-in`, is an older Supabase-based prototype and is **NOT** the live
> deployment — don't confuse the two. To tell a running instance apart, probe `/api/health`.

---

## 1. What it is

**Orcalis** is an online examination & remote-proctoring SaaS for a single institution.
Two roles: **admin/instructor** (build exams, grade, monitor, analytics, communication,
SIS) and **student** (check-in, sit proctored exams, view results & certificates).

- **Product name:** Orcalis (formerly "Oriole" in some strings — Orcalis is current).
- **Design charter:** lime `#CDDC29` + near-black `#111110`; no gradients; bento dashboards;
  analytics as radial/donut/line (not bars); Space Grotesk + DM Sans; 16px card radius.
- **Versioning (per project notes):** v1.3.0 = UI polishing (current), v1.4.0 = new features
  (parked backlog). i18n rollout is in progress (see §9).

## 2. Tech stack

| Layer    | Tech |
|----------|------|
| Frontend | Vite 6, React 19, React Router 7, TypeScript 5.7, Tailwind v4 (`@tailwindcss/vite`) |
| Backend  | Express 4 (ESM), `tsx` in dev, esbuild-bundled for prod |
| Database | **PGlite** (embedded Postgres, `@electric-sql/pglite`) by default; **`pg`** (managed Postgres) when `DATABASE_URL` is set — swappable backend in `server/db.ts` |
| Auth     | JWT in httpOnly cookie + bcrypt; 2FA TOTP (`server/totp.ts`); SSO via Microsoft Entra (`server/sso.ts`) |
| Security | helmet, express-rate-limit, AES-256-GCM field encryption for PII/proctoring media (`server/crypto.ts`) |
| AI       | `@anthropic-ai/sdk` (question difficulty, student-trend narrative) — `server/ai.ts` |
| Email    | nodemailer (mock mode unless SMTP configured) — `server/mailer.ts` |
| SMS      | Twilio (mock unless configured) — `server/sms.ts` |
| Other    | katex (math), xlsx + mammoth (import .xlsx/.docx), qrcode (certificates), monaco (code questions), pino (logging) |
| Tests    | vitest (~99 tests) |

## 3. Prerequisites on the new PC

- **Node.js 20 LTS or newer** (developed on Node 24.15.0 / npm 11.12.1). The esbuild
  bundle targets node18, so anything ≥18 runs, but install with a current LTS.
- **Git** — this is a git repo (local `main` branch, no remote configured yet).
  Migrate by cloning/copying the `.git` history along with the folder (see §4).
- No global tools required; everything is in `devDependencies`.

## 4. How to migrate the folder

**Do NOT copy these** (they are regenerated / host-specific):
- `node_modules/` — reinstall with `npm install`
- `server/.pgdata/` — the embedded database. Copy it **only** if you want to carry the
  existing data; otherwise it is recreated empty and re-seeded. **Never** copy
  `server/.pgdata/postmaster.pid` — a stale lock from another machine will crash the API
  (see §10).
- `dist/`, `dist-server/`, `*.log`, `tsconfig.tsbuildinfo` — build artifacts.

**Recommended transfer:** zip the folder excluding the above, copy to the new PC, unzip, then:

```bash
cd orcalis-v2
npm install
npm run seed      # optional: create schema + demo data + admin (see §7)
npm run dev       # web on Vite dev server + API on :8787
```

> If you want the live site's data, also export the production database separately — the
> local `.pgdata` is dev data, not production.

## 5. npm scripts

| Script | What it does |
|--------|--------------|
| `npm run dev` | Concurrent Vite (web) + `tsx watch server/index.ts` (API). Dev workflow. |
| `npm run dev:web` / `dev:api` | Run just one side. |
| `npm run build` | `tsc -b && vite build` → static frontend into `dist/`. |
| `npm run build:server` | esbuild-bundle the API → `dist-server/server.mjs` (ESM, node18, deps external). |
| `npm run build:cpanel` | `build` + `build:server` — **the full production build.** |
| `npm run start` | Run API via tsx (dev-style prod). |
| `npm run start:bundle` | `node dist-server/server.mjs` — run the bundled prod server. |
| `npm run seed` | `tsx server/seed.ts` — schema + demo data + admin bootstrap. |
| `npm run typecheck` | `tsc -b`. |
| `npm test` / `test:watch` | vitest. |

**Per-change verification loop used during development:**
`npx tsc -b --force` → `npm run build:cpanel` → `npx vitest run`.

## 6. Environment variables

Set via the host's env (cPanel/Passenger env, or a process manager). A template ships as
**`.env.example`** — copy it to `.env` for local dev, or set the same keys as host env vars
in prod. Source of truth: `server/env.ts` (+ `assertProductionEnv()` which refuses to boot
prod with insecure defaults).

Generate the two required secrets:
```bash
# JWT_SECRET
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
# DATA_ENCRYPTION_KEY (32 bytes, base64)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### Core
| Var | Required | Default | Notes |
|-----|----------|---------|-------|
| `NODE_ENV` | prod | — | `production` enables strict checks. |
| `PORT` / `API_PORT` | no | `8787` | Hosts often inject `PORT`. |
| `JWT_SECRET` | **prod** | dev fallback | Must be strong/unique in prod or boot fails (sessions forgeable otherwise). |
| `DATA_ENCRYPTION_KEY` | **prod** | — | base64-encoded 32 bytes; AES-256-GCM for PII/proctoring media at rest. |
| `LOG_LEVEL` | no | pino default | |

### Database
| Var | Required | Notes |
|-----|----------|-------|
| `DATABASE_URL` | prod* | Managed Postgres connection string. If unset, embedded PGlite is used. |
| `ALLOW_EMBEDDED_DB` | prod* | Set `=1` to allow PGlite in production (only safe on a single persistent host, e.g. cPanel). *Either `DATABASE_URL` or `ALLOW_EMBEDDED_DB` is required in prod.* |
| `PGLITE_DIR` | no | Override embedded DB dir (default `server/.pgdata`). |
| `DATABASE_POOL_MAX` | no | Default 10 (Postgres only). |
| `DATABASE_SSL` | no | Set `false` to disable SSL; otherwise `rejectUnauthorized:false`. |

### Admin bootstrap (first run)
| Var | Notes |
|-----|-------|
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | Seed/boot creates the first admin from these. |

### Email (optional — mock mode if unset)
`MAIL_TRANSPORT` (set `smtp` to send for real), `MAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`,
`SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`.

### SMS / WhatsApp (optional — mock unless set)
`SMS_PROVIDER` (e.g. `twilio`), `SMS_CHANNEL`, `TWILIO_FROM`, `TWILIO_WHATSAPP_FROM`,
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`.

### AI (optional)
`ANTHROPIC_API_KEY` (+ optional `AI_MODEL`/`ORCALIS_AI_MODEL`, `AI_BASE_URL`, `AI_API_KEY`).

### SSO — Microsoft Entra (optional)
`MS_TENANT`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_REDIRECT_URI`.
**SSO only signs in users that already exist (matched by email); it must NOT auto-create accounts.**

### Code execution (optional)
`CODE_RUNNER_ENABLED`, `PISTON_URL`, `PISTON_AUTH`.

### Misc
`PROCTOR_RETENTION_DAYS` (0 disables the retention sweep), `AUTH_RATE_LIMIT`, `API_RATE_LIMIT`.

> **Secrets never go in the repo or in chat.** Set them only as host env vars.

## 7. Database & admin

- `server/db.ts` picks the backend at runtime: Postgres if `DATABASE_URL`, else embedded PGlite
  at `PGLITE_DIR` (default `server/.pgdata`). `memory://` is used in tests.
- Schema is created/migrated in code; `npm run seed` populates demo data and the admin.
- First admin comes from `ADMIN_EMAIL`/`ADMIN_PASSWORD`/`ADMIN_NAME`.
- **Snapshots are taken off the in-memory mirror** (use `snapshotStore`), per project notes.

## 8. Build & deploy (cPanel / Passenger)

1. `npm run build:cpanel` → produces:
   - `dist/` — static frontend (served as the SPA).
   - `dist-server/server.mjs` — the **Passenger entry point** (bundled API).
2. Production server is started from `dist-server/server.mjs` (`npm run start:bundle` locally).
3. Set all prod env vars (§6) in the host. `assertProductionEnv()` will refuse to start if
   `JWT_SECRET`, a database choice, or `DATA_ENCRYPTION_KEY` are missing.

**Deploy package:** the live site is updated by rebuilding and repackaging
`Desktop\orcalis-v2-deploy.zip`. The zip must contain **zero** `node_modules` / `.pgdata`
segments (those are built/created at runtime on the host). Verify ENTRIES / SIZE_MB / LEAKS
after packaging.

**Live deployment:** `lockdown.jevislab.com`. Includes Safe Exam Browser hard-lockdown
(per-exam Config Key, server-side hash verification) — see `server/seb.ts` / `src/lib/seb.ts`.

## 9. Repository layout

```
orcalis-v2/
├─ server/                 # Express API (ESM, TypeScript)
│  ├─ index.ts             # app + all routes (large)
│  ├─ db.ts                # swappable Postgres/PGlite backend, schema, seed helpers
│  ├─ env.ts               # validated config + assertProductionEnv()
│  ├─ auth.ts totp.ts sso.ts security.ts crypto.ts   # authn/z, 2FA, SSO, rate limits, encryption
│  ├─ grading.ts exam-delivery.ts schemas.ts validate.ts
│  ├─ ai.ts mailer.ts sms.ts code-runner.ts retention.ts streak.ts seb.ts
│  ├─ seed.ts logger.ts
│  └─ .pgdata/             # embedded DB (DO NOT copy postmaster.pid; usually don't migrate)
├─ src/                    # React frontend
│  ├─ main.tsx  index.css
│  ├─ pages/               # ~50 route pages (Admin* and student pages, ExamBuilder, etc.)
│  ├─ components/          # AdminShell, Shell, Charts, DataTable, LanguageSwitcher, ...
│  └─ lib/                 # api.ts, auth.tsx, i18n.tsx, i18n-messages.ts, proctoring.ts, seb.ts, roles.ts, ...
├─ shared/                 # shared TS types (@shared/*)
├─ package.json  tsconfig.json  vite config
└─ MIGRATION.md            # this file
```

## 10. i18n status (in progress)

5 languages: English (en), French (fr), Spanish (es), Portuguese (pt), Arabic (ar, RTL).
Engine: `src/lib/i18n.tsx` (`I18nProvider`, `useI18n`, `useT()` → `TFn`) + central store
`src/lib/i18n-messages.ts` (`messages: Record<string, Record<Lang,string>>`, typing forces
all 5 langs per key). RTL via `document.documentElement.dir`; lang persisted in localStorage
key `orcalis-lang`.

- **Done:** all student screens and all admin screens, including
  `src/pages/ExamBuilder.tsx` (~1600 lines, the largest — translated last). i18n rollout
  is complete across the app.
- **Deliberately left in English** (technical/format-critical): CSV/LMS gradebook headers
  (Canvas/Moodle), `x-orcalis-signature`, `/api/v1/...`, `Authorization: Bearer ...`,
  `SMS_PROVIDER=twilio`, raw proctor-event type codes, import column aliases, short
  question-type abbreviations.

## 11. Known gotchas

- **Stale PGlite lock** → API crashes with "PGlite failed to initialize". Fix: delete
  `server/.pgdata/postmaster.pid` and restart. This is the #1 reason copying `.pgdata`
  between machines breaks — delete the pid (or don't copy `.pgdata` at all).
- **Always run build/test from THIS folder** (`Orcalis v2/orcalis-v2`). A sibling project
  on the Desktop will give unrelated failures.
- **No remote configured** — commits are local-only for now; back up by zipping the folder
  (including `.git/`) until a remote is set up.
- `assertProductionEnv()` hard-exits in prod if core secrets are missing — set them first.

---

*Generated as a migration handoff for moving Orcalis v2 to a new PC.*
