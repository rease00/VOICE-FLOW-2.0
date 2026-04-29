// No-op service worker for frozen snapshot shells in local React Router dev.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
