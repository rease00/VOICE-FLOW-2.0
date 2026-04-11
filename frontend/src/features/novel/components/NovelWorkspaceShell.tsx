'use client';
import React, { useState } from 'react';
import { BookOpen, PenSquare } from 'lucide-react';
import type { GenerationSettings } from '../../../../types';
import { NovelEditorProvider, useNovelEditor } from '../contexts/NovelEditorContext';
import { ProjectListPage } from '../write/ProjectListPage';
import { NovelEditorShell } from '../write/NovelEditorShell';

type InternalView = 'projects' | 'editor';

type ToastFn = (msg: string, type?: 'success' | 'error' | 'info') => void;

interface NovelWorkspaceShellProps {
  settings: GenerationSettings;
  mediaBackendUrl: string;
  onToast: ToastFn;
  onSendToStudio?: ((content: string) => void) | undefined;
}

const ShellInner: React.FC<NovelWorkspaceShellProps> = ({
  settings,
  mediaBackendUrl,
  onToast,
  onSendToStudio,
}) => {
  const [view, setView] = useState<InternalView>('projects');
  const { selectProject, isHydrating } = useNovelEditor();

  const handleOpenProject = (projectId: string) => {
    selectProject(projectId);
    setView('editor');
  };

  if (isHydrating) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <div className="w-8 h-8 border-2 border-slate-600 border-t-blue-500 rounded-full animate-spin" />
          <p className="text-sm">Loading novels…</p>
        </div>
      </div>
    );
  }

  if (view === 'editor') {
    return (
      <NovelEditorShell
        settings={settings}
        mediaBackendUrl={mediaBackendUrl}
        onToast={onToast}
        onSendToStudio={onSendToStudio ? (text, title) => onSendToStudio(text) : undefined}
        onBack={() => setView('projects')}
      />
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-950">
      {/* Mini header */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-white/10 bg-slate-900/70">
        <div className="flex items-center gap-2">
          <BookOpen size={16} className="text-blue-400" />
          <span className="text-sm font-semibold text-white">Novel</span>
        </div>
        <div className="flex-1" />
        <button
          onClick={() => setView('editor')}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-blue-700 hover:bg-blue-600 text-white transition-colors"
        >
          <PenSquare size={12} />
          Open Editor
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <ProjectListPage onOpenProject={handleOpenProject} />
      </div>
    </div>
  );
};

export const NovelWorkspaceShell: React.FC<NovelWorkspaceShellProps> = (props) => (
  <NovelEditorProvider>
    <ShellInner {...props} />
  </NovelEditorProvider>
);
