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
    ? 'min-h-8 w-[clamp(5.5rem,24vw,6.25rem)] px-2 py-1 text-[10px]'
    : isTablet
      ? 'min-h-10 w-[clamp(7rem,18vw,8.75rem)] px-2.5 py-1.5 text-[11px]'
      : 'min-h-10 w-[clamp(8rem,16vw,10.5rem)] px-3 py-1.5 text-[11px]';
  const runButtonClass = isPhone
    ? 'min-h-8 px-2 py-1 text-[10px]'
    : isTablet
      ? 'min-h-10 px-3 py-1.5 text-[11px]'
      : 'min-h-10 px-3 py-1.5 text-[11px]';
  const containerClass = isPhone
    ? 'inline-flex items-center gap-1 px-0.5 py-0'
    : 'inline-flex items-center gap-1.5 px-1.5 py-0.5';
  const runLabel = isPhone ? 'Go' : 'Translate';

  return (
    <div className={`vf-translate-bar relative z-10 ${containerClass}`}>
      <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
        <Languages size={isPhone ? 12 : 14} className="vf-translate-icon shrink-0" />
        <span className="sr-only">Translate to:</span>
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
        aria-label="Translate script and replace the editor text"
        title="Translate the full script and replace the current editor text"
      >
        <Globe size={isPhone ? 12 : 13} />
        {runLabel}
      </button>
    </div>
  );
};
