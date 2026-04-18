'use client';

import React, { Suspense, lazy } from 'react';

import { UserProvider } from '../../features/auth/context/UserContext';
import { NotificationProvider } from '../../shared/notifications/NotificationProvider';

const NotificationUI = lazy(async () =>
  import('../../shared/notifications/NotificationUI').then((module) => ({ default: module.NotificationUI })),
);

export const FullAppProviders: React.FC<React.PropsWithChildren> = ({ children }) => {
  return (
    <UserProvider>
      <NotificationProvider>
        {children}
        <Suspense fallback={null}>
          <NotificationUI />
        </Suspense>
      </NotificationProvider>
    </UserProvider>
  );
};
