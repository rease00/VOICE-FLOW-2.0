import React from 'react';
import type { GenerationSettings } from '../../../../types';
import { NovelWorkspaceShell } from './NovelWorkspaceShell';

interface NovelTabContentProps {
  settings: GenerationSettings;
  mediaBackendUrl: string;
  onToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  onSendToStudio?: ((content: string) => void) | undefined;
}

export const NovelTabContent: React.FC<NovelTabContentProps> = ({
  settings,
  mediaBackendUrl,
  onToast,
  onSendToStudio,
}) => {
  return (
    <NovelWorkspaceShell
      settings={settings}
      mediaBackendUrl={mediaBackendUrl}
      onToast={onToast}
      onSendToStudio={onSendToStudio}
    />
  );
};
