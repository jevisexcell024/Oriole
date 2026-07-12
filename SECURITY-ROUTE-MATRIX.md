# Route × Authorization Matrix

A formal record of every API route's authorization requirement and, where relevant, its ownership/scoping check — turning the ad-hoc adversarial review from the 2026-07 security audit into a documented, reviewable deliverable instead of a one-time verbal pass.

**Scope:** all 146 route registrations in `server/index.ts` as of 2026-07-02 (commit `912b55b`): 10 public, 25 `requireAuth`, 108 `requireRole`/`requireRoles`, 3 `requireApiKey`. Each entry was re-verified against the current source at the time this document was written (via direct grep + read, not recalled from memory).

**2026-07-10 addendum:** the library/resource system (§2/§3 rows marked *(2026-07-10)*) and the announcement read-receipt routes were added after the original pass above and are now included below. These were verified the same way (direct grep + read) as part of a follow-up audit — the original 146-route count and its findings are otherwise unchanged.

**2026-07-12 addendum:** the geofencing feature (§2/§3 rows marked *(2026-07-12)*) — Phase 1 (one-time entry check) and Phase 2 (continuous monitoring during the exam, server-enforced exit policy, admin override) — was added after the 2026-07-10 pass and is now included below. Verified the same way (direct grep + read).

**Methodology:** grepped every `app.get/post/patch/put/delete(...)` registration, then for each route that accepts a resource ID from a non-staff caller, read the handler to confirm the ownership check happens *inside the lookup query itself* (e.g. `.find(x => x.id === req.params.id && x.candidateId === user.id)`), not as a separate check that could be forgotten or bypassed.

## Legend

| Symbol | Meaning |
|---|---|
| **Public** | No authentication required |
| **Auth** | `requireAuth` — any signed-in user, any role |
| **Grader** | `requireRoles(...GRADERS)` — admin or facilitator |
| **Staff** | `requireRoles(...STAFF)` — admin, facilitator, or proctor |
| **Admin** | `requireRole("admin")` — admin only |
| **ApiKey** | `requireApiKey` — Bearer token, not a session |

---

## 1. Public routes (no auth)

| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/login` | Rate-limited (`authLimiter`, keyed by email). Constant-time regardless of whether the email exists (fixed 2026-07-01). |
| POST | `/api/auth/logout` | Clears cookie + bumps `tokenVersion` if a session was present. |
| GET | `/api/auth/me` | Returns `null` user if not authenticated; no data leak. |
| GET | `/api/auth/sso` | Just returns whether SSO is configured (boolean). |
| GET | `/api/auth/sso/microsoft/start` | Redirects to Microsoft; sets a CSRF `state` cookie. |
| GET | `/api/auth/sso/microsoft/callback` | Validates `state` cookie match + `id_token` aud/iss/exp before ever touching a session. |
| GET | `/api/verify/:certNumber` | Intentionally public (certificate verification is a public feature by design). Cert numbers are high-entropy (`nanoid(8)`), not sequential. |
| GET | `/api/health` | Liveness probe, no data. |
| GET | `/api/ready` | Readiness probe, no data. |
| POST | `/api/auth/2fa/verify` | Structurally has no `requireAuth` — it's the login step-up itself. Scoped by a short-lived (5 min), single-use pending-2FA cookie set after the password step; rate-limited by `twoFaLimiter`. |

## 2. Candidate self-service routes (`requireAuth`, ownership-scoped)

These are the routes where an IDOR bug would actually matter — a candidate hitting another candidate's resource by guessing/enumerating an ID. Every one below verifies ownership **inside the lookup query**, so there's no code path where the check could be accidentally skipped after the fact.

| Method | Path | Ownership check |
|---|---|---|
| GET | `/api/exams` | Filters `registrations` by `candidateId === user.id` before deriving the exam list. |
| GET | `/api/exams/:registrationId` | `registrations.find(r => r.id === :registrationId && r.candidateId === user.id)` |
| POST | `/api/registrations/:id/checkin` | `registrations.find(r => r.id === :id && r.candidateId === user.id)` |
| POST | `/api/registrations/:id/geofence-check` *(2026-07-12)* | `registrations.find(r => r.id === :id && r.candidateId === user.id)`. One-time entry check — logged to `geofence_logs` (kept even on success/failure, for the location audit trail) regardless of outcome. |
| POST | `/api/attempts` | Registration looked up the same way before an attempt is created/resumed. |
| POST | `/api/code/run` | No resource ID at all — runs the submitted code directly, nothing to scope. |
| GET | `/api/attempts/:id` | `attempts.find(a => a.id === :id && a.candidateId === user.id)` |
| GET | `/api/attempts/:id/control` | Same pattern. Extended 2026-07-12 to also report `geofenceLocked`/`geofenceOutsideSince`/`geofencePauseAuto` — read-only state, no new write surface. |
| POST | `/api/attempts/:id/answer` | Same pattern. |
| POST | `/api/attempts/:id/proctor-event` | Same pattern. |
| POST | `/api/attempts/:id/geofence-ping` *(2026-07-12)* | Same pattern. Continuous-monitoring GPS checkpoint reported during an in-progress attempt; 400s if the exam doesn't have `requireGeofence && geofenceContinuousMonitoring` on, so it can't be used to probe an exam's config. The exit-policy escalation it can trigger (pause/lock/auto-submit) only ever acts on *this* attempt (looked up via the same ownership-scoped query) — a candidate can only ever pause/lock/submit their own attempt this way, never another's. |
| POST | `/api/attempts/:id/snapshot` | Same pattern. |
| POST | `/api/attempts/:id/submit` | Same pattern. |
| GET | `/api/attempts/:id/result` | Same pattern. |
| POST | `/api/attempts/:id/regrade` | Same pattern. |
| GET | `/api/certificates` | Filters by `candidateId === user.id`. |
| POST | `/api/me/password` | No `:id` — always acts on `currentUser(req)`, can't target another account. |
| PATCH | `/api/me/profile` | Same — `currentUser(req)` only. |
| GET | `/api/my/results` | Filters by `candidateId === user.id`. |
| GET | `/api/my/attendance` | Same. |
| GET | `/api/my/summary` | Same. |
| GET | `/api/practice` | Same. |
| GET | `/api/announcements` | Filtered by `audiencesFor(user.role)` (candidates see `everyone`/`students`; staff see `everyone`/`admins`) and per-user read state via `announcementReads`, joined on `candidateId === user.id`. |
| GET | `/api/notifications` | Derived from the caller's own data only (`currentUser(req)`). |
| POST | `/api/auth/2fa/setup` | Acts on `currentUser(req)` only. |
| POST | `/api/auth/2fa/enable` | Acts on `currentUser(req)` only. |
| POST | `/api/auth/2fa/disable` | Acts on `currentUser(req)` only. |
| POST | `/api/announcements/:id/read` *(2026-07-10)* | Creates a read receipt only for an announcement whose `audience` is in `audiencesFor(user.role)` — fixed 2026-07-10 (previously only checked existence, letting a candidate mark an admin-only announcement read; no data disclosure, state-pollution only). |
| POST | `/api/announcements/read-all` *(2026-07-10)* | Same `audiencesFor` filter, applied to every visible announcement before marking read. |
| GET | `/api/books` *(2026-07-10)* | Filters to `status === "published"` and `studentCanSeeBook(book, user)` (institution-wide, or scoped to the candidate's `ClassGroup`/explicit `studentIds`) for candidates; staff see everything. |
| GET | `/api/books/:id` *(2026-07-10)* | `studentCanSeeBook` gate for candidates; 404 (not 403) on a book outside scope, so existence isn't disclosed. |
| POST | `/api/books/:id/view` *(2026-07-10)* | Same gate before incrementing `viewCount`. |
| GET | `/api/books/:id/download` *(2026-07-10)* | Same gate, plus `canDownload`, `availableUntil`, and per-candidate `downloadLimit` (counted via `resourceDownloadLogs`) re-checked on every request — not just at upload time. |
| GET | `/api/books/:id/read` *(2026-07-10)* | Same gate, plus `canPreview` (in-app reading is a separate permission from downloading). |
| POST/DELETE | `/api/books/:id/bookmark` *(2026-07-10)* | Same gate. **Fixed 2026-07-10** — originally missing entirely (only checked the book existed), letting a candidate bookmark a draft/out-of-scope resource. |
| POST | `/api/books/:id/rating` *(2026-07-10)* | Same gate. **Fixed 2026-07-10** — same gap as bookmark; also meant an unauthorized rating could pollute the average shown to in-scope viewers. |
| POST | `/api/books/:id/progress` *(2026-07-10)* | Same gate. **Fixed 2026-07-10** — same gap as bookmark/rating. |

## 3. Staff / Grader / Admin routes (org-wide by design)

This app is **explicitly single-tenant** (documented limitation, not a bug — see `project-v150-security` memory / H2 in the original audit): one deployed instance serves one institution, and any staff/admin account can see and manage *all* data within that instance. There is no `orgId` field and no per-organization scoping, so "ownership" for this whole category simply means **role-gated**, not per-resource-owner-scoped. Running this as shared multi-tenant SaaS (multiple institutions on one deployment) would require adding tenant scoping to every one of these — that's a real architectural gap, tracked separately, not something this matrix can mark "fixed" by inspection.

All 108 routes below were checked for exactly one thing: **does every route have a `requireRole`/`requireRoles` middleware, with no gap?** Result: **yes, zero gaps found.**

| Method | Path | Role |
|---|---|---|
| POST | `/api/admin/registrations/:id/verify-id` | Staff |
| GET | `/api/admin/exams` | Grader |
| GET | `/api/admin/exams-overview` | Grader |
| POST | `/api/admin/exams` | Admin |
| POST | `/api/admin/exams/:id/duplicate` | Admin |
| GET | `/api/admin/exams/:id` | Admin |
| GET | `/api/admin/candidates` | Admin |
| POST | `/api/admin/candidates` | Admin |
| POST | `/api/admin/candidates/bulk` | Admin |
| GET | `/api/admin/emails` | Grader |
| PATCH | `/api/admin/candidates/:id/password` | Admin |
| DELETE | `/api/admin/candidates/:id` | Admin |
| POST | `/api/admin/exams/:id/assignments` | Admin |
| POST | `/api/admin/exams/:id/assign-bulk` | Admin |
| DELETE | `/api/admin/exams/:id/assignments/:candidateId` | Admin |
| PATCH | `/api/admin/exams/:id` | Admin |
| DELETE | `/api/admin/exams/:id` | Admin |
| POST | `/api/admin/exams/:id/questions` | Admin |
| POST | `/api/admin/exams/:id/questions/import` | Admin |
| POST | `/api/admin/exams/:id/questions/clone` | Admin |
| PATCH | `/api/admin/questions/:id` | Admin |
| DELETE | `/api/admin/questions/:id` | Admin |
| POST | `/api/admin/questions/:id/assess-difficulty` | Admin |
| POST | `/api/admin/exams/:id/questions/reorder` | Admin |
| POST | `/api/admin/exams/:id/publish` | Admin |
| GET | `/api/admin/questions` | Admin |
| GET | `/api/admin/results` | Grader |
| GET | `/api/admin/results-by-cohort` | Grader |
| GET | `/api/admin/exams/:id/item-analysis` | Grader |
| GET | `/api/admin/exams/:id/similarity` | Grader |
| GET | `/api/admin/analytics/cohorts` | Grader |
| GET | `/api/admin/students/:id/report` | Staff |
| PATCH | `/api/admin/candidates/:id/accommodations` | Admin |
| POST | `/api/admin/students/:id/trend-narrative` | Admin |
| GET | `/api/admin/attempts/:id` | Staff |
| GET | `/api/admin/grading/queue` | Grader |
| PATCH | `/api/admin/answers/:id/grade` | Grader |
| POST | `/api/admin/attempts/:id/release` | Grader |
| POST | `/api/admin/exams/:id/release-all` | Grader |
| POST | `/api/admin/exams/:id/recompute-results` | Admin |
| POST | `/api/admin/attempts/:id/second-mark` | Grader |
| GET | `/api/admin/regrades` | Grader |
| POST | `/api/admin/regrades/:id/resolve` | Grader |
| GET | `/api/admin/live` | Staff. Extended 2026-07-12 with a per-session `geofence` object (last known position, inside/outside, `outsideSince`, `locked`) for the live map — read-only, same session data staff already had access to via the drawer. |
| GET | `/api/admin/attempts/:id/live` | Staff. Same 2026-07-12 `geofence` extension, plus the last 20 `geofence_logs` entries for that attempt. |
| POST | `/api/admin/attempts/:id/message` | Staff |
| POST | `/api/admin/attempts/:id/pause` | Staff |
| POST | `/api/admin/attempts/:id/terminate` | Staff |
| POST | `/api/admin/attempts/:id/geofence-override` *(2026-07-12)* | Staff. Clears an auto-applied geofence pause/lock (e.g. a GPS glitch) without requiring the candidate to physically return first. Cannot undo an auto-submit/terminate — `if (a.status !== "in_progress") return 409` closes that off, since a submitted attempt has already been graded/certified. |
| GET | `/api/admin/analytics` | Grader |
| GET | `/api/admin/analytics-overview` | Grader |
| GET | `/api/admin/certificates` | Grader |
| GET | `/api/admin/registrations` | Admin |
| PATCH | `/api/admin/registrations/:id/status` | Admin |
| GET | `/api/admin/candidate-stats` | Admin |
| GET | `/api/admin/students` | Admin |
| PATCH | `/api/admin/students/:id` | Admin (scoped to `role === "candidate"` — can't be used to edit a staff account) |
| GET | `/api/admin/students/:id` | Admin |
| GET | `/api/admin/attendance` | Admin |
| GET | `/api/admin/attendance/:examId` | Admin |
| POST | `/api/admin/communication/send` | Grader |
| GET | `/api/admin/communication/status` | Grader |
| GET | `/api/admin/sms/status` | Grader |
| POST | `/api/admin/sms/test` | Admin |
| GET | `/api/admin/announcements` | Grader |
| POST | `/api/admin/announcements` | Grader |
| DELETE | `/api/admin/announcements/:id` | Admin |
| GET | `/api/admin/books` *(2026-07-10)* | Grader |
| POST | `/api/admin/books` *(2026-07-10)* | Grader — file uploads MIME-allowlisted, content-sniffed (`looksLikeMarkupOrScript`), and optionally AV-scanned (`scanForMalware`, opt-in via `CLOUDMERSIVE_API_KEY`) before being accepted; **content-sniff + AV scan added 2026-07-10** (previously trusted the client-declared MIME string). |
| PATCH | `/api/admin/books/:id` *(2026-07-10)* | Grader — same upload validation, only re-run when `fileData` actually changes. |
| DELETE | `/api/admin/books/:id` *(2026-07-10)* | Grader |
| GET | `/api/admin/books/:id/versions` *(2026-07-10)* | Grader |
| POST | `/api/admin/books/:id/versions/:versionId/restore` *(2026-07-10)* | Grader |
| GET | `/api/admin/library/dashboard` *(2026-07-10)* | Grader |
| GET | `/api/admin/integrity` | Grader |
| GET | `/api/admin/reports` | Grader |
| GET | `/api/admin/reports/results.csv` | Grader |
| GET | `/api/admin/reports/students.csv` | Grader |
| GET | `/api/admin/reports/certificates.csv` | Grader |
| POST | `/api/admin/reports/schedule` | Admin |
| DELETE | `/api/admin/reports/schedule/:id` | Admin |
| GET | `/api/admin/integrations` | Admin |
| POST | `/api/admin/webhooks` | Admin |
| PATCH | `/api/admin/webhooks/:id` | Admin |
| DELETE | `/api/admin/webhooks/:id` | Admin |
| POST | `/api/admin/webhooks/:id/test` | Admin |
| POST | `/api/admin/apikeys` | Admin |
| DELETE | `/api/admin/apikeys/:id` | Admin |
| GET | `/api/admin/settings` | Admin |
| PATCH | `/api/admin/settings` | Admin |
| POST | `/api/admin/digest/send-now` | Admin |
| GET | `/api/admin/backup/status` | Admin |
| POST | `/api/admin/backup/run-now` | Admin |
| GET | `/api/admin/rubric-library` | Grader |
| POST | `/api/admin/rubric-library` | Admin |
| DELETE | `/api/admin/rubric-library/:id` | Admin |
| GET | `/api/admin/institution` | Admin |
| POST | `/api/admin/institution/:kind` | Admin |
| DELETE | `/api/admin/institution/:kind/:id` | Admin |
| GET | `/api/admin/audit-logs` | Admin |
| GET | `/api/admin/violations` | Staff |
| GET | `/api/admin/system-health` | Admin |
| GET | `/api/admin/dashboard` | Staff |
| GET | `/api/admin/classes` | Admin |
| POST | `/api/admin/classes` | Admin |
| GET | `/api/admin/exams/:id/classes` | Admin |
| GET | `/api/admin/classes/:id` | Admin |
| PATCH | `/api/admin/classes/:id` | Admin |
| DELETE | `/api/admin/classes/:id` | Admin |
| POST | `/api/admin/classes/:id/members` | Admin |
| DELETE | `/api/admin/classes/:id/members/:candidateId` | Admin |
| POST | `/api/admin/classes/:id/assign-exam` | Admin |
| GET | `/api/admin/team` | Admin |
| POST | `/api/admin/team` | Admin |
| PATCH | `/api/admin/team/:id` | Admin |
| DELETE | `/api/admin/team/:id` | Admin |

## 4. External API (Bearer token, not a session)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/exams` | `requireApiKey` — SHA-256-hashed key lookup, not tied to a specific user session. Returns published exams only. |
| GET | `/api/v1/results` | Same auth. Returns submitted-attempt summaries (no PII beyond `candidateId`). |
| GET | `/api/v1/certificates` | Same auth. |

---

## Findings

- **Zero missing-auth routes.** Every one of the 146 routes has an explicit auth middleware except the 10 deliberately-public ones in §1 (9 truly public + the 2FA login step-up, which is scoped by its own pending-cookie mechanism instead).
- **Zero IDOR gaps** in the 25 candidate-facing routes in §2 — every ownership check is inline in the lookup query, not a separate step.
- **Single-tenant is a real, known architectural limit**, not something this matrix "clears" — see the H2 finding in the original security audit. Don't read §3's "role-gated" pattern as equivalent to per-tenant isolation; it isn't, by design.
- **No new issues found** relative to the earlier adversarial pass this session — this document formalizes that pass rather than surfacing new problems.
- **2026-07-10 addendum:** the library resource system's `bookmark`/`rating`/`progress` routes were found missing their visibility gate (candidates could interact with draft/out-of-scope resources by ID) and fixed the same day; the upload path was missing content-sniffing/AV-scan defenses present on the exam-answer upload path and was likewise fixed. `Book.externalUrl` also gained an `http(s)://`-only scheme allowlist (previously accepted any scheme, e.g. `javascript:`). See `server/library.ts` / `server/uploads.ts` for the extracted, unit-tested logic (`test/library.test.ts`, `test/uploads.test.ts`).
- **2026-07-12 addendum:** geofencing Phase 1 (`/api/registrations/:id/geofence-check`) and Phase 2 (`/api/attempts/:id/geofence-ping`, the `/api/admin/attempts/:id/geofence-override` staff override, and the `geofence` fields added to `/api/admin/live`/`/api/admin/attempts/:id/live`) — no gaps found. The two candidate-facing routes follow the same inline-ownership pattern as every other `/api/attempts/:id/*`/`/api/registrations/:id/*` route; `geofence-ping`'s policy escalation (pause/lock/auto-submit) only ever mutates the caller's own attempt, looked up the same way. One deliberate trust boundary, consistent with Phase 1 and disclosed rather than silently accepted: browser geolocation is client-reported and spoofable, so the "lock" policy is UI-only enforcement (like the existing fullscreen-lock overlay) — the actual teeth is server-side: the grace-period sweep (`sweepGeofenceViolations`, independent of further client pings) and the `auto_submit`/`terminate` policies, which route through the same `forceSubmitAttempt` used by the pre-existing violation-limit auto-submit.

*Last verified: 2026-07-12 (geofencing addendum), library/announcements addendum 2026-07-10, original pass 2026-07-02 commit `912b55b`. Re-run this check whenever a new route is added — grep for `^app\.(get|post|patch|put|delete)\(` and diff against the tables above.*
