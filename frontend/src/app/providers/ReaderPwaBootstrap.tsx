'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

const READER_SERVICE_WORKER_PATH = '/reader-sw.js';
const READER_SERVICE_WORKER_SCOPE = '/app/reader';
const READER_CACHE_PREFIX = 'vf-reader-shell-';
const isReaderRoute = (pathname: string | null | undefined): boolean => {
  const safePath = String(pathname || '').trim().toLowerCase();
  return safePath === '/app/reader'
    || safePath.startsWith('/app/reader/');
};

const isCanonicalReaderScope = (scopeUrl: string, origin: string): boolean => {
  const normalizedExpectedScope = new URL(`${READER_SERVICE_WORKER_SCOPE.replace(/\/+$/, '')}/`, origin).toString();
  return String(scopeUrl || '').replace(/\/+$/, '') === normalizedExpectedScope.replace(/\/+$/, '');
};

export const ReaderPwaBootstrap: React.FC = () => {
  const pathname = usePathname();
  const shouldBootstrap = isReaderRoute(pathname);

  useEffect(() => {
    if (!shouldBootstrap) return;
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    const unregisterReaderWorkers = async (options?: { legacyOnly?: boolean }): Promise<void> => {
      try {
        const canonicalOrigin = window.location.origin;
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(
          registrations
            .filter((registration) => {
              const installingUrl = registration.installing?.scriptURL || '';
              const waitingUrl = registration.waiting?.scriptURL || '';
              const activeUrl = registration.active?.scriptURL || '';
              return (
                installingUrl.includes(READER_SERVICE_WORKER_PATH)
                || waitingUrl.includes(READER_SERVICE_WORKER_PATH)
                || activeUrl.includes(READER_SERVICE_WORKER_PATH)
              );
            })
            .filter((registration) => (
              options?.legacyOnly !== true
              || !isCanonicalReaderScope(registration.scope, canonicalOrigin)
            ))
            .map((registration) => registration.unregister())
        );
      } catch {
        // Best effort only.
      }
    };

    const clearReaderCaches = async (): Promise<void> => {
      if (typeof caches === 'undefined') return;
      try {
        const cacheNames = await caches.keys();
        await Promise.all(
          cacheNames
            .filter((name) => name.startsWith(READER_CACHE_PREFIX))
            .map((name) => caches.delete(name))
        );
      } catch {
        // Best effort only.
      }
    };

    const bootstrap = async () => {
      // Dev-only cleanup prevents stale cached chunks from crashing the UI.
      if (process.env.NODE_ENV !== 'production') {
        await unregisterReaderWorkers();
        await clearReaderCaches();
        return;
      }

      try {
        await unregisterReaderWorkers({ legacyOnly: true });
        await navigator.serviceWorker.register(READER_SERVICE_WORKER_PATH, { scope: READER_SERVICE_WORKER_SCOPE });
      } catch {
        // Best effort only.
      }
    };

    void bootstrap();
  }, [shouldBootstrap]);

  return null;
};
