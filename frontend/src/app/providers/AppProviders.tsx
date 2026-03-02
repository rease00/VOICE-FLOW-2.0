import React from 'react';
import { UserProvider } from '../../features/auth/context/UserContext';

export const AppProviders: React.FC<React.PropsWithChildren> = ({ children }) => {
  return <UserProvider>{children}</UserProvider>;
};
