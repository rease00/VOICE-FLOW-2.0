'use client';
import React from 'react';
import { BookOpen, Mic, PenSquare, FileText, Sparkles } from 'lucide-react';

export type PlatformTab = 'writing' | 'studio';

interface NovelPlatformHeaderProps {
  activeTab: PlatformTab;
  onTabChange: (tab: PlatformTab) => void;
  projectName?: string;
  onNewProject?: () => void;
  onImport?: () => void;
}

export const NovelPlatformHeader: React.FC<NovelPlatformHeaderProps> = ({
  activeTab,
  onTabChange,
  projectName,
  onNewProject,
  onImport,
}) => {
  return (
    <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 border-b border-white/10 bg-slate-900/80 backdrop-blur-xl">
      <div className="flex items-center gap-2 shrink-0">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-600 to-violet-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
          <BookOpen size={14} className="text-white" />
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-bold text-white leading-tight">Novel/Book</span>
          {projectName && (
            <span className="text-[10px] text-slate-400 truncate max-w-[140px]">{projectName}</span>
          )}
        </div>
      </div>

      <div className="flex-1" />

      <div className="flex items-center rounded-xl bg-slate-800/80 p-0.5 border border-white/10">
        <button
          onClick={() => onTabChange('writing')}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs rounded-lg transition-all duration-200 ${
            activeTab === 'writing'
              ? 'bg-blue-600 text-white shadow-md shadow-blue-500/25'
              : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <PenSquare size={12} />
          <span>Writing</span>
        </button>
        <button
          onClick={() => onTabChange('studio')}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs rounded-lg transition-all duration-200 ${
            activeTab === 'studio'
              ? 'bg-violet-600 text-white shadow-md shadow-violet-500/25'
              : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <Mic size={12} />
          <span>Audiobook Studio</span>
        </button>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-1.5">
        {onImport && (
          <button
            onClick={onImport}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-white/10 transition-colors"
            title="Import novel"
          >
            <FileText size={12} />
            <span className="hidden sm:inline">Import</span>
          </button>
        )}
        {onNewProject && (
          <button
            onClick={onNewProject}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
            title="New project"
          >
            <Sparkles size={12} />
            <span className="hidden sm:inline">New</span>
          </button>
        )}
      </div>
    </div>
  );
};
