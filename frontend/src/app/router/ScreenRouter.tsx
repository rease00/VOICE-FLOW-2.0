import React, { Suspense, lazy, useEffect, useState } from 'react';
import { SubscriptionModal } from '../../../components/SubscriptionModal';
import { useUser } from '../../features/auth/context/UserContext';
import { AppScreen } from '../../entities/contracts';
import { hasAdminConsoleAccess } from '../../shared/auth/adminAccess';
import { NOTIFICATION_DEEP_LINK_EVENT, readNotificationDeepLink } from '../../shared/notifications/deepLink';
import { STORAGE_KEYS } from '../../shared/storage/keys';
import { readStorageString, removeStorageKey } from '../../shared/storage/localStore';
import { resolveInitialScreen, resolveSessionScreen } from './screenRouting';

const loadLogin = async () => import('../../pages/Login').then((module) => ({ default: module.Login }));
const loadMainApp = async () => import('../../pages/MainApp').then((module) => ({ default: module.MainApp }));
const loadOnboarding = async () => import('../../pages/Onboarding').then((module) => ({ default: module.Onboarding }));
const loadProfile = async () => import('../../pages/Profile').then((module) => ({ default: module.Profile }));
const loadUserIdSetup = async () => import('../../pages/UserIdSetup').then((module) => ({ default: module.UserIdSetup }));

const Login = lazy(loadLogin);
const MainApp = lazy(loadMainApp);
const Onboarding = lazy(loadOnboarding);
const Profile = lazy(loadProfile);
const UserIdSetup = lazy(loadUserIdSetup);
const screenRouterEnv = (import.meta as any).env || {};

export const ScreenRouter: React.FC = () => {
  const [currentScreen, setCurrentScreen] = useState<AppScreen>(() =>
    typeof window === 'undefined'
      ? AppScreen.ONBOARDING
      : resolveInitialScreen(window.location.search, Boolean(screenRouterEnv.DEV))
  );
  const { user, authReady, isAuthenticated } = useUser();
  const canOpenAdminConsole = hasAdminConsoleAccess(user);

  useEffect(() => {
    if (currentScreen === AppScreen.ONBOARDING) {
      void loadLogin().catch(() => undefined);
      return;
    }
    if (currentScreen === AppScreen.LOGIN) {
      void Promise.allSettled([loadMainApp(), loadUserIdSetup()]);
      return;
    }
    if (currentScreen === AppScreen.MAIN) {
      void loadProfile().catch(() => undefined);
    }
  }, [currentScreen]);

  useEffect(() => {
    const syncFromDeepLink = (): void => {
      const target = readNotificationDeepLink();
      const screenToken = String(target.screen || '').trim().toLowerCase();
      if (screenToken === 'main') setCurrentScreen(AppScreen.MAIN);
      else if (screenToken === 'profile') setCurrentScreen(AppScreen.PROFILE);
      else if (screenToken === 'login') setCurrentScreen(AppScreen.LOGIN);
      else if (screenToken === 'uid' || screenToken === 'userid' || screenToken === 'user-id') {
        setCurrentScreen(AppScreen.USER_ID_SETUP);
      }
    };
    window.addEventListener(NOTIFICATION_DEEP_LINK_EVENT, syncFromDeepLink as EventListener);
    return () => window.removeEventListener(NOTIFICATION_DEEP_LINK_EVENT, syncFromDeepLink as EventListener);
  }, []);

  useEffect(() => {
    if (!authReady) return;
    const needsUserIdSetup = readStorageString(STORAGE_KEYS.uidSetupRequired) === '1';
    if (canOpenAdminConsole) {
      removeStorageKey(STORAGE_KEYS.uidSetupRequired);
    }

    const nextScreen = resolveSessionScreen({
      authReady,
      currentScreen,
      hasSession: isAuthenticated || Boolean(user.email),
      canOpenAdminConsole,
      needsUserIdSetup,
      hasUserId: Boolean(user.userId),
    });

    if (nextScreen && nextScreen !== currentScreen) {
      setCurrentScreen(nextScreen);
    }
  }, [authReady, canOpenAdminConsole, currentScreen, isAuthenticated, user.email, user.userId]);

  const renderScreen = () => {
    switch (currentScreen) {
      case AppScreen.ONBOARDING:
        return <Onboarding setScreen={setCurrentScreen} />;
      case AppScreen.LOGIN:
        return <Login setScreen={setCurrentScreen} />;
      case AppScreen.USER_ID_SETUP:
        return <UserIdSetup setScreen={setCurrentScreen} />;
      case AppScreen.MAIN:
        return <MainApp setScreen={setCurrentScreen} />;
      case AppScreen.PROFILE:
        return <Profile setScreen={setCurrentScreen} />;
      default:
        return <Onboarding setScreen={setCurrentScreen} />;
    }
  };

  return (
    <div className="vf-root-shell w-full min-h-screen font-sans" style={{ color: 'var(--vf-text)' }}>
      <div className="vf-screen-layer">
        <Suspense
          fallback={
            <div className="flex min-h-screen items-center justify-center text-sm opacity-80">
              Loading workspace...
            </div>
          }
        >
          {authReady ? renderScreen() : (
            <div className="flex min-h-screen items-center justify-center text-sm opacity-80">
              Restoring workspace...
            </div>
          )}
        </Suspense>
        <SubscriptionModal />
      </div>
    </div>
  );
};
