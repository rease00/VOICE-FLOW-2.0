'use client';
import React, { useState, useCallback } from 'react';
import { BookOpen, Plus, ChevronRight, Mic } from 'lucide-react';
import type { GenerationSettings } from '../../../../types';
import { NovelEditorProvider, useNovelEditor } from '../contexts/NovelEditorContext';
import { ProjectListPage } from '../write/ProjectListPage';
import { NovelEditorShell } from '../write/NovelEditorShell';

type ToastFn = (msg: string, type?: 'success' | 'error' | 'info') => void;

interface LibraryPlatformProps {
  settings: GenerationSettings;
  onToast: ToastFn;
  onSwitchToStudio?: ((content: string) => void) | undefined;
}

const LibraryPlatformInner: React.FC<LibraryPlatformProps> = ({
  settings,
  onToast,
  onSwitchToStudio,
}) => {
  const [view, setView] = useState<'library' | 'editor'>('library');
  const { selectProject, isHydrating, selectedProject, chapters } = useNovelEditor();

  const handleOpenProject = (projectId: string) => {
    selectProject(projectId);
    setView('editor');
  };

  if (isHydrating) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <div className="w-8 h-8 border-2 border-slate-600 border-t-blue-500 rounded-full animate-spin" />
          <p className="text-sm">Loading library...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-950">
      {/* Platform Header */}
      <div className="shrink-0 border-b border-white/10 bg-slate-900/90 backdrop-blur-xl">
        <div className="flex items-center gap-3 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-600 to-violet-600 flex items-center justify-center">
              <BookOpen size={14} className="text-white" />
            </div>
            <span className="text-sm font-semibold text-white hidden sm:inline">Library</span>
          </div>

          <div className="flex-1" />

          {view === 'editor' && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setView('library')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
              >
                <ChevronRight size={12} />
                Back to Library
              </button>
              <button
                onClick={() => onSwitchToStudio && selectedProject && onSwitchToStudio(selectedProject.id)}
                disabled={!selectedProject || !onSwitchToStudio}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-violet-700 hover:bg-violet-600 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
              >
                <Mic size={12} />
                Generate Audiobook
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {view === 'library' ? (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <ProjectListPage onOpenProject={handleOpenProject} />
          </div>
        ) : (
          <NovelEditorShell
            settings={settings}
            onToast={onToast}
            onSendToStudio={onSwitchToStudio}
            onBack={() => setView('library')}
          />
        )}
      </div>
    </div>
  );
};

export const LibraryPlatform: React.FC<LibraryPlatformProps> = (props) => (
  <NovelEditorProvider>
    <LibraryPlatformInner {...props} />
  </NovelEditorProvider>
);
