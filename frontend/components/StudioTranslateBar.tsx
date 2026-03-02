import React from 'react';
import { Globe, Languages } from 'lucide-react';
import { LanguageOption } from '../types';

interface StudioTranslateBarProps {
  targetLang: string;
  isBusy: boolean;
  languages: LanguageOption[];
  onTargetLang: (lang: string) => void;
  onTranslate: () => void;
}

export const StudioTranslateBar: React.FC<StudioTranslateBarProps> = ({
  targetLang,
  isBusy,
  languages,
  onTargetLang,
  onTranslate,
}) => {
  return (
    <div className="vf-translate-bar px-4 py-2 flex items-center justify-between gap-2 relative z-10">
      <div className="flex items-center gap-2 overflow-hidden">
        <Languages size={14} className="vf-translate-icon shrink-0" />
        <span className="vf-translate-label text-xs font-bold hidden sm:inline">Translate:</span>
        <div className="vf-translate-shell vf-translate-tabs flex items-center gap-1 p-0.5 shadow-sm overflow-x-auto custom-scrollbar">
          <button
            onClick={() => onTargetLang('Hinglish')}
            className={`vf-translate-chip px-3 py-1 text-[10px] font-bold rounded-md transition-all whitespace-nowrap ${targetLang === 'Hinglish' ? 'vf-translate-chip--active' : ''}`}
          >
            Hinglish
          </button>
          <button
            onClick={() => onTargetLang('English')}
            className={`vf-translate-chip px-2 py-1 text-[10px] font-bold rounded-md transition-all whitespace-nowrap ${targetLang === 'English' ? 'vf-translate-chip--active' : ''}`}
          >
            English
          </button>
          <button
            onClick={() => onTargetLang('Hindi')}
            className={`vf-translate-chip px-2 py-1 text-[10px] font-bold rounded-md transition-all whitespace-nowrap ${targetLang === 'Hindi' ? 'vf-translate-chip--active' : ''}`}
          >
            Hindi
          </button>
          <select
            value={targetLang}
            onChange={(e) => onTargetLang(e.target.value)}
            className="vf-theme-select px-2 py-1 text-[10px] font-bold bg-transparent outline-none cursor-pointer max-w-[96px]"
          >
            {languages.map((lang) => (
              <option key={lang.code} value={lang.name}>{lang.name}</option>
            ))}
          </select>
        </div>
      </div>
        <button
          onClick={onTranslate}
          disabled={isBusy}
        className="vf-translate-run text-xs font-bold px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 whitespace-nowrap disabled:opacity-55"
      >
        <Globe size={12} />
        Run Translate
      </button>
    </div>
  );
};

