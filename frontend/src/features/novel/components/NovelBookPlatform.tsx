'use client';
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { BookOpen, Mic, PenSquare, Sparkles, ChevronRight } from 'lucide-react';
import type { GenerationSettings } from '../../../../types';
import { NovelEditorProvider, useNovelEditor } from '../contexts/NovelEditorContext';
import { ProjectListPage } from '../write/ProjectListPage';
import { NovelEditorShell } from '../write/NovelEditorShell';

export type PlatformView = 'writing' | 'studio';

type ToastFn = (msg: string, type?: 'success' | 'error' | 'info') => void;

interface NovelBookPlatformInnerProps {
  settings: GenerationSettings;
  onToast: ToastFn;
  onSwitchToStudio?: ((content: string, title?: string) => void) | undefined;
  embeddedMode?: boolean;
}

const NovelBookPlatformInner: React.FC<NovelBookPlatformInnerProps> = ({
  settings,
  onToast,
  onSwitchToStudio,
  embeddedMode = false,
}) => {
  const [platformView, setPlatformView] = useState<PlatformView>('writing');
  const [internalView, setInternalView] = useState<'projects' | 'editor'>('projects');
  const { selectProject, isHydrating, selectedProject, chapters } = useNovelEditor();

  const handleOpenProject = (projectId: string) => {
    selectProject(projectId);
    setInternalView('editor');
  };

  const handleSwitchToStudio = useCallback((content: string, title?: string) => {
    if (onSwitchToStudio) {
      onSwitchToStudio(content, title);
    } else {
      setPlatformView('studio');
    }
  }, [onSwitchToStudio]);

  useEffect(() => {
    if (!embeddedMode) return;
    setPlatformView('writing');
  }, [embeddedMode]);

  if (isHydrating) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <div className="w-8 h-8 border-2 border-slate-600 border-t-blue-500 rounded-full animate-spin" />
          <p className="text-sm">Loading novels...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col h-full overflow-hidden ${embeddedMode ? 'bg-transparent' : 'bg-slate-950'}`}
      data-platform-view={platformView}
      data-testid={embeddedMode ? 'embedded-writer-platform' : 'novel-workspace'}
    >
      {!embeddedMode ? (
      <div className="shrink-0 border-b border-white/10 bg-slate-900/90 backdrop-blur-xl">
        <div className="flex items-center gap-3 px-4 py-2.5">
          {/* Brand */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-600 to-violet-600 flex items-center justify-center">
              <BookOpen size={14} className="text-white" />
            </div>
            <span className="text-sm font-semibold text-white hidden sm:inline">Novel/Book</span>
          </div>

          {/* In-page Tab Switcher */}
          <div className="flex items-center rounded-xl bg-slate-800/80 p-1 border border-white/10 ml-2">
            <button
              onClick={() => setPlatformView('writing')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-all duration-200 ${
                platformView === 'writing'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <PenSquare size={13} />
              Writing
            </button>
            <button
              onClick={() => setPlatformView('studio')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-all duration-200 ${
                platformView === 'studio'
                  ? 'bg-violet-600 text-white shadow-lg shadow-violet-600/25'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Mic size={13} />
              Audiobook Studio
            </button>
          </div>

          <div className="flex-1" />

          {/* Quick context info */}
          {platformView === 'writing' && selectedProject && internalView === 'editor' && (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="hidden md:inline">{selectedProject.name}</span>
              <span className="hidden md:inline text-slate-600">·</span>
              <span className="hidden md:inline">{chapters.length} chapters</span>
            </div>
          )}

          {platformView === 'studio' && (
            <div className="flex items-center gap-1.5 text-xs text-violet-300 bg-violet-500/15 px-2.5 py-1 rounded-lg border border-violet-500/25">
              <Sparkles size={11} />
              <span className="hidden sm:inline">Generate audio from your novel</span>
            </div>
          )}
        </div>
      </div>
      ) : null}

      {/* Content Area */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {platformView === 'writing' ? (
          internalView === 'editor' ? (
            <NovelEditorShell
              settings={settings}
              onToast={onToast}
              onSendToStudio={handleSwitchToStudio}
              onBack={() => setInternalView('projects')}
            />
          ) : (
            <div className="flex flex-col h-full overflow-hidden">
              <div className="flex-1 min-h-0 overflow-y-auto">
                <ProjectListPage onOpenProject={handleOpenProject} />
              </div>
            </div>
          )
        ) : (
          <StudioPlaceholder
            onSwitchToWriting={() => setPlatformView('writing')}
            onSendToStudio={onSwitchToStudio}
          />
        )}
      </div>
    </div>
  );
};

const StudioPlaceholder: React.FC<{
  onSwitchToWriting: () => void;
  onSendToStudio?: ((content: string, title?: string) => void) | undefined;
}> = ({ onSwitchToWriting, onSendToStudio }) => {
  const { selectedProject, chapters, selectedChapter } = useNovelEditor();
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);

  const chapterToSend = chapters.find(c => c.id === selectedChapterId) || selectedChapter;

  return (
    <div className="flex flex-col items-center justify-center h-full px-6 py-12 gap-8">
      <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-600/30 to-blue-600/30 border border-violet-500/30 flex items-center justify-center">
        <Mic size={32} className="text-violet-400" />
      </div>

      <div className="text-center max-w-md">
        <h2 className="text-xl font-bold text-white mb-2">Audiobook Studio</h2>
        <p className="text-sm text-slate-400 leading-relaxed">
          Send your novel chapters to the Studio for text-to-speech generation. Select a chapter and click generate.
        </p>
      </div>

      {selectedProject && chapters.length > 0 && (
        <div className="w-full max-w-lg space-y-3">
          <p className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Select a chapter to generate</p>
          <div className="max-h-64 overflow-y-auto rounded-xl border border-white/10 bg-slate-800/50 divide-y divide-white/5">
            {chapters.map((ch) => (
              <button
                key={ch.id}
                onClick={() => setSelectedChapterId(ch.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                  selectedChapterId === ch.id
                    ? 'bg-violet-600/20 border-l-2 border-l-violet-500'
                    : 'hover:bg-white/5'
                }`}
              >
                <span className="text-[10px] text-slate-500 font-mono w-5 text-right shrink-0">{ch.index}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-white truncate">{ch.title}</p>
                  <p className="text-[10px] text-slate-500">
                    {ch.text.trim() ? `${ch.text.trim().split(/\s+/).length.toLocaleString()} words` : 'Empty'}
                  </p>
                </div>
                {selectedChapterId === ch.id && (
                  <ChevronRight size={12} className="text-violet-400 shrink-0" />
                )}
              </button>
            ))}
          </div>

          <button
            onClick={() => {
              if (chapterToSend && onSendToStudio) {
                onSendToStudio(chapterToSend.adaptedText?.trim() || chapterToSend.text, chapterToSend.title);
              }
            }}
            disabled={!chapterToSend?.text?.trim() || !onSendToStudio}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-all duration-200 shadow-lg shadow-violet-600/20"
          >
            <Mic size={16} />
            Generate Audiobook
          </button>
        </div>
      )}

      {(!selectedProject || chapters.length === 0) && (
        <div className="text-center space-y-3">
          <p className="text-sm text-slate-500">No chapters available yet</p>
          <button
            onClick={onSwitchToWriting}
            className="flex items-center gap-1.5 mx-auto px-4 py-2 text-xs rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
          >
            <PenSquare size={12} />
            Go to Writing
          </button>
        </div>
      )}

      <button
        onClick={onSwitchToWriting}
        className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
      >
        ← Back to Writing
      </button>
    </div>
  );
};

interface NovelBookPlatformProps {
  settings: GenerationSettings;
  onToast: ToastFn;
  onSwitchToStudio?: ((content: string, title?: string) => void) | undefined;
  embeddedMode?: boolean;
}

export const NovelBookPlatform: React.FC<NovelBookPlatformProps> = (props) => (
  <NovelEditorProvider>
    <NovelBookPlatformInner {...props} />
  </NovelEditorProvider>
);
