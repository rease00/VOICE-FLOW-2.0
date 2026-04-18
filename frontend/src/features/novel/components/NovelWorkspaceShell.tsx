'use client';
import React from 'react';
import type { GenerationSettings } from '../../../../types';
import { NovelEditorProvider } from '../contexts/NovelEditorContext';
import { NovelBookPlatform } from './NovelBookPlatform';

type ToastFn = (msg: string, type?: 'success' | 'error' | 'info') => void;

interface NovelWorkspaceShellProps {
  settings: GenerationSettings;
  onToast: ToastFn;
  onSendToStudio?: ((content: string) => void) | undefined;
}

export const NovelWorkspaceShell: React.FC<NovelWorkspaceShellProps> = ({
  settings,
  onToast,
  onSendToStudio,
}) => {
  return (
    <NovelBookPlatform
      settings={settings}
      onToast={onToast}
      onSwitchToStudio={onSendToStudio}
    />
  );
};
