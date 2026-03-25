import { AppScreen } from '../../entities/contracts';

export const resolveInitialScreen = (search: string, isDev: boolean): AppScreen => {
  if (!isDev) return AppScreen.ONBOARDING;
  const forced = String(new URLSearchParams(search).get('vf-screen') || '').trim().toLowerCase();
  if (forced === 'login') return AppScreen.LOGIN;
  if (forced === 'uid' || forced === 'userid' || forced === 'user-id') return AppScreen.USER_ID_SETUP;
  if (forced === 'main') return AppScreen.MAIN;
  if (forced === 'profile') return AppScreen.PROFILE;
  return AppScreen.ONBOARDING;
};

export interface ResolveSessionScreenArgs {
  authReady: boolean;
  currentScreen: AppScreen;
  hasSession: boolean;
  canOpenAdminConsole: boolean;
  needsUserIdSetup: boolean;
  hasUserId: boolean;
}

export const resolveSessionScreen = ({
  authReady,
  currentScreen,
  hasSession,
  canOpenAdminConsole,
  needsUserIdSetup,
  hasUserId,
}: ResolveSessionScreenArgs): AppScreen | null => {
  if (!authReady) return null;

  if (!hasSession) {
    if (currentScreen === AppScreen.USER_ID_SETUP) return AppScreen.LOGIN;
    if (currentScreen === AppScreen.PROFILE) return AppScreen.LOGIN;
    return null;
  }

  if (canOpenAdminConsole) {
    if (
      currentScreen === AppScreen.LOGIN ||
      currentScreen === AppScreen.ONBOARDING ||
      currentScreen === AppScreen.USER_ID_SETUP
    ) {
      return AppScreen.MAIN;
    }
    return null;
  }

  if (needsUserIdSetup && currentScreen !== AppScreen.USER_ID_SETUP) {
    return AppScreen.USER_ID_SETUP;
  }

  if (!needsUserIdSetup && currentScreen === AppScreen.USER_ID_SETUP && hasUserId) {
    return AppScreen.MAIN;
  }

  if (currentScreen === AppScreen.LOGIN || currentScreen === AppScreen.ONBOARDING) {
    return AppScreen.MAIN;
  }

  return null;
};
