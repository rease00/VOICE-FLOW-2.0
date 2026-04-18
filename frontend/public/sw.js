/* eslint-disable no-restricted-globals */
/**
 * Voice Flow service worker — minimal, dependency-free.
 * Strategy:
 *   - precache the app shell on install
 *   - network-first for HTML (always show fresh app)
 *   - stale-while-revalidate for /_next/static/* (cheap, fast)
 *   - cache-first for /audio/* + /icons/*
 *   - offline fallback to cached `/offline`
 *
 * Bumps `CACHE_VERSION` on deploy to invalidate old assets.
 */

const CACHE_VERSION = "vf-v1";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const MEDIA_CACHE = `${CACHE_VERSION}-media`;

const SHELL_URLS = ["/", "/offline", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => !k.startsWith(CACHE_VERSION))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never cache API routes — they're dynamic & may contain auth.
  if (url.pathname.startsWith("/api/")) return;

  // HTML — network first, fall back to shell cache, then offline page.
  if (req.mode === "navigate" || req.headers.get("accept")?.includes("text/html")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(req, clone));
          return res;
        })
        .catch(() =>
          caches.match(req).then((hit) => hit || caches.match("/offline")),
        ),
    );
    return;
  }

  // Static Next.js chunks — stale-while-revalidate.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(STATIC_CACHE).then((cache) =>
        cache.match(req).then((hit) => {
          const fetcher = fetch(req)
            .then((res) => {
              if (res.ok) cache.put(req, res.clone());
              return res;
            })
            .catch(() => hit);
          return hit || fetcher;
        }),
      ),
    );
    return;
  }

  // Audio + icons — cache first.
  if (
    url.pathname.startsWith("/audio/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/icon.svg"
  ) {
    event.respondWith(
      caches.open(MEDIA_CACHE).then((cache) =>
        cache.match(req).then(
          (hit) =>
            hit ||
            fetch(req).then((res) => {
              if (res.ok) cache.put(req, res.clone());
              return res;
            }),
        ),
      ),
    );
  }
});

// Listen for client-triggered cache busts (e.g., on logout).
self.addEventListener("message", (event) => {
  if (event.data?.type === "VF_CLEAR_CACHE") {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))),
    );
  }

  // Allow the client to trigger skipWaiting for SW updates.
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
