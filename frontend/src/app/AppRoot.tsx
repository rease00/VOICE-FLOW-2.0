import React from 'react';
import { AppErrorBoundary } from './errors/AppErrorBoundary';
import { AppProviders } from './providers/AppProviders';
import { ScreenRouter } from './router/ScreenRouter';

const AppRoot: React.FC = () => {
  return (
    <AppProviders>
      <AppErrorBoundary>
        <ScreenRouter />
      </AppErrorBoundary>
    </AppProviders>
  );
};

export default AppRoot;
