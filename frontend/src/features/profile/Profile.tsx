'use client';
import React from 'react';
import { AppScreen } from '../../../types';
import { ProfileAccountView } from '../../../components/account/ProfileAccountView';

export const Profile: React.FC<{ setScreen: (s: AppScreen) => void }> = ({ setScreen }) => {
  return <ProfileAccountView setScreen={setScreen} />;
};
