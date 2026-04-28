'use client';

import React from 'react';
import { FullAppProviders } from './FullAppProviders';

export const AppProviders: React.FC<React.PropsWithChildren> = ({ children }) => {
  return <FullAppProviders>{children}</FullAppProviders>;
};
