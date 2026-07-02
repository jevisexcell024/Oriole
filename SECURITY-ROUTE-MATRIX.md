# Route × Authorization Matrix

A formal record of every API route's authorization requirement and, where relevant, its ownership/scoping check — turning the ad-hoc adversarial review from the 2026-07 security audit into a documented, reviewable deliverable instead of a one-time verbal pass.

**Scope:** all 146 route registrations in `server/index.ts` as of 2026-07-02 (commit `912b55b`): 10 public, 25 `requireAuth`, 108 `requireRole`/`requireRoles`, 3 `requireApiKey`. Each entry was re-verified against the current source at the time this document was written (via direct grep + read, not recalled from memory).

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
| POST | `/api/attempts` | Registration looked up the same way before an attempt is created/resumed. |
| POST | `/api/code/run` | No resource ID at all — runs the submitted code directly, nothing to scope. |
| GET | `/api/attempts/:id` | `attempts.find(a => a.id === :id && a.candidateId === user.id)` |
| GET | `/api/attempts/:id/control` | Same pattern. |
| POST | `/api/attempts/:id/answer` | Same pattern. |
| POST | `/api/attempts/:id/proctor-event` | Same pattern. |
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
| GET | `/api/announcements` | Broadcast content, not per-user — no ownership check needed. |
| GET | `/api/notifications` | Derived from the caller's own data only (`currentUser(req)`). |
| POST | `/api/auth/2fa/setup` | Acts on `currentUser(req)` only. |
| POST | `/api/auth/2fa/enable` | Acts on `currentUser(req)` only. |
| POST | `/api/auth/2fa/disable` | Acts on `currentUser(req)` only. |

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
| GET | `/api/admin/live` | Staff |
| GET | `/api/admin/attempts/:id/live` | Staff |
| POST | `/api/admin/attempts/:id/message` | Staff |
| POST | `/api/admin/attempts/:id/pause` | Staff |
| POST | `/api/admin/attempts/:id/terminate` | Staff |
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

*Last verified: 2026-07-02, commit `912b55b`. Re-run this check whenever a new route is added — grep for `^app\.(get|post|patch|put|delete)\(` and diff against the tables above.*
