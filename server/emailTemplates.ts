import type { EmailTemplate } from "../shared/types.ts";
import { db } from "./db.ts";
import { esc } from "./mailer.ts";

export interface EmailTemplateDef {
  key: string;
  label: string;
  description: string;
  defaultSubject: string;
  defaultIntro: string;
  /** Variable names usable as {{var}} in subject/intro for this template. */
  variables: string[];
}

// Curated, real flows only — not every sendMail() call site in index.ts routes
// through this (see CHANGELOG for the exact list). Each is scoped to subject +
// the intro paragraph; the surrounding branded HTML (data tables, CTA button
// URL) is never editable, so a Super Admin can reword an email without being
// able to break its layout or repoint its link.
export const EMAIL_TEMPLATE_DEFS: EmailTemplateDef[] = [
  {
    key: "auth.new_signin",
    label: "New sign-in notification",
    description: "Sent when a user signs in from a device/browser Oriole hasn't seen before.",
    defaultSubject: "New sign-in to your Oriole account",
    defaultIntro: "Your Oriole account was just signed in to from a new device or location.",
    variables: ["name"],
  },
  {
    key: "account.setup_link",
    label: "Account setup link",
    description: "Sent when an account is created (invite, bulk import, resend) — links to the password-setup page.",
    defaultSubject: "Finish setting up your Oriole account",
    defaultIntro: "An account has been created for you on Oriole. Set your password to finish getting started.",
    variables: ["name"],
  },
  {
    key: "results.released",
    label: "Result released",
    description: "Sent when a candidate's exam result becomes available.",
    defaultSubject: "Your result is available — {{examTitle}}",
    defaultIntro: 'Your result for "{{examTitle}}" is now available.',
    variables: ["name", "examTitle"],
  },
  {
    key: "exam.reminder",
    label: "Exam starting-soon reminder",
    description: "Sent 24h and 1h before a confirmed, scheduled exam starts.",
    defaultSubject: "Reminder — {{examTitle}} starts {{label}}",
    defaultIntro: 'This is a reminder that "{{examTitle}}" starts {{label}}.',
    variables: ["name", "examTitle", "label"],
  },
];

const DEF_BY_KEY = new Map(EMAIL_TEMPLATE_DEFS.map((d) => [d.key, d]));

function substitute(text: string, vars: Record<string, string>): string {
  // Only replaces variables actually provided — an unrecognized {{token}} is
  // left literally in place rather than silently stripped, the same
  // "don't hide a typo" convention src/lib/i18n.tsx's t() uses.
  let out = text;
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{{${k}}}`, v);
  return out;
}

/** Renders one template's subject (plain text) and intro (both plain-text and
 *  pre-escaped-for-HTML forms) against an override if one exists, else the
 *  default. Unknown keys fall back to a template with no defaults set (not
 *  reachable via normal call sites — only if EMAIL_TEMPLATE_DEFS and a call
 *  site's key ever drift apart). */
export function renderEmailTemplate(key: string, vars: Record<string, string>): { subject: string; introText: string; introHtml: string } {
  const def = DEF_BY_KEY.get(key);
  const override = db.data?.emailTemplates.find((t) => t.id === key);
  const subjectSrc = override?.subject || def?.defaultSubject || "";
  const introSrc = override?.intro || def?.defaultIntro || "";
  const subject = substitute(subjectSrc, vars);
  const introText = substitute(introSrc, vars);
  // HTML body: escape the static template text AND every variable value
  // independently before substituting. Escaping only the shell (and not the
  // values) would let a maliciously-named exam or user ("<img onerror=...>")
  // inject raw markup into the rendered email — vars here are attacker-
  // reachable (exam titles, user names), the template text is not.
  const escapedVars = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, esc(v)]));
  const introHtml = substitute(esc(introSrc), escapedVars);
  return { subject, introText, introHtml };
}

export function safeDefault(key: string): EmailTemplateDef | undefined {
  return DEF_BY_KEY.get(key);
}
