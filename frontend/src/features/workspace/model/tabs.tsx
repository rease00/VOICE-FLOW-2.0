import React from 'react';
import { BookOpen, Film, History, Mic, Shield, Users, Volume2 } from 'lucide-react';

export enum WorkspaceTab {
  STUDIO = 'STUDIO',
  LAB = 'LAB',
  PODCAST = 'PODCAST',
  CHARACTERS = 'CHARACTERS',
  NOVEL = 'NOVEL',
  READER = 'READER',
  HISTORY = 'HISTORY',
  ADMIN = 'ADMIN',
}

export interface WorkspaceTabItem {
  id: WorkspaceTab;
  icon: React.ReactNode;
  label: string;
}

export const buildWorkspaceTabs = (isAdmin: boolean): WorkspaceTabItem[] => {
  const base: WorkspaceTabItem[] = [
    { id: WorkspaceTab.STUDIO, icon: <Mic size={18} />, label: 'Studio' },
    { id: WorkspaceTab.NOVEL, icon: <BookOpen size={18} />, label: 'Novel Workspace' },
    { id: WorkspaceTab.READER, icon: <Volume2 size={18} />, label: 'Reader' },
    { id: WorkspaceTab.PODCAST, icon: <Film size={18} />, label: 'Podcast' },
    { id: WorkspaceTab.CHARACTERS, icon: <Users size={18} />, label: 'Characters' },
    { id: WorkspaceTab.HISTORY, icon: <History size={18} />, label: 'History' },
  ];

  if (isAdmin) {
    base.push({ id: WorkspaceTab.ADMIN, icon: <Shield size={18} />, label: 'Admin' });
  }
  return base;
};
