import { describe, expect, it } from 'vitest';
import { AppScreen } from '../../entities/contracts';
import { resolveAppScreenFromPathname, resolveSafeInternalNextPath } from '../navigation';
import { resolveInitialScreen, resolveSessionScreen } from './screenRouting';

describe('screenRouting', () => {
  it('keeps production entry on onboarding regardless of dev query hints', () => {
    expect(resolveInitialScreen('?vf-screen=login', false)).toBe(AppScreen.ONBOARDING);
  });

  it('respects dev deep links for supported screens', () => {
    expect(resolveInitialScreen('?vf-screen=login', true)).toBe(AppScreen.LOGIN);
    expect(resolveInitialScreen('?vf-screen=profile', true)).toBe(AppScreen.PROFILE);
    expect(resolveInitialScreen('?vf-screen=user-id', true)).toBe(AppScreen.MAIN);
  });

  it('holds routing decisions until auth bootstrap is ready', () => {
    expect(resolveSessionScreen({
      authReady: false,
      currentScreen: AppScreen.LOGIN,
      hasSession: true,
      canOpenAdminConsole: false,
    })).toBeNull();
  });

  it('redirects authenticated users away from login and onboarding', () => {
    expect(resolveSessionScreen({
      authReady: true,
      currentScreen: AppScreen.LOGIN,
      hasSession: true,
      canOpenAdminConsole: false,
    })).toBe(AppScreen.MAIN);

    expect(resolveSessionScreen({
      authReady: true,
      currentScreen: AppScreen.ONBOARDING,
      hasSession: true,
      canOpenAdminConsole: false,
    })).toBe(AppScreen.MAIN);
  });

  it('forces login when no session reaches profile', () => {
    expect(resolveSessionScreen({
      authReady: true,
      currentScreen: AppScreen.PROFILE,
      hasSession: false,
      canOpenAdminConsole: false,
    })).toBe(AppScreen.LOGIN);
  });

  it('keeps guest users in main workspace when no session is present', () => {
    expect(resolveSessionScreen({
      authReady: true,
      currentScreen: AppScreen.MAIN,
      hasSession: false,
      canOpenAdminConsole: false,
    })).toBeNull();
  });

  it('redirects legacy user-id setup screen into main workspace', () => {
    expect(resolveSessionScreen({
      authReady: true,
      currentScreen: AppScreen.USER_ID_SETUP,
      hasSession: true,
      canOpenAdminConsole: false,
    })).toBe(AppScreen.MAIN);
  });

  it('treats writing routes as main app routes and preserves internal next paths', () => {
    expect(resolveAppScreenFromPathname('/app/writing')).toBe(AppScreen.MAIN);
    expect(resolveSafeInternalNextPath('/app/writing?from=notify#top')).toBe('/app/writing?from=notify#top');
  });

  it('treats library and legacy reader routes as main app routes', () => {
    expect(resolveAppScreenFromPathname('/app/library')).toBe(AppScreen.MAIN);
    expect(resolveAppScreenFromPathname('/app/library/1342/read')).toBe(AppScreen.MAIN);
    expect(resolveAppScreenFromPathname('/app/reader')).toBe(AppScreen.MAIN);
    expect(resolveAppScreenFromPathname('/app/reader/novel/1342')).toBe(AppScreen.MAIN);
  });

  it('lets admin-authenticated sessions bypass login screens', () => {
    expect(resolveSessionScreen({
      authReady: true,
      currentScreen: AppScreen.LOGIN,
      hasSession: true,
      canOpenAdminConsole: true,
    })).toBe(AppScreen.MAIN);
  });
});
