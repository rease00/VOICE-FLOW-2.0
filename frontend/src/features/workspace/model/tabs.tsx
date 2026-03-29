import React from 'react';
import { BookOpen, BookText, History, Mic, ShieldCheck, UserRound } from 'lucide-react';

export enum WorkspaceTab {
  STUDIO = 'STUDIO',
  READER = 'READER',
  VOICE_CLONING = 'VOICE_CLONING',
  CHARACTERS = 'CHARACTERS',
  NOVEL = 'NOVEL',
  HISTORY = 'HISTORY',
  ADMIN = 'ADMIN',
}

export interface WorkspaceTabItem {
  id: WorkspaceTab;
  icon: React.ReactNode;
  label: string;
}

export interface WorkspacePreloadTargetOptions {
  allowReaderPreload?: boolean;
  allowNextPreloadFromStudio?: boolean;
}

export const buildWorkspaceTabs = (isAdmin: boolean): WorkspaceTabItem[] => {
  const tabs: WorkspaceTabItem[] = [
    { id: WorkspaceTab.STUDIO, icon: <Mic size={18} />, label: 'Studio' },
    { id: WorkspaceTab.READER, icon: <BookText size={18} />, label: 'Reader' },
    { id: WorkspaceTab.VOICE_CLONING, icon: <Mic size={18} />, label: 'Voice Cloning' },
    { id: WorkspaceTab.NOVEL, icon: <BookOpen size={18} />, label: 'Novel' },
    { id: WorkspaceTab.CHARACTERS, icon: <UserRound size={18} />, label: 'Character' },
    { id: WorkspaceTab.HISTORY, icon: <History size={18} />, label: 'History' },
  ];
  if (isAdmin) {
    tabs.push({ id: WorkspaceTab.ADMIN, icon: <ShieldCheck size={18} />, label: 'Admin' });
  }
  return tabs;
};

export const resolveWorkspaceNextPreloadTab = (
  tabs: WorkspaceTabItem[],
  activeTab: WorkspaceTab,
  options: WorkspacePreloadTargetOptions = {}
): WorkspaceTab | null => {
  const activeIndex = tabs.findIndex((item) => item.id === activeTab);
  if (activeIndex < 0) return null;

  const nextTab = tabs[activeIndex + 1]?.id;
  if (!nextTab) return null;

  if (activeTab === WorkspaceTab.STUDIO && options.allowNextPreloadFromStudio !== true) {
    return null;
  }
  if (nextTab === WorkspaceTab.READER && options.allowReaderPreload !== true) {
    return null;
  }
  return nextTab;
};
