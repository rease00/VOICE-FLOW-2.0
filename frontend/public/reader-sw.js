const READER_SHELL_CACHE = 'vf-reader-shell-v5';
const READER_SHELL_ROUTES = [
  '/brand-logo.svg',
  '/manifest.webmanifest',
  '/app/reader',
  '/reader',
  '/reader-sw.js',
];
const NO_CACHE_PATH_PREFIXES = ['/api/', '/app/api/', '/_next/webpack-hmr'];
const NO_CACHE_EXACT_PATHS = ['/_next/webpack-hmr'];
const NO_CACHE_SUFFIXES = ['.map', '.hot-update.js', '.hot-update.json'];
const READER_CACHEABLE_STATIC_PREFIXES = ['/_next/static/media/'];
const READER_ROUTE_PREFIXES = ['/app/reader', '/reader'];

const isNoCachePath = (pathname) => {
  const safePathname = String(pathname || '');
  return (
    NO_CACHE_EXACT_PATHS.includes(safePathname)
    || NO_CACHE_PATH_PREFIXES.some((prefix) => safePathname.startsWith(prefix))
    || NO_CACHE_SUFFIXES.some((suffix) => safePathname.endsWith(suffix))
  );
};

const isRouteInReaderShell = (pathname) => {
  const safePathname = String(pathname || '');
  return (
    READER_SHELL_ROUTES.includes(safePathname)
    || READER_ROUTE_PREFIXES.some((prefix) => safePathname.startsWith(`${prefix}/`))
  );
};

const isReaderCacheableStaticPath = (pathname) => {
  const safePathname = String(pathname || '');
  return READER_CACHEABLE_STATIC_PREFIXES.some((prefix) => safePathname.startsWith(prefix));
};

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(READER_SHELL_CACHE);
    await cache.addAll(READER_SHELL_ROUTES);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((name) => (
      name !== READER_SHELL_CACHE ? caches.delete(name) : Promise.resolve(true)
    )));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const requestUrl = new URL(request.url);
  if (request.mode === 'navigate') {
    if (!isRouteInReaderShell(requestUrl.pathname)) return;
    event.respondWith((async () => {
      try {
        const networkResponse = await fetch(request);
        if (networkResponse.ok) {
          const cache = await caches.open(READER_SHELL_CACHE);
          cache.put(request, networkResponse.clone()).catch(() => undefined);
        }
        return networkResponse;
      } catch {
        const cache = await caches.open(READER_SHELL_CACHE);
        const cached =
          await cache.match(request)
          || await cache.match('/app/reader')
          || await cache.match('/reader');
        return cached || Response.error();
      }
    })());
    return;
  }

  if (requestUrl.origin !== self.location.origin) return;
  if (isNoCachePath(requestUrl.pathname)) return;
  if (!isRouteInReaderShell(requestUrl.pathname) && !isReaderCacheableStaticPath(requestUrl.pathname)) return;

  event.respondWith((async () => {
    const cache = await caches.open(READER_SHELL_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      const networkResponse = await fetch(request);
      cache.put(request, networkResponse.clone()).catch(() => undefined);
      return networkResponse;
    } catch {
      return cached || Response.error();
    }
  })());
});
