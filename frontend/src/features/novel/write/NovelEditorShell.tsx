'use client';
import React, { useState, useCallback, useEffect } from 'react';
import { PanelLeftClose, PanelLeftOpen, SlidersHorizontal, ArrowLeft, Maximize2, Minimize2 } from 'lucide-react';
import type { GenerationSettings } from '../../../../types';
import { NovelEditorProvider, useNovelEditor } from '../contexts/NovelEditorContext';
import { ChapterSidebar } from './ChapterSidebar';
import { EditorPane } from './EditorPane';
import { ToolsPanel } from './ToolsPanel';
import { ImportModal } from './ImportModal';
import { useAdaptation } from '../hooks/useAdaptation';
import { useChapterEditor } from '../hooks/useChapterEditor';

type ToastFn = (msg: string, type?: 'success' | 'error' | 'info') => void;

interface NovelEditorShellInnerProps {
  settings: GenerationSettings;
  onToast: ToastFn;
  onSendToStudio?: ((text: string, title: string) => void) | undefined;
  onBack?: (() => void) | undefined;
}

const NovelEditorShellInner: React.FC<NovelEditorShellInnerProps> = ({
  settings,
  onToast,
  onSendToStudio,
  onBack,
}) => {
  const { selectedProject, chapters, selectedChapterId, selectedChapter } = useNovelEditor();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [isProofreading, setIsProofreading] = useState(false);
  const [editorSelectedText, setEditorSelectedText] = useState('');

  const { chapterText, adaptedOutput, updateAdaptedOutput } = useChapterEditor();
  const { isAdapting, adaptSingle } = useAdaptation(settings, onToast);

  const handleAdaptRequest = useCallback(
    async (text: string, update: (t: string) => void) => {
      await adaptSingle(text, update);
    },
    [adaptSingle],
  );

  const handleProofread = useCallback(
    async (mode: 'grammar' | 'flow' | 'novel') => {
      if (isProofreading || !selectedChapter) return;
      setIsProofreading(true);
      try {
        const { generateTextContent } = await import('../../../../services/geminiService');
        const prompts: Record<string, string> = {
          grammar: `You are a strict grammar editor. Fix grammar, punctuation, and spelling errors in the following text. Return only the corrected text:\n\n${chapterText}`,
          flow: `You are a prose editor. Improve the sentence flow, rhythm, and readability of the following text. Keep the same content but enhance how it reads:\n\n${chapterText}`,
          novel: `You are a creative writing expert. Review this novel chapter for storytelling quality — improve pacing, vivid description, character voice, and narrative flow. Return the improved text:\n\n${chapterText}`,
        };
        const result = await generateTextContent((prompts[mode] ?? prompts['grammar'])!, chapterText, settings);
        updateAdaptedOutput(result);
        onToast('Proofreading complete', 'success');
      } catch {
        onToast('Proofreading failed', 'error');
      } finally {
        setIsProofreading(false);
      }
    },
    [isProofreading, selectedChapter, chapterText, settings, updateAdaptedOutput, onToast],
  );

  const handleSendToStudio = useCallback(() => {
    if (!selectedChapter || !onSendToStudio) return;
    const text = adaptedOutput.trim() || chapterText;
    onSendToStudio(text, selectedChapter.title);
  }, [selectedChapter, adaptedOutput, chapterText, onSendToStudio]);

  const handleTextChange = useCallback((_text: string) => {}, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'p') {
        e.preventDefault();
        setToolsOpen(v => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar */}
      {sidebarOpen && (
        <div className="w-56 shrink-0 h-full">
          <ChapterSidebar
            onSendToStudio={
              onSendToStudio
                ? (chapterId) => {
                    const ch = chapters.find((c) => c.id === chapterId);
                    if (ch) onSendToStudio(ch.adaptedText?.trim() || ch.text, ch.title);
                  }
                : undefined
            }
          />
        </div>
      )}

      {/* Main area */}
      <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden">
        {/* Top bar */}
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-white/10 bg-slate-900/60">
          {onBack && (
            <button
              onClick={onBack}
              className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
              title="Back to projects"
            >
              <ArrowLeft size={14} />
            </button>
          )}
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            title={sidebarOpen ? 'Hide chapters' : 'Show chapters'}
          >
            {sidebarOpen ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
          </button>

          <div className="flex-1 min-w-0 flex items-center gap-2">
            {selectedProject && (
              <>
                <span className="text-xs text-slate-500">{selectedProject.name}</span>
                {selectedChapter && (
                  <>
                    <span className="text-xs text-slate-600">/</span>
                    <span className="text-xs text-slate-200 truncate">{selectedChapter.title}</span>
                  </>
                )}
              </>
            )}
          </div>

          <ImportModal onToast={onToast} />

          <button
            onClick={() => setToolsOpen((v) => !v)}
            className={`p-1.5 rounded-lg transition-colors ${
              toolsOpen
                ? 'bg-blue-600 text-white'
                : 'hover:bg-white/10 text-slate-400 hover:text-white'
            }`}
            title="Toggle tools panel (Ctrl+Shift+P)"
          >
            <SlidersHorizontal size={14} />
          </button>
        </div>

        {/* Editor + Tools */}
        <div className="flex-1 min-h-0 flex overflow-hidden">
          <div className="flex-1 min-w-0 h-full overflow-hidden">
            {selectedChapter ? (
              <EditorPane
                settings={settings}
                onToast={onToast}
                onRequestAdapt={handleAdaptRequest}
                isAdapting={isAdapting}
                onSendToStudio={onSendToStudio ? handleSendToStudio : undefined}
                onProofread={handleProofread}
                isProofreading={isProofreading}
                onTextChange={handleTextChange}
                onSelectionChange={setEditorSelectedText}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-2">
                <p className="text-sm">Select a chapter from the sidebar</p>
                {chapters.length === 0 && selectedProject && (
                  <p className="text-xs opacity-70">Add a chapter to get started</p>
                )}
              </div>
            )}
          </div>

          <ToolsPanel
            isOpen={toolsOpen}
            onClose={() => setToolsOpen(false)}
            settings={settings}
            onToast={onToast}
            onRequestAdapt={handleAdaptRequest}
            isAdapting={isAdapting}
            editorSelectedText={editorSelectedText}
          />
        </div>
      </div>
    </div>
  );
};

interface NovelEditorShellProps extends NovelEditorShellInnerProps {}

export const NovelEditorShell: React.FC<NovelEditorShellProps> = (props) => (
  <NovelEditorProvider>
    <NovelEditorShellInner {...props} />
  </NovelEditorProvider>
);
