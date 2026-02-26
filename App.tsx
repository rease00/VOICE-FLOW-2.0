
import React, { useState, useEffect } from 'react';
import { AppScreen } from './types';
import { UserProvider, useUser } from './contexts/UserContext';
import { Onboarding } from './views/Onboarding';
import { Login } from './views/Login';
import { MainApp } from './views/MainApp';
import { Profile } from './views/Profile';
import { SubscriptionModal } from './components/SubscriptionModal';

interface AppErrorBoundaryState {
  message: string;
}

const AppErrorBoundary: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [uiError, setUiError] = useState<AppErrorBoundaryState>({ message: '' });

  useEffect(() => {
    const onWindowError = (event: ErrorEvent): void => {
      const message = event.error?.message || event.message || 'Unknown render error';
      console.error('[ui.error_boundary]', event.error || message);
      setUiError({ message });
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
      const reason = event.reason;
      const message = reason?.message || String(reason || 'Unhandled rejection');
      console.error('[ui.error_boundary.unhandled_rejection]', reason);
      setUiError({ message });
    };
    window.addEventListener('error', onWindowError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => {
      window.removeEventListener('error', onWindowError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, []);

  if (uiError.message) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-slate-950 text-slate-100 p-6">
        <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
          <h1 className="text-lg font-bold">Interface Error</h1>
          <p className="mt-2 text-sm text-slate-300">
            The UI hit a runtime error. You can retry without restarting services.
          </p>
          <pre className="mt-3 max-h-40 overflow-auto rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-rose-300 custom-scrollbar">
            {uiError.message}
          </pre>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => setUiError({ message: '' })}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              Retry UI
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
            >
              Reload App
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

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
    <div className="vf-root-shell w-full min-h-screen font-sans" style={{ color: 'var(--vf-text)' }}>
      <div className="vf-screen-layer">
        {renderScreen()}
        <SubscriptionModal />
      </div>
    </div>
  );
};

const App: React.FC = () => {
  return (
    <UserProvider>
      <AppErrorBoundary>
        <AppContent />
      </AppErrorBoundary>
    </UserProvider>
  );
};

export default App;
