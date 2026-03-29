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

  return (
    <div className={`vf-translate-bar relative z-10 gap-2 px-4 py-2 ${isPhone ? 'flex items-center' : 'flex items-center justify-between'}`}>
      <div className={`overflow-hidden ${isPhone ? 'w-full min-w-0' : 'flex items-center gap-2'}`}>
        <div className={`flex items-center gap-2 overflow-hidden ${isPhone ? 'w-full min-w-0' : ''}`}>
        <Languages size={14} className="vf-translate-icon shrink-0" />
        <span className={`vf-translate-label text-xs font-bold ${isPhone ? 'sr-only' : 'hidden sm:inline'}`}>Translate:</span>
        <div className={`vf-translate-shell vf-translate-tabs p-0.5 shadow-sm custom-scrollbar ${isPhone ? 'flex min-w-0 items-center gap-1 overflow-x-auto rounded-xl' : 'flex items-center gap-1 overflow-x-auto'}`}>
          <button
            onClick={() => onTargetLang('Hinglish')}
            className={`vf-translate-chip rounded-md px-3 py-1 text-[10px] font-bold transition-[background-color,border-color,color,box-shadow,transform,opacity,filter] whitespace-nowrap ${targetLang === 'Hinglish' ? 'vf-translate-chip--active' : ''}`}
          >
            Hinglish
          </button>
          <button
            onClick={() => onTargetLang('English')}
            className={`vf-translate-chip px-2 py-1 text-[10px] font-bold rounded-md transition-[background-color,border-color,color,box-shadow,transform,opacity,filter] whitespace-nowrap ${targetLang === 'English' ? 'vf-translate-chip--active' : ''}`}
          >
            English
          </button>
          <button
            onClick={() => onTargetLang('Hindi')}
            className={`vf-translate-chip px-2 py-1 text-[10px] font-bold rounded-md transition-[background-color,border-color,color,box-shadow,transform,opacity,filter] whitespace-nowrap ${targetLang === 'Hindi' ? 'vf-translate-chip--active' : ''}`}
          >
            Hindi
          </button>
          <select
            value={targetLang}
            onChange={(e) => onTargetLang(e.target.value)}
            className={`vf-theme-select bg-transparent px-2 py-1 text-[10px] font-bold outline-none cursor-pointer ${
              isPhone
                ? 'min-w-[7.2rem] max-w-[8.4rem] rounded-md border border-current/10'
                : isTablet
                  ? 'max-w-[120px]'
                  : 'max-w-[96px]'
            }`}
          >
            {languages.map((lang) => (
              <option key={lang.code} value={lang.name}>{lang.name}</option>
            ))}
          </select>
        </div>
        </div>
      </div>
      <button
        onClick={onTranslate}
        disabled={isBusy}
        className={`vf-translate-run rounded-lg px-3 py-1.5 text-xs font-bold transition-colors flex items-center gap-1 whitespace-nowrap disabled:opacity-55 ${
          isPhone ? 'shrink-0 px-2.5 py-1.5 text-[11px]' : ''
        }`}
      >
        <Globe size={12} />
        {isPhone ? 'Run' : 'Run Translate'}
      </button>
    </div>
  );
};

