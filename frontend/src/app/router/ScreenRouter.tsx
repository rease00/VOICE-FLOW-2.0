import React, { useEffect, useState } from 'react';
import { SubscriptionModal } from '../../../components/SubscriptionModal';
import { useUser } from '../../../contexts/UserContext';
import { AppScreen } from '../../../types';
import { Login } from '../../../views/Login';
import { MainApp } from '../../../views/MainApp';
import { Onboarding } from '../../../views/Onboarding';
import { Profile } from '../../../views/Profile';

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
