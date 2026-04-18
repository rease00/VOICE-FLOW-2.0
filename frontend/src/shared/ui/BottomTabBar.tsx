'use client';

import React from 'react';
import {
  BookOpen,
  Mic,
  PenTool,
  Wallet,
  MoreHorizontal,
} from 'lucide-react';

export type BottomTab = 'library' | 'studio' | 'writing' | 'wallet' | 'more';

interface BottomTabBarProps {
  activeTab: BottomTab;
  onTabChange: (tab: BottomTab) => void;
  className?: string;
}

const TABS: { key: BottomTab; label: string; icon: React.ReactNode }[] = [
  { key: 'library', label: 'Readers', icon: <BookOpen className="h-5 w-5" /> },
  { key: 'studio', label: 'Studio', icon: <Mic className="h-5 w-5" /> },
  { key: 'writing', label: 'Writing', icon: <PenTool className="h-5 w-5" /> },
  { key: 'wallet', label: 'Wallet', icon: <Wallet className="h-5 w-5" /> },
  { key: 'more', label: 'More', icon: <MoreHorizontal className="h-5 w-5" /> },
];

/**
 * Mobile bottom tab bar — visible only below md breakpoint.
 * Fixed to bottom, 56px height, icon + label.
 */
export default function BottomTabBar({ activeTab, onTabChange, className = '' }: BottomTabBarProps) {
  return (
    <nav
      className={`fixed inset-x-0 bottom-0 z-40 flex h-14 items-center border-t border-slate-700/60 bg-slate-900/95 backdrop-blur-md md:hidden ${className}`}
      role="tablist"
    >
      {TABS.map((tab) => {
        const isActive = tab.key === activeTab;
        return (
          <button
            key={tab.key}
            role="tab"
            aria-selected={isActive}
            onClick={() => onTabChange(tab.key)}
            className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 py-1 transition ${
              isActive ? 'text-indigo-400' : 'text-slate-500'
            }`}
          >
            {tab.icon}
            <span className="text-[10px] font-medium">{tab.label}</span>
            {isActive && (
              <span className="absolute top-0 h-0.5 w-8 rounded-full bg-indigo-400" />
            )}
          </button>
        );
      })}
    </nav>
  );
}
