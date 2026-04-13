import React from 'react';
import type { GenerationSettings } from '../../../../types';
import { NovelWorkspaceShell } from './NovelWorkspaceShell';

interface NovelTabContentProps {
  settings: GenerationSettings;
  onToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  onSendToStudio?: ((content: string) => void) | undefined;
}

export const NovelTabContent: React.FC<NovelTabContentProps> = ({
  settings,
  onToast,
  onSendToStudio,
}) => {
  return (
    <NovelWorkspaceShell
      settings={settings}
      onToast={onToast}
      onSendToStudio={onSendToStudio}
    />
  );
};
