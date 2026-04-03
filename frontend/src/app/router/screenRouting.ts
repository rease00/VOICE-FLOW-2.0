import { AppScreen } from '../../entities/contracts';

export const requiresAuthenticatedScreen = (screen: AppScreen): boolean => (
  screen === AppScreen.MAIN ||
  screen === AppScreen.PROFILE
);

export const resolveScreenFromSearch = (search: string): AppScreen | null => {
  const forced = String(new URLSearchParams(search).get('vf-screen') || '').trim().toLowerCase();
  if (forced === 'login') return AppScreen.LOGIN;
  if (forced === 'profile') return AppScreen.PROFILE;
  if (forced === 'uid' || forced === 'userid' || forced === 'user-id') return AppScreen.MAIN;
  if (forced === 'main') return AppScreen.MAIN;
  return null;
};

export const resolveInitialScreen = (search: string, isDev: boolean): AppScreen => {
  if (!isDev) return AppScreen.ONBOARDING;
  const forced = String(new URLSearchParams(search).get('vf-screen') || '').trim().toLowerCase();
  if (forced === 'login') return AppScreen.LOGIN;
  if (forced === 'uid' || forced === 'userid' || forced === 'user-id') return AppScreen.MAIN;
  if (forced === 'main') return AppScreen.MAIN;
  if (forced === 'profile') return AppScreen.PROFILE;
  return AppScreen.ONBOARDING;
};

export interface ResolveSessionScreenArgs {
  authReady: boolean;
  currentScreen: AppScreen;
  hasSession: boolean;
  canOpenAdminConsole: boolean;
}

export const resolveSessionScreen = ({
  authReady,
  currentScreen,
  hasSession,
  canOpenAdminConsole,
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
      currentScreen === AppScreen.ONBOARDING
    ) {
      return AppScreen.MAIN;
    }
    return null;
  }
  if (currentScreen === AppScreen.USER_ID_SETUP) {
    return AppScreen.MAIN;
  }

  if (currentScreen === AppScreen.LOGIN || currentScreen === AppScreen.ONBOARDING) {
    return AppScreen.MAIN;
  }

  return null;
};
