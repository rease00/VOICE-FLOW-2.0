
import React, { useState, useEffect } from 'react';
import { Onboarding } from './views/Onboarding';
import { Login } from './views/Login';
import { MainApp } from './views/MainApp';
import { Profile } from './views/Profile';
import { AppScreen } from './types';
import { UserProvider, useUser } from './contexts/UserContext';
import { SubscriptionModal } from './components/SubscriptionModal';

const AppContent: React.FC = () => {
  const [currentScreen, setCurrentScreen] = useState<AppScreen>(AppScreen.ONBOARDING);
  const { user } = useUser();

  // Auto-redirect if logged in
  useEffect(() => {
    // Only redirect from Onboarding or Login if we have a valid user session
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
    <div className="w-full min-h-screen bg-gray-50 font-sans text-gray-900">
        {renderScreen()}
        <SubscriptionModal />
    </div>
  );
};

const App: React.FC = () => {
  return (
    <UserProvider>
      <AppContent />
    </UserProvider>
  );
};

export default App;
