import React from 'react';
import { Globe, Languages } from 'lucide-react';
import { LanguageOption } from '../types';
import type { WorkspaceViewportMode } from '../src/shared/ui/useWorkspaceViewport';

interface StudioTranslateBarProps {
  targetLang: string;
  isBusy: boolean;
  languages: LanguageOption[];
  layoutMode?: WorkspaceViewportMode;
  onTargetLang: (lang: string) => void;
  onTranslate: () => void;
}

export const StudioTranslateBar: React.FC<StudioTranslateBarProps> = ({
  targetLang,
  isBusy,
  languages,
  layoutMode = 'desktop',
  onTargetLang,
  onTranslate,
}) => {
  const isPhone = layoutMode === 'phone';
  const isTablet = layoutMode === 'tablet';
  const selectSizeClass = isPhone
    ? 'min-h-9 w-[7.5rem] px-2.5 py-1 text-[11px]'
    : isTablet
      ? 'min-h-10 w-[10rem] px-3 py-1 text-[12px]'
      : 'min-h-10 w-[11rem] px-3 py-1 text-[12px]';
  const runButtonClass = isPhone
    ? 'min-h-9 px-2.5 py-1 text-[11px]'
    : isTablet
      ? 'min-h-10 px-3.5 py-1 text-[12px]'
      : 'min-h-10 px-3.5 py-1 text-[12px]';
  const containerClass = isPhone
    ? 'inline-flex items-center gap-1.5 px-1.5 py-0.5'
    : 'inline-flex items-center gap-2 px-2 py-1';
  const runLabel = isPhone ? 'Run' : 'Run Translate';

  return (
    <div className={`vf-translate-bar relative z-10 ${containerClass}`}>
      <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
        <Languages size={14} className="vf-translate-icon shrink-0" />
        {isPhone ? (
          <span className="sr-only">Translate:</span>
        ) : (
          <span className="vf-translate-label text-[12px] font-bold">Translate:</span>
        )}
        <select
          value={targetLang}
          onChange={(e) => onTargetLang(e.target.value)}
          aria-label="Translation target language"
          className={`vf-theme-select rounded-full border border-current/10 bg-transparent font-bold outline-none cursor-pointer focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 ${selectSizeClass}`}
        >
          {languages.map((lang) => (
            <option key={lang.code} value={lang.name}>
              {lang.name}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        onClick={onTranslate}
        disabled={isBusy}
        className={`vf-translate-run shrink-0 rounded-full font-bold transition-colors flex items-center gap-1 whitespace-nowrap disabled:opacity-55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 ${runButtonClass}`}
        aria-label="Run translate"
      >
        <Globe size={13} />
        {runLabel}
      </button>
    </div>
  );
};
