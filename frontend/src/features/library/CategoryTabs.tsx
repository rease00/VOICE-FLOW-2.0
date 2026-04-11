'use client';

import React, { useState, useCallback } from 'react';

export type LibrarySortTab = 'new' | 'popular' | 'all';
export type PopularPeriod = 'week' | 'month';

interface CategoryTabsProps {
  activeTab: LibrarySortTab;
  onTabChange: (tab: LibrarySortTab) => void;
  popularPeriod?: PopularPeriod;
  onPeriodChange?: (period: PopularPeriod) => void;
  className?: string;
}

const TABS: { key: LibrarySortTab; label: string }[] = [
  { key: 'new', label: 'New' },
  { key: 'popular', label: 'Popular' },
  { key: 'all', label: 'All' },
];

export default function CategoryTabs({
  activeTab,
  onTabChange,
  popularPeriod = 'week',
  onPeriodChange,
  className = '',
}: CategoryTabsProps) {
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {/* Main tabs */}
      <div className="flex gap-1 overflow-x-auto scrollbar-hide">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => onTabChange(tab.key)}
            className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition ${
              activeTab === tab.key
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800/60 text-slate-400 hover:bg-slate-700/60 hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Popular sub-filter */}
      {activeTab === 'popular' && onPeriodChange && (
        <div className="flex gap-1">
          {(['week', 'month'] as PopularPeriod[]).map((p) => (
            <button
              key={p}
              onClick={() => onPeriodChange(p)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                popularPeriod === p
                  ? 'bg-slate-700 text-slate-100'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              This {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
