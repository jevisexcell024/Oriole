# Future plans

Ideas agreed but not built yet. Newest first.

## Match the account-security screens to the student portal sign-in

**Status:** planned, not started (an attempt was built and reverted on request).

Give the password screens the same look as the student portal login
(blurred backdrop, cream card, illustration on the left, form on the right):

- `/setup-password` — first-time password setup from the welcome email
- `/reset-password` — student self-service reset from the forgot-password email
- `/force-password-change` — forced change after signing in with a temporary password

Notes for whenever this is picked up:

- Build it as one shared layout component so the three pages stay in sync, rather than three copies.
- Decide first which sign-in design they should follow: the student portal or the staff page.
  `/force-password-change` is also used by staff accounts.
- Keep the existing behaviour and translations (`fpc.*`, `spw.*` keys); this is a visual change only.
- No box-shadows, Manrope only.
- The Super Admin password-change page (`SuperAdminForcePasswordChange.tsx`) is a separate system and was not part of the idea.
