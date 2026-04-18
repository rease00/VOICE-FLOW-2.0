import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

import { proxy } from '../proxy';

describe('proxy CSP', () => {
  it('allows dev-only eval and local backend access on localhost', () => {
    const response = proxy(new NextRequest('http://localhost:3000/app/library'));
    const csp = String(response.headers.get('Content-Security-Policy') || '');

    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain('http://127.0.0.1:7800');
    expect(csp).toContain('http://localhost:7800');
  });

  it('treats 0.0.0.0 loopback requests as local development traffic', () => {
    const response = proxy(new NextRequest('http://0.0.0.0:3000/app/library'));
    const csp = String(response.headers.get('Content-Security-Policy') || '');

    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain('ws://localhost:*');
    expect(csp).toContain('http://0.0.0.0:7800');
  });

  it('keeps hosted origins on the stricter policy', () => {
    const response = proxy(new NextRequest('https://voiceflow.example/app/library'));
    const csp = String(response.headers.get('Content-Security-Policy') || '');

    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toContain('http://127.0.0.1:7800');
    expect(csp).not.toContain('http://localhost:7800');
  });

  it('redirects unauthenticated protected routes to app login with a safe next param', () => {
    const response = proxy(new NextRequest('https://voiceflow.example/app/studio?tab=voices'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://voiceflow.example/app/login?mode=login&next=%2Fapp%2Fstudio%3Ftab%3Dvoices');
  });

  it('allows protected routes when a session cookie is present', () => {
    const response = proxy(new NextRequest('https://voiceflow.example/app/studio', {
      headers: {
        cookie: '__session=session-cookie',
      },
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });
});
