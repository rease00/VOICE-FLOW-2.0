import React, { Suspense, lazy, useEffect, useState } from 'react';
import { SubscriptionModal } from '../../../components/SubscriptionModal';
import { useUser } from '../../features/auth/context/UserContext';
import { AppScreen } from '../../entities/contracts';
import { STORAGE_KEYS } from '../../shared/storage/keys';
import { readStorageString, removeStorageKey } from '../../shared/storage/localStore';

const Login = lazy(async () => import('../../pages/Login').then((module) => ({ default: module.Login })));
const MainApp = lazy(async () => import('../../pages/MainApp').then((module) => ({ default: module.MainApp })));
const Onboarding = lazy(async () => import('../../pages/Onboarding').then((module) => ({ default: module.Onboarding })));
const Profile = lazy(async () => import('../../pages/Profile').then((module) => ({ default: module.Profile })));
const UserIdSetup = lazy(async () => import('../../pages/UserIdSetup').then((module) => ({ default: module.UserIdSetup })));

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

  useEffect(() => {
    const hasSession = Boolean(user.email);
    if (!hasSession) {
      if (currentScreen === AppScreen.USER_ID_SETUP) {
        setCurrentScreen(AppScreen.LOGIN);
      }
      return;
    }

    const needsUserIdSetup = readStorageString(STORAGE_KEYS.uidSetupRequired) === '1';
    if (user.isAdmin) {
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
  }, [user, currentScreen]);

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
