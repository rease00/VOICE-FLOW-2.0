'use client';
import React from 'react';
import { Clock, Type, AlignLeft, Save, AlertCircle } from 'lucide-react';

interface WritingStatusBarProps {
  wordCount: number;
  charCount: number;
  lineCount: number;
  isDirty: boolean;
  lastSavedAt: string | null;
  isZenMode: boolean;
  onToggleZen: () => void;
  writingTheme: 'dark' | 'light' | 'sepia';
  onChangeTheme: (theme: 'dark' | 'light' | 'sepia') => void;
}

const readingTimeMinutes = (words: number): string => {
  const mins = Math.max(1, Math.round(words / 238));
  return mins < 60 ? `${mins} min read` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
};

export const WritingStatusBar: React.FC<WritingStatusBarProps> = ({
  wordCount,
  charCount,
  lineCount,
  isDirty,
  lastSavedAt,
  isZenMode,
  onToggleZen,
  writingTheme,
  onChangeTheme,
}) => {
  return (
    <div className="shrink-0 flex items-center justify-between px-4 py-1.5 border-t border-white/10 text-[10px] text-slate-500 bg-slate-900/60 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1" title="Word count">
          <Type size={9} />
          {wordCount.toLocaleString()} words
        </span>
        <span className="flex items-center gap-1" title="Character count">
          {charCount.toLocaleString()} chars
        </span>
        <span className="flex items-center gap-1 hidden sm:flex" title="Reading time">
          <Clock size={9} />
          {readingTimeMinutes(wordCount)}
        </span>
        <span className="hidden md:inline">{lineCount} lines</span>
      </div>

      <div className="flex items-center gap-2">
        {/* Theme quick switch */}
        <div className="flex items-center gap-0.5 mr-1">
          {(['dark', 'sepia', 'light'] as const).map(theme => (
            <button
              key={theme}
              onClick={() => onChangeTheme(theme)}
              className={`w-4 h-4 rounded-full border transition-all ${
                writingTheme === theme
                  ? 'border-blue-400 scale-110'
                  : 'border-white/20 hover:border-white/40'
              }`}
              style={{
                backgroundColor:
                  theme === 'dark' ? '#0f172a' :
                  theme === 'sepia' ? '#f5e6d0' :
                  '#ffffff',
              }}
              title={`${theme} theme`}
            />
          ))}
        </div>

        <button
          onClick={onToggleZen}
          className={`px-1.5 py-0.5 rounded text-[9px] transition-colors ${
            isZenMode ? 'bg-blue-600 text-white' : 'text-slate-500 hover:text-white hover:bg-white/10'
          }`}
          title="Zen mode (Ctrl+Shift+F)"
        >
          Zen
        </button>

        {isDirty ? (
          <span className="flex items-center gap-1 text-amber-400">
            <AlertCircle size={9} />
            Unsaved
          </span>
        ) : lastSavedAt ? (
          <span className="flex items-center gap-1">
            <Save size={9} />
            Saved {new Date(lastSavedAt).toLocaleTimeString()}
          </span>
        ) : null}
      </div>
    </div>
  );
};
