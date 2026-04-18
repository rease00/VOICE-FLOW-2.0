'use client';
import React, { useRef, useCallback, useEffect, useState, useMemo } from 'react';
import { Save, Zap, Wand2, Send, AlertCircle, Maximize2, Minimize2, Eye, EyeOff } from 'lucide-react';
import { useChapterEditor } from '../hooks/useChapterEditor';
import { ProofreadCluster } from '../../../../components/ProofreadCluster';
import { WritingStatusBar } from './WritingStatusBar';
import type { GenerationSettings } from '../../../../types';

type ViewMode = 'source' | 'adapted';
type WritingTheme = 'dark' | 'light' | 'sepia';
type ToastFn = (msg: string, type?: 'success' | 'error' | 'info') => void;

interface EditorPaneProps {
  settings: GenerationSettings;
  onToast: ToastFn;
  onRequestAdapt: (text: string, updateAdapted: (t: string) => void) => void;
  isAdapting: boolean;
  onSendToStudio?: (() => void) | undefined;
  onProofread?: ((mode: 'grammar' | 'flow' | 'novel') => void) | undefined;
  isProofreading?: boolean | undefined;
  onTextChange?: ((text: string) => void) | undefined;
  onSelectionChange?: ((selectedText: string) => void) | undefined;
}

const wordCount = (text: string) => text.trim() ? text.trim().split(/\s+/).length : 0;
const charCount = (text: string) => text.length;
const lineCount = (text: string) => text.split('\n').length;

const THEME_CLASSES: Record<WritingTheme, { bg: string; text: string; placeholder: string; caret: string }> = {
  dark: {
    bg: 'bg-slate-950/40',
    text: 'text-slate-100',
    placeholder: 'placeholder-slate-600',
    caret: 'caret-blue-400',
  },
  sepia: {
    bg: 'bg-[#f5e6d0]/95',
    text: 'text-[#3b2f1e]',
    placeholder: 'placeholder-[#a08c6e]',
    caret: 'caret-[#6b5a3e]',
  },
  light: {
    bg: 'bg-white/95',
    text: 'text-slate-800',
    placeholder: 'placeholder-slate-400',
    caret: 'caret-blue-600',
  },
};

const ZEN_THEME_CLASSES: Record<WritingTheme, { bg: string; text: string; placeholder: string; caret: string }> = {
  dark: { bg: 'bg-slate-950', text: 'text-slate-200', placeholder: 'placeholder-slate-700', caret: 'caret-blue-400' },
  sepia: { bg: 'bg-[#f5e6d0]', text: 'text-[#3b2f1e]', placeholder: 'placeholder-[#a08c6e]', caret: 'caret-[#6b5a3e]' },
  light: { bg: 'bg-white', text: 'text-slate-800', placeholder: 'placeholder-slate-400', caret: 'caret-blue-600' },
};

export const EditorPane: React.FC<EditorPaneProps> = ({
  settings,
  onToast,
  onRequestAdapt,
  isAdapting,
  onSendToStudio,
  onProofread,
  isProofreading = false,
  onTextChange,
  onSelectionChange,
}) => {
  const {
    chapterText,
    adaptedOutput,
    isDirty,
    updateChapterText,
    updateAdaptedOutput,
    saveNow,
    recordVersionSnapshot,
    lastSavedAt,
  } = useChapterEditor();

  const [viewMode, setViewMode] = React.useState<ViewMode>('source');
  const [isZenMode, setIsZenMode] = useState(false);
  const [writingTheme, setWritingTheme] = useState<WritingTheme>(() => {
    try {
      const stored = localStorage.getItem('vf_writing_theme');
      if (stored === 'light' || stored === 'sepia' || stored === 'dark') return stored;
    } catch {}
    return 'dark';
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [sessionStartWordCount] = useState(() => wordCount(chapterText));
  const [selectedText, setSelectedText] = useState('');

  useEffect(() => {
    if (onTextChange) onTextChange(chapterText);
  }, [chapterText, onTextChange]);

  const handleThemeChange = useCallback((theme: WritingTheme) => {
    setWritingTheme(theme);
    try { localStorage.setItem('vf_writing_theme', theme); } catch {}
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'f') {
        e.preventDefault();
        setIsZenMode(v => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

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

  const handleSelect = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const selected = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd);
    setSelectedText(selected);
    if (onSelectionChange) onSelectionChange(selected);
  }, [onSelectionChange]);

  const wc = wordCount(displayText);
  const cc = charCount(displayText);
  const lc = lineCount(displayText);
  const themeClasses = isZenMode ? ZEN_THEME_CLASSES[writingTheme] : THEME_CLASSES[writingTheme];

  if (isZenMode) {
    return (
      <div className={`fixed inset-0 z-50 flex flex-col ${themeClasses.bg} transition-colors duration-300`}>
        {/* Zen toolbar - minimal, auto-hides */}
        <div className="shrink-0 flex items-center justify-center gap-2 px-4 py-2 opacity-30 hover:opacity-100 transition-opacity duration-300">
          <button
            onClick={() => setIsZenMode(false)}
            className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            title="Exit Zen mode (Ctrl+Shift+F)"
          >
            <Minimize2 size={14} />
          </button>
          <div className="w-px h-3 bg-white/20" />
          <span className="text-[10px] text-slate-500">{wc.toLocaleString()} words</span>
          <span className="text-[10px] text-slate-600">·</span>
          <span className="text-[10px] text-slate-500">{readingTime(wc)}</span>
          {isDirty && (
            <span className="text-[10px] text-amber-400">Unsaved</span>
          )}
          <button
            onClick={() => { saveNow(); onToast('Saved', 'success'); }}
            className="p-1 rounded text-[10px] text-slate-500 hover:text-white transition-colors"
          >
            Save
          </button>
        </div>

        {/* Zen editor - centered, max-width for readability */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-6 py-8 h-full">
            <textarea
              ref={textareaRef}
              value={displayText}
              onChange={handleChange}
              onSelect={handleSelect}
              placeholder={viewMode === 'source' ? 'Let the words flow...' : 'Adapted text...'}
              className={`w-full h-full bg-transparent ${themeClasses.text} ${themeClasses.placeholder} resize-none text-lg leading-[2] focus:outline-none font-serif`}
              spellCheck
            />
          </div>
        </div>
      </div>
    );
  }

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
          <span className="hidden sm:inline">{isAdapting ? 'Adapting...' : 'Adapt'}</span>
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

        <button
          onClick={() => setIsZenMode(true)}
          className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          title="Zen mode (Ctrl+Shift+F)"
        >
          <Maximize2 size={12} />
        </button>
      </div>

      {/* Editor area */}
      <div className="flex-1 min-h-0 relative">
        <textarea
          ref={textareaRef}
          value={displayText}
          onChange={handleChange}
          onSelect={handleSelect}
          placeholder={
            viewMode === 'source'
              ? 'Start writing your chapter...'
              : 'Adapted output will appear here after adaptation. You can also edit it directly.'
          }
          className={`absolute inset-0 w-full h-full bg-transparent ${themeClasses.text} ${themeClasses.placeholder} ${themeClasses.caret} resize-none p-4 sm:p-6 text-[15px] leading-[1.75] focus:outline-none font-serif transition-colors duration-300`}
          spellCheck
        />
      </div>

      {/* Writing Status Bar */}
      <WritingStatusBar
        wordCount={wc}
        charCount={cc}
        lineCount={lc}
        isDirty={isDirty}
        lastSavedAt={lastSavedAt}
        isZenMode={isZenMode}
        onToggleZen={() => setIsZenMode(v => !v)}
        writingTheme={writingTheme}
        onChangeTheme={handleThemeChange}
      />
    </div>
  );
};

const readingTime = (words: number): string => {
  const mins = Math.max(1, Math.round(words / 238));
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
};
