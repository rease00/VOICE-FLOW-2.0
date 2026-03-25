import React from 'react';
import { BookOpen, BookText, History, Mic, Radio, ShieldCheck, UserRound } from 'lucide-react';

export enum WorkspaceTab {
  STUDIO = 'STUDIO',
  PODCAST = 'PODCAST',
  LAB = 'LAB',
  READER = 'READER',
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

export const buildWorkspaceTabs = (isAdmin: boolean): WorkspaceTabItem[] => {
  const tabs: WorkspaceTabItem[] = [
    { id: WorkspaceTab.STUDIO, icon: <Mic size={18} />, label: 'Studio' },
    { id: WorkspaceTab.PODCAST, icon: <Radio size={18} />, label: 'Podcast' },
    { id: WorkspaceTab.READER, icon: <BookText size={18} />, label: 'Reader' },
    { id: WorkspaceTab.NOVEL, icon: <BookOpen size={18} />, label: 'Novel' },
    { id: WorkspaceTab.CHARACTERS, icon: <UserRound size={18} />, label: 'Character' },
    { id: WorkspaceTab.HISTORY, icon: <History size={18} />, label: 'History' },
  ];
  if (isAdmin) {
    tabs.push({ id: WorkspaceTab.ADMIN, icon: <ShieldCheck size={18} />, label: 'Admin' });
  }
  return tabs;
};
