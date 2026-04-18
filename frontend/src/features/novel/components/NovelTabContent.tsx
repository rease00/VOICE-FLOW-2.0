import React from 'react';
import type { GenerationSettings } from '../../../../types';
import { NovelBookPlatform } from './NovelBookPlatform';

interface NovelTabContentProps {
  settings: GenerationSettings;
  onToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  onSendToStudio?: ((content: string, title?: string) => void) | undefined;
  embeddedMode?: boolean;
}

export const NovelTabContent: React.FC<NovelTabContentProps> = ({
  settings,
  onToast,
  onSendToStudio,
  embeddedMode = false,
}) => {
  return (
    <NovelBookPlatform
      settings={settings}
      onToast={onToast}
      onSwitchToStudio={onSendToStudio}
      embeddedMode={embeddedMode}
    />
  );
};
