import { describe, expect, it } from 'vitest';
import { requiresAuthenticatedScreen, resolveScreenFromSearch } from '../src/app/router/screenRouting';
import { AppScreen } from '../src/entities/contracts';

describe('requiresAuthenticatedScreen', () => {
  it('requires authentication for main and profile screens', () => {
    expect(requiresAuthenticatedScreen(AppScreen.MAIN)).toBe(true);
    expect(requiresAuthenticatedScreen(AppScreen.PROFILE)).toBe(true);
    expect(requiresAuthenticatedScreen(AppScreen.USER_ID_SETUP)).toBe(false);
  });

  it('does not require authentication for onboarding and login', () => {
    expect(requiresAuthenticatedScreen(AppScreen.ONBOARDING)).toBe(false);
    expect(requiresAuthenticatedScreen(AppScreen.LOGIN)).toBe(false);
  });
});

describe('resolveScreenFromSearch', () => {
  it('resolves login and profile deep links from query string', () => {
    expect(resolveScreenFromSearch('?vf-screen=login')).toBe(AppScreen.LOGIN);
    expect(resolveScreenFromSearch('?vf-screen=profile')).toBe(AppScreen.PROFILE);
  });

  it('maps legacy uid deep links into the main app screen and ignores unknown values', () => {
    expect(resolveScreenFromSearch('?vf-screen=user-id')).toBe(AppScreen.MAIN);
    expect(resolveScreenFromSearch('?vf-screen=unknown')).toBeNull();
    expect(resolveScreenFromSearch('')).toBeNull();
  });
});
