import React from 'react';
import type { GenerationSettings } from '../../../../types';
import { LibraryPlatform } from './LibraryPlatform';

interface LibraryTabContentProps {
  settings: GenerationSettings;
  onToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  onSendToStudio?: ((content: string) => void) | undefined;
}

export const LibraryTabContent: React.FC<LibraryTabContentProps> = ({
  settings,
  onToast,
  onSendToStudio,
}) => {
  return (
    <LibraryPlatform
      settings={settings}
      onToast={onToast}
      onSwitchToStudio={onSendToStudio}
    />
  );
};