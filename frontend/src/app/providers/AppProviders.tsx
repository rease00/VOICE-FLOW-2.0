import React from 'react';
import { UserProvider } from '../../../contexts/UserContext';

export const AppProviders: React.FC<React.PropsWithChildren> = ({ children }) => {
  return <UserProvider>{children}</UserProvider>;
};
