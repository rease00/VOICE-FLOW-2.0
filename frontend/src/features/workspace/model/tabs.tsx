import React from 'react';
import { BookOpen, Film, Fingerprint, History, Mic, Shield, Users } from 'lucide-react';

export enum WorkspaceTab {
  STUDIO = 'STUDIO',
  LAB = 'LAB',
  DUBBING = 'DUBBING',
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
  const base: WorkspaceTabItem[] = [
    { id: WorkspaceTab.STUDIO, icon: <Mic size={18} />, label: 'Studio' },
    { id: WorkspaceTab.NOVEL, icon: <BookOpen size={18} />, label: 'Novel Workspace' },
    { id: WorkspaceTab.DUBBING, icon: <Film size={18} />, label: 'Video Dub' },
    { id: WorkspaceTab.CHARACTERS, icon: <Users size={18} />, label: 'Characters' },
    { id: WorkspaceTab.LAB, icon: <Fingerprint size={18} />, label: 'Voice Lab' },
    { id: WorkspaceTab.HISTORY, icon: <History size={18} />, label: 'History' },
  ];

  if (isAdmin) {
    base.push({ id: WorkspaceTab.ADMIN, icon: <Shield size={18} />, label: 'Admin' });
  }
  return base;
};
