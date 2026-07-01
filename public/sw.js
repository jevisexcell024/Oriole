/*
 * Orcalis Assess service worker — installability + faster loads, NOTHING risky.
 *
 * Hard rules for an exam platform:
 *  - The API is NEVER cached. Every /api request goes straight to the network, so
 *    exam delivery, answer sync, proctoring and submission are always live and a
 *    candidate can never be served stale or offline exam data.
 *  - Only same-origin GETs for static files are cached.
 *  - Hashed build assets (/assets/*) are immutable → cache-first (fast repeat loads).
 *  - Page navigations are network-first (so a new deploy is picked up immediately),
 *    falling back to a cached shell only when fully offline.
 */
const CACHE = "orcalis-static-v1";
const SHELL = ["/", "/index.html", "/icon-192.png", "/icon-512.png", "/shield.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only same-origin GETs. Never the API, never non-GET — keep exam traffic live.
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api")) return;

  // Immutable hashed build assets → cache-first.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(req).then((hit) =>
        hit || fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        }),
      ),
    );
    return;
  }

  // Page navigations → network-first, cached shell as offline fallback.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/index.html", copy));
          return res;
        })
        .catch(() => caches.match("/index.html")),
    );
  }
});
