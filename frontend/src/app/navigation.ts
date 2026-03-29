import { AppScreen } from '../../types';

export const APP_ROUTE_PATHS = {
  main: '/app',
  buy: '/app/buy',
  login: '/app/login',
  onboarding: '/app/onboarding',
  userIdSetup: '/app/user-id-setup',
  profile: '/app/profile',
} as const;

export type AppRoutePath = typeof APP_ROUTE_PATHS[keyof typeof APP_ROUTE_PATHS];
export type AuthRouteMode = 'login' | 'signup';

const INTERNAL_NEXT_ALLOWLIST = new Set<string>([
  APP_ROUTE_PATHS.main,
  APP_ROUTE_PATHS.buy,
  APP_ROUTE_PATHS.onboarding,
  APP_ROUTE_PATHS.profile,
  APP_ROUTE_PATHS.userIdSetup,
  '/billing',
]);

const INTERNAL_NEXT_ORIGIN = 'https://voiceflow.internal';

const normalizeInternalPathname = (pathname: string): string => {
  const safePath = String(pathname || '').trim().replace(/\/+$/, '') || '/';
  return safePath === '' ? '/' : safePath;
};

const parseInternalNextPath = (candidate?: string | null): string | null => {
  const raw = String(candidate || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw, INTERNAL_NEXT_ORIGIN);
    if (url.origin !== INTERNAL_NEXT_ORIGIN) return null;
    const pathname = normalizeInternalPathname(url.pathname);
    if (!INTERNAL_NEXT_ALLOWLIST.has(pathname)) return null;
    return `${pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
};

export const resolveSafeInternalNextPath = (candidate?: string | null, fallback: string | null = null): string | null => {
  return parseInternalNextPath(candidate) || parseInternalNextPath(fallback);
};

export const resolveLoginPath = (mode?: AuthRouteMode, nextPath?: string | null): string => {
  const params = new URLSearchParams();
  if (mode) params.set('mode', mode);
  const safeNextPath = resolveSafeInternalNextPath(nextPath, null);
  if (safeNextPath) params.set('next', safeNextPath);
  if (!params.toString()) return APP_ROUTE_PATHS.login;
  return `${APP_ROUTE_PATHS.login}?${params.toString()}`;
};

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
    case APP_ROUTE_PATHS.buy:
      return AppScreen.MAIN;
    case APP_ROUTE_PATHS.main:
      return AppScreen.MAIN;
    default:
      return null;
  }
};
