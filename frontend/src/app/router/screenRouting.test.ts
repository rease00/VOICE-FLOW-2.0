import { describe, expect, it } from 'vitest';
import { AppScreen } from '../../entities/contracts';
import { resolveInitialScreen, resolveSessionScreen } from './screenRouting';

describe('screenRouting', () => {
  it('keeps production entry on onboarding regardless of dev query hints', () => {
    expect(resolveInitialScreen('?vf-screen=login', false)).toBe(AppScreen.ONBOARDING);
  });

  it('respects dev deep links for supported screens', () => {
    expect(resolveInitialScreen('?vf-screen=login', true)).toBe(AppScreen.LOGIN);
    expect(resolveInitialScreen('?vf-screen=profile', true)).toBe(AppScreen.PROFILE);
    expect(resolveInitialScreen('?vf-screen=user-id', true)).toBe(AppScreen.USER_ID_SETUP);
  });

  it('holds routing decisions until auth bootstrap is ready', () => {
    expect(resolveSessionScreen({
      authReady: false,
      currentScreen: AppScreen.LOGIN,
      hasSession: true,
      canOpenAdminConsole: false,
      needsUserIdSetup: false,
      hasUserId: true,
    })).toBeNull();
  });

  it('redirects authenticated users away from login and onboarding', () => {
    expect(resolveSessionScreen({
      authReady: true,
      currentScreen: AppScreen.LOGIN,
      hasSession: true,
      canOpenAdminConsole: false,
      needsUserIdSetup: false,
      hasUserId: true,
    })).toBe(AppScreen.MAIN);

    expect(resolveSessionScreen({
      authReady: true,
      currentScreen: AppScreen.ONBOARDING,
      hasSession: true,
      canOpenAdminConsole: false,
      needsUserIdSetup: false,
      hasUserId: true,
    })).toBe(AppScreen.MAIN);
  });

  it('forces login when no session reaches profile', () => {
    expect(resolveSessionScreen({
      authReady: true,
      currentScreen: AppScreen.PROFILE,
      hasSession: false,
      canOpenAdminConsole: false,
      needsUserIdSetup: false,
      hasUserId: false,
    })).toBe(AppScreen.LOGIN);
  });

  it('keeps guest users in main workspace when no session is present', () => {
    expect(resolveSessionScreen({
      authReady: true,
      currentScreen: AppScreen.MAIN,
      hasSession: false,
      canOpenAdminConsole: false,
      needsUserIdSetup: false,
      hasUserId: false,
    })).toBeNull();
  });

  it('routes incomplete profiles into user-id setup and exits once complete', () => {
    expect(resolveSessionScreen({
      authReady: true,
      currentScreen: AppScreen.MAIN,
      hasSession: true,
      canOpenAdminConsole: false,
      needsUserIdSetup: true,
      hasUserId: false,
    })).toBe(AppScreen.USER_ID_SETUP);

    expect(resolveSessionScreen({
      authReady: true,
      currentScreen: AppScreen.USER_ID_SETUP,
      hasSession: true,
      canOpenAdminConsole: false,
      needsUserIdSetup: false,
      hasUserId: true,
    })).toBe(AppScreen.MAIN);
  });

  it('lets admin-authenticated sessions bypass login and setup screens', () => {
    expect(resolveSessionScreen({
      authReady: true,
      currentScreen: AppScreen.LOGIN,
      hasSession: true,
      canOpenAdminConsole: true,
      needsUserIdSetup: true,
      hasUserId: false,
    })).toBe(AppScreen.MAIN);
  });
});
