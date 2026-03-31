import React from 'react';
import { BookOpen, BookText, Coins, History, Mic, ShieldCheck } from 'lucide-react';

export enum WorkspaceTab {
  STUDIO = 'STUDIO',
  READER = 'READER',
  VOICE_CLONING = 'VOICE_CLONING',
  NOVEL = 'NOVEL',
  HISTORY = 'HISTORY',
  BILLING = 'BILLING',
  ADMIN = 'ADMIN',
}

export type WorkspaceNavSection = 'create' | 'library' | 'account' | 'admin';

export const WORKSPACE_NAV_SECTION_LABELS: Record<WorkspaceNavSection, string> = {
  create: 'Create',
  library: 'Library',
  account: 'Account',
  admin: 'Admin',
};

export interface WorkspaceTabItem {
  id: WorkspaceTab;
  icon: React.ReactNode;
  label: string;
  displayLabel: string;
  section: WorkspaceNavSection;
  route: string;
}

export interface WorkspacePreloadTargetOptions {
  allowReaderPreload?: boolean;
  allowNextPreloadFromStudio?: boolean;
}

export const buildWorkspaceTabs = (isAdmin: boolean): WorkspaceTabItem[] => {
  const tabs: WorkspaceTabItem[] = [
    {
      id: WorkspaceTab.STUDIO,
      icon: <Mic size={18} />,
      label: 'Studio',
      displayLabel: 'Studio',
      section: 'create',
      route: '/app/studio',
    },
    {
      id: WorkspaceTab.VOICE_CLONING,
      icon: <Mic size={18} />,
      label: 'Voices',
      displayLabel: 'Voices',
      section: 'create',
      route: '/app/voices',
    },
    {
      id: WorkspaceTab.NOVEL,
      icon: <BookOpen size={18} />,
      label: 'Writing',
      displayLabel: 'Writing',
      section: 'create',
      route: '/app/writing',
    },
    {
      id: WorkspaceTab.READER,
      icon: <BookText size={18} />,
      label: 'Reader',
      displayLabel: 'Reader',
      section: 'library',
      route: '/app/reader',
    },
    {
      id: WorkspaceTab.HISTORY,
      icon: <History size={18} />,
      label: 'Runs',
      displayLabel: 'Runs',
      section: 'library',
      route: '/app/runs',
    },
    {
      id: WorkspaceTab.BILLING,
      icon: <Coins size={18} />,
      label: 'Billing',
      displayLabel: 'Billing',
      section: 'account',
      route: '/app/billing',
    },
  ];
  if (isAdmin) {
    tabs.push({
      id: WorkspaceTab.ADMIN,
      icon: <ShieldCheck size={18} />,
      label: 'Admin',
      displayLabel: 'Admin',
      section: 'admin',
      route: '/app/admin',
    });
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
