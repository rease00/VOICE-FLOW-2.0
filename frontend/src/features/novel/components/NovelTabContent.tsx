import React from 'react';
import type { GenerationSettings } from '../../../../types';
import { NovelWorkspaceV2 } from '../../../../components/NovelWorkspaceV2';

interface NovelTabContentProps {
  settings: GenerationSettings;
  mediaBackendUrl: string;
  onToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  onSendToStudio?: (content: string) => void;
}

export const NovelTabContent: React.FC<NovelTabContentProps> = ({
  settings,
  mediaBackendUrl,
  onToast,
  onSendToStudio,
}) => {
  return (
    <NovelWorkspaceV2
      settings={settings}
      mediaBackendUrl={mediaBackendUrl}
      onToast={onToast}
      onSendToStudio={onSendToStudio}
    />
  );
};
