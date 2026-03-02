import React, { useEffect, useState } from 'react';
import { SubscriptionModal } from '../../../components/SubscriptionModal';
import { useUser } from '../../features/auth/context/UserContext';
import { AppScreen } from '../../entities/contracts';
import { Login } from '../../pages/Login';
import { MainApp } from '../../pages/MainApp';
import { Onboarding } from '../../pages/Onboarding';
import { Profile } from '../../pages/Profile';

export const ScreenRouter: React.FC = () => {
  const [currentScreen, setCurrentScreen] = useState<AppScreen>(AppScreen.ONBOARDING);
  const { user } = useUser();

  useEffect(() => {
    if (user.email && (currentScreen === AppScreen.LOGIN || currentScreen === AppScreen.ONBOARDING)) {
      setCurrentScreen(AppScreen.MAIN);
    }
  }, [user, currentScreen]);

  const renderScreen = () => {
    switch (currentScreen) {
      case AppScreen.ONBOARDING:
        return <Onboarding setScreen={setCurrentScreen} />;
      case AppScreen.LOGIN:
        return <Login setScreen={setCurrentScreen} />;
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
        {renderScreen()}
        <SubscriptionModal />
      </div>
    </div>
  );
};
