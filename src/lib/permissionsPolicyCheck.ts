// Diagnoses whether this browser is actually allowed to use camera/microphone/
// geolocation on this page, by reading back the real Permissions-Policy header
// the network just delivered — instead of guessing from a getUserMedia/
// getCurrentPosition rejection, which looks identical whether the browser
// refused because a user clicked "Block" or because the *server* is blocking
// the feature outright (no prompt is ever shown in the latter case).
//
// This matters because three independent places can set this header for this
// app (the Node app's global middleware, the Node app's SPA-fallback route,
// and .htaccess on cPanel/Apache) and the last one actually applied wins
// silently — exactly the bug that broke geofencing for a while. A stale copy
// of this fetch (cache: "no-store") is the only way to see what's *really*
// in effect for a real user, through the real network path, right now.

export type PolicyFeatureState = "allowed" | "blocked" | "missing";

export interface PermissionsPolicyReport {
  /** The raw header value, or null if the fetch failed or the header was absent entirely. */
  raw: string | null;
  camera: PolicyFeatureState;
  microphone: PolicyFeatureState;
  geolocation: PolicyFeatureState;
  /** Set if the diagnostic fetch itself failed (network error, etc.) — the three
   *  feature states above are meaningless ("missing" by default) when this is set. */
  fetchError?: string;
}

function parseDirective(raw: string, feature: string): PolicyFeatureState {
  // Permissions-Policy syntax: "geolocation=(self), camera=*, microphone=()"
  // — an empty allowlist "()" means explicitly blocked for everyone, including
  // this same origin; anything else naming an allowlist ("*", "(self)", etc.)
  // means allowed; the directive being absent entirely means "missing" (its
  // fate then depends on the browser's own default, which shared hosts often
  // override with something restrictive — hence why this needs checking at all).
  const m = raw.match(new RegExp(`(?:^|,)\\s*${feature}=([^,]*)`));
  if (!m) return "missing";
  const val = m[1].trim();
  if (val === "()" || val === "") return "blocked";
  return "allowed";
}

let cached: Promise<PermissionsPolicyReport> | null = null;

/** Fetches this page's own URL fresh and reads back its real Permissions-Policy
 *  header. Cached per page load (the header doesn't change without a redeploy)
 *  — pass `force: true` to bypass the cache, e.g. for a manual "recheck" button. */
export function checkPermissionsPolicy(opts: { force?: boolean } = {}): Promise<PermissionsPolicyReport> {
  if (cached && !opts.force) return cached;
  cached = (async (): Promise<PermissionsPolicyReport> => {
    try {
      const res = await fetch(window.location.origin + "/", { cache: "no-store" });
      const raw = res.headers.get("permissions-policy");
      if (!raw) return { raw: null, camera: "missing", microphone: "missing", geolocation: "missing" };
      return {
        raw,
        camera: parseDirective(raw, "camera"),
        microphone: parseDirective(raw, "microphone"),
        geolocation: parseDirective(raw, "geolocation"),
      };
    } catch (e) {
      return { raw: null, camera: "missing", microphone: "missing", geolocation: "missing", fetchError: e instanceof Error ? e.message : String(e) };
    }
  })();
  return cached;
}
