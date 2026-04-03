import { describe, expect, it } from 'vitest';
import { APP_ROUTE_PATHS, resolveLoginPath, resolveSafeInternalNextPath } from '../src/app/navigation';

describe('login navigation helpers', () => {
  it('preserves mode and safe next path in the login URL', () => {
    const href = resolveLoginPath('signup', '/app/billing?resumeCheckout=1');

    expect(href).toBe('/app/login?mode=signup&next=%2Fapp%2Fbilling%3FresumeCheckout%3D1');
  });

  it('accepts allowlisted internal next paths and rejects unsafe targets', () => {
    expect(resolveSafeInternalNextPath('/billing?resumeCheckout=1', null)).toBe('/billing?resumeCheckout=1');
    expect(resolveSafeInternalNextPath('/billing?billing=success', null)).toBe('/billing?billing=success');
    expect(resolveSafeInternalNextPath('/app/billing?billing=success', null)).toBe('/app/billing?billing=success');
    expect(resolveSafeInternalNextPath('/app/login', null)).toBeNull();
    expect(resolveSafeInternalNextPath('https://evil.example/phish', APP_ROUTE_PATHS.main)).toBe(APP_ROUTE_PATHS.main);
  });

  it('drops unsafe next paths from the login URL', () => {
    const href = resolveLoginPath('login', 'https://evil.example/phish');

    expect(href).toBe('/app/login?mode=login');
  });
});
