# Setting this project up on another computer

This folder is the whole Oriole (Orcalis Assess) project: the web app, the API server, the tests,
the scripts and the project history (`.git`). It does **not** include things that can be rebuilt
(`node_modules`, `dist`, logs) or that are secret (`.env`).

## 1. Install the tools
- **Node.js 20 or newer** (the project is developed on Node 24) — https://nodejs.org
- **Optional: PostgreSQL 15+.** Not needed for local use: with no `DATABASE_URL` the app keeps its
  data in an embedded database inside the project (`server/.pgdata`).

## 2. Install the project's packages
Open a terminal in this folder and run:

```
npm install
```

(This also applies the small patch in `patches/`.)

## 3. Create your `.env`
Copy `.env.example` to `.env` and fill it in. For local use the essentials are:

| Setting | What to put |
|---|---|
| `JWT_SECRET` | any long random text |
| `DATABASE_URL` | leave blank for the embedded database, or your PostgreSQL address |
| `DATA_ENCRYPTION_KEY` | **copy the value from the old computer's `.env`** — see the warning below |
| `ADMIN_PASSWORD`, `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD` | the values from the old `.env` (only used when the first accounts are created) |
| Mail (`MAIL_TRANSPORT`, `SMTP_*`) | leave unset for local use — messages are logged instead of sent |

> **Warning — `DATA_ENCRYPTION_KEY`:** profile pictures, phone numbers and two-factor secrets are
> stored encrypted with this key. If the new computer uses a different key, that data cannot be read.
> Copy the exact value from the old `.env`.

## 4. Bring your data across
`data/` contains a backup of the database taken when this zip was made. On the new computer, with
an empty database:

```
npx tsx --env-file=.env scripts/restore-full-backup.ts data/<the backup file>.json.gz
```

It restores every account, school, exam, question, result and log. Webcam snapshots are not in
the backup (they are disposable). If you skip this step you simply start with an empty system.

## 5. Run it
```
npm run dev
```
- Web app: http://localhost:5180 — student sign-in at `/portal`, staff sign-in at `/login`
- API: http://localhost:8787

The demo accounts from the old computer come across with the data. Their passwords are in
`scripts/demo-student.local.txt` and `scripts/demo-admin.local.txt` (local practice accounts only).

## Other useful commands
| Command | What it does |
|---|---|
| `npm test` | run the automated tests |
| `npm run typecheck` | check the code for type errors |
| `npm run build` | build the web app into `dist/` |
| `npm run deploy:zip` | build and package the zip you upload to cPanel (needs PowerShell; Windows) |
| `npx tsx --env-file=.env scripts/seed-demo-exams.ts <student email>` | add the demo exams and library items to a student |

## Where things are
`src/` web app · `server/` API · `shared/` code used by both · `scripts/` helpers ·
`test/` tests · `public/` images, videos and the service worker ·
`CHANGELOG.md`, `HOW_IT_WAS_BUILT.md`, `README.md`, `FUTURE-PLANS.md` — project notes.
