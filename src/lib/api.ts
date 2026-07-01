// Thin fetch wrapper around the API. Cookies carry the session automatically.

// Default per-request timeout. Without this, a request that hangs during a
// server cold-start never settles, which can wedge polling loops (the dashboard
// retry) that guard against overlapping requests. 25s is comfortably longer
// than a warm response (~0.4s) and a normal cold start, but bounded.
const DEFAULT_TIMEOUT_MS = 25_000;

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    ...options,
    // Caller-provided signal wins; otherwise abort after the default timeout.
    signal: options.signal ?? (typeof AbortSignal !== "undefined" && AbortSignal.timeout
      ? AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
      : undefined),
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((data as { error?: string })?.error || `Request failed (${res.status})`);
  }
  return data as T;
}

// Reliably deliver a tiny payload even if the page is navigating/unloading
// (e.g. a violation that triggers an immediate auto-submit). `keepalive` lets
// the request outlive the page transition; we fall back to sendBeacon, then a
// plain fire-and-forget fetch. Used for proctor events so flags are never lost.
export function sendBeaconJson(path: string, body: unknown): void {
  const url = `/api${path}`;
  const payload = JSON.stringify(body ?? {});
  try {
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      const blob = new Blob([payload], { type: "application/json" });
      if (navigator.sendBeacon(url, blob)) return;
    }
  } catch { /* fall through to keepalive fetch */ }
  try {
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: payload,
      keepalive: true,
    }).catch(() => {});
  } catch { /* nothing more we can do */ }
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
