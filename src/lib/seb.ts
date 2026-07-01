// Detect whether the page is running inside Safe Exam Browser.
//
// This is only a UX aid — it decides whether to show the "Open in Safe Exam
// Browser" gate before a request is made. The authoritative check is server-
// side (SEB Config/Browser-Exam-Key hash verification in server/seb.ts); a
// candidate can't get exam data or submit outside a verified SEB session
// regardless of what this returns.
export function isRunningInSeb(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/\bSEB[\s/]|SafeExamBrowser/i.test(ua)) return true;
  // SEB 3+ exposes a JS API object on the window.
  return typeof (window as unknown as { SafeExamBrowser?: unknown }).SafeExamBrowser !== "undefined";
}

/** A `seb(s)://` launch link forces an installed SEB to open the given URL/config. */
export function sebLaunchHref(raw: string | null | undefined): string | null {
  const url = (raw ?? "").trim();
  return url.length > 0 ? url : null;
}
