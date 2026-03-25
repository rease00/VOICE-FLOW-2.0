'use client';
import React from 'react';
import { UserProvider } from '../../features/auth/context/UserContext';
import { NotificationProvider } from '../../shared/notifications/NotificationProvider';
import { NotificationUI } from '../../shared/notifications/NotificationUI';

export const AppProviders: React.FC<React.PropsWithChildren> = ({ children }) => {
  return (
    <UserProvider>
      <NotificationProvider>
        {children}
        <NotificationUI />
      </NotificationProvider>
    </UserProvider>
  );
};
