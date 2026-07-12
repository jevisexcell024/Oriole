// Shared, dependency-free validation for user-uploaded `data:` URLs — used by
// both the exam file-upload answer path and the library resource-upload path.

/** Defence against a spoofed declared type: sniff the decoded head of a
 *  `data:` URL for markup/script, regardless of what MIME type it claims. */
export function looksLikeMarkupOrScript(dataUrl: string): boolean {
  let head = "";
  try {
    head = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1, dataUrl.indexOf(",") + 200), "base64")
      .toString("utf8")
      .trim()
      .toLowerCase();
  } catch {
    return false; // binary content that doesn't decode as text — fine.
  }
  return /^(<!doctype|<html|<svg|<\?xml|<script)/.test(head);
}
