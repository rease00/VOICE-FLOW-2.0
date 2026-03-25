import { AppScreen } from '../../types';

export const APP_ROUTE_PATHS = {
  main: '/app',
  login: '/app/login',
  onboarding: '/app/onboarding',
  userIdSetup: '/app/user-id-setup',
  profile: '/app/profile',
} as const;

export type AppRoutePath = typeof APP_ROUTE_PATHS[keyof typeof APP_ROUTE_PATHS];

export const resolveAppPath = (screen: AppScreen): AppRoutePath => {
  switch (screen) {
    case AppScreen.LOGIN:
      return APP_ROUTE_PATHS.login;
    case AppScreen.ONBOARDING:
      return APP_ROUTE_PATHS.onboarding;
    case AppScreen.USER_ID_SETUP:
      return APP_ROUTE_PATHS.userIdSetup;
    case AppScreen.PROFILE:
      return APP_ROUTE_PATHS.profile;
    case AppScreen.MAIN:
    default:
      return APP_ROUTE_PATHS.main;
  }
};

export const resolveAppScreenFromPathname = (pathname: string): AppScreen | null => {
  const safePath = String(pathname || '').trim().replace(/\/+$/, '') || '/';
  switch (safePath) {
    case APP_ROUTE_PATHS.login:
      return AppScreen.LOGIN;
    case APP_ROUTE_PATHS.onboarding:
      return AppScreen.ONBOARDING;
    case APP_ROUTE_PATHS.userIdSetup:
      return AppScreen.USER_ID_SETUP;
    case APP_ROUTE_PATHS.profile:
      return AppScreen.PROFILE;
    case APP_ROUTE_PATHS.main:
      return AppScreen.MAIN;
    default:
      return null;
  }
};
