'use client';

import { useEffect } from 'react';

const DEV_LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1']);

export const DevCanonicalHostRedirect: React.FC = () => {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    const currentHost = String(window.location.hostname || '').trim().toLowerCase();
    if (!DEV_LOOPBACK_HOSTS.has(currentHost)) return;

    const nextUrl = new URL(window.location.href);
    if (nextUrl.hostname === 'localhost') return;
    nextUrl.hostname = 'localhost';
    window.location.replace(nextUrl.toString());
  }, []);

  return null;
};
