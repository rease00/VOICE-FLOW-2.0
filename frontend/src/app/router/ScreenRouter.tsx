import React, { Suspense, lazy, useEffect, useState } from 'react';
import { SubscriptionModal } from '../../../components/SubscriptionModal';
import { useUser } from '../../features/auth/context/UserContext';
import { AppScreen } from '../../entities/contracts';
import { hasAdminConsoleAccess } from '../../shared/auth/adminAccess';
import { NOTIFICATION_DEEP_LINK_EVENT, readNotificationDeepLink } from '../../shared/notifications/deepLink';
import { STORAGE_KEYS } from '../../shared/storage/keys';
import { readStorageString, removeStorageKey } from '../../shared/storage/localStore';

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

const resolveInitialScreen = (): AppScreen => {
  if (typeof window === 'undefined') return AppScreen.ONBOARDING;
  if (!import.meta.env.DEV) return AppScreen.ONBOARDING;
  const forced = String(new URLSearchParams(window.location.search).get('vf-screen') || '').trim().toLowerCase();
  if (forced === 'login') return AppScreen.LOGIN;
  if (forced === 'uid' || forced === 'userid' || forced === 'user-id') return AppScreen.USER_ID_SETUP;
  if (forced === 'main') return AppScreen.MAIN;
  if (forced === 'profile') return AppScreen.PROFILE;
  return AppScreen.ONBOARDING;
};

export const ScreenRouter: React.FC = () => {
  const [currentScreen, setCurrentScreen] = useState<AppScreen>(resolveInitialScreen);
  const { user } = useUser();
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
    const hasSession = Boolean(user.email);
    if (!hasSession) {
      if (currentScreen === AppScreen.USER_ID_SETUP) {
        setCurrentScreen(AppScreen.LOGIN);
      }
      return;
    }

    const needsUserIdSetup = readStorageString(STORAGE_KEYS.uidSetupRequired) === '1';
    if (canOpenAdminConsole) {
      removeStorageKey(STORAGE_KEYS.uidSetupRequired);
      if (
        currentScreen === AppScreen.LOGIN ||
        currentScreen === AppScreen.ONBOARDING ||
        currentScreen === AppScreen.USER_ID_SETUP
      ) {
        setCurrentScreen(AppScreen.MAIN);
      }
      return;
    }

    if (needsUserIdSetup && currentScreen !== AppScreen.USER_ID_SETUP) {
      setCurrentScreen(AppScreen.USER_ID_SETUP);
      return;
    }

    if (!needsUserIdSetup && currentScreen === AppScreen.USER_ID_SETUP && user.userId) {
      setCurrentScreen(AppScreen.MAIN);
      return;
    }

    if (currentScreen === AppScreen.LOGIN || currentScreen === AppScreen.ONBOARDING) {
      setCurrentScreen(AppScreen.MAIN);
    }
  }, [canOpenAdminConsole, currentScreen, user, user.userId]);

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
          {renderScreen()}
        </Suspense>
        <SubscriptionModal />
      </div>
    </div>
  );
};
