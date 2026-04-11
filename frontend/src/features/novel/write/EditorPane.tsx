'use client';
import React, { useRef, useCallback, useEffect } from 'react';
import { Save, Zap, Wand2, Send, AlertCircle } from 'lucide-react';
import { useChapterEditor } from '../hooks/useChapterEditor';
import { ProofreadCluster } from '../../../../components/ProofreadCluster';
import type { GenerationSettings } from '../../../../types';

type ViewMode = 'source' | 'adapted';
type ToastFn = (msg: string, type?: 'success' | 'error' | 'info') => void;

interface EditorPaneProps {
  settings: GenerationSettings;
  onToast: ToastFn;
  onRequestAdapt: (text: string, updateAdapted: (t: string) => void) => void;
  isAdapting: boolean;
  onSendToStudio?: (() => void) | undefined;
  onProofread?: ((mode: 'grammar' | 'flow' | 'novel') => void) | undefined;
  isProofreading?: boolean | undefined;
}

const wordCount = (text: string) => text.trim() ? text.trim().split(/\s+/).length : 0;
const charCount = (text: string) => text.length;

export const EditorPane: React.FC<EditorPaneProps> = ({
  settings,
  onToast,
  onRequestAdapt,
  isAdapting,
  onSendToStudio,
  onProofread,
  isProofreading = false,
}) => {
  const {
    chapterText,
    adaptedOutput,
    isDirty,
    updateChapterText,
    updateAdaptedOutput,
    saveNow,
    recordVersionSnapshot,
  } = useChapterEditor();

  const [viewMode, setViewMode] = React.useState<ViewMode>('source');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Keyboard shortcut: Ctrl+S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveNow();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [saveNow]);

  const handleAdapt = () => {
    recordVersionSnapshot('Pre-adaptation snapshot');
    onRequestAdapt(chapterText, updateAdaptedOutput);
  };

  const displayText = viewMode === 'source' ? chapterText : adaptedOutput;
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (viewMode === 'source') updateChapterText(e.target.value);
    else updateAdaptedOutput(e.target.value);
  };

  const wc = wordCount(displayText);
  const cc = charCount(displayText);

  return (
    <div className="flex flex-col h-full bg-slate-950/40">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-white/10 flex-wrap">
        {/* Source / Adapted toggle */}
        <div className="flex items-center rounded-full bg-slate-800/80 p-0.5 border border-white/10">
          {(['source', 'adapted'] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`px-3 py-1 text-xs rounded-full transition-colors ${
                viewMode === mode
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {mode === 'source' ? 'Source' : 'Adapted'}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {/* Actions */}
        <button
          onClick={() => { saveNow(); onToast('Saved', 'success'); }}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
            isDirty
              ? 'bg-blue-600 hover:bg-blue-500 text-white'
              : 'bg-slate-800 text-slate-400 hover:text-white'
          }`}
          title="Save (Ctrl+S)"
        >
          <Save size={12} />
          <span className="hidden sm:inline">Save</span>
          {isDirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />}
        </button>

        <button
          onClick={handleAdapt}
          disabled={isAdapting || !chapterText.trim()}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-violet-700 hover:bg-violet-600 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
          title="Adapt this chapter"
        >
          {isAdapting ? (
            <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <Wand2 size={12} />
          )}
          <span className="hidden sm:inline">{isAdapting ? 'Adapting…' : 'Adapt'}</span>
        </button>

        {onProofread && (
          <ProofreadCluster
            isBusy={isProofreading}
            onProofread={onProofread}
          />
        )}

        {onSendToStudio && (
          <button
            onClick={onSendToStudio}
            disabled={!chapterText.trim() && !adaptedOutput.trim()}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-rose-700 hover:bg-rose-600 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
            title="Send to Studio for TTS"
          >
            <Send size={12} />
            <span className="hidden sm:inline">Studio</span>
          </button>
        )}
      </div>

      {/* Editor area */}
      <div className="flex-1 min-h-0 relative">
        <textarea
          ref={textareaRef}
          value={displayText}
          onChange={handleChange}
          placeholder={
            viewMode === 'source'
              ? 'Start writing your chapter…'
              : 'Adapted output will appear here after adaptation. You can also edit it directly.'
          }
          className="absolute inset-0 w-full h-full bg-transparent text-slate-100 placeholder-slate-600 resize-none p-4 sm:p-6 text-[15px] leading-[1.75] focus:outline-none font-serif"
          spellCheck
        />
      </div>

      {/* Footer */}
      <div className="shrink-0 flex items-center justify-between px-4 py-1.5 border-t border-white/10 text-[10px] text-slate-500">
        <div className="flex items-center gap-3">
          <span>{wc.toLocaleString()} words</span>
          <span>{cc.toLocaleString()} chars</span>
        </div>
        {isDirty && (
          <div className="flex items-center gap-1 text-amber-400">
            <AlertCircle size={10} />
            <span>Unsaved changes</span>
          </div>
        )}
      </div>
    </div>
  );
};
