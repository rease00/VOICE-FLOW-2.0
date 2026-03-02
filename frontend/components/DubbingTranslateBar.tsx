import React from 'react';
import { FileAudio, Globe, Type } from 'lucide-react';
import { LanguageOption } from '../types';

interface DubbingTranslateBarProps {
  targetLang: string;
  isBusy: boolean;
  hasDubScript: boolean;
  hasVideoFile: boolean;
  isDarkUi?: boolean;
  languages: LanguageOption[];
  onTargetLang: (lang: string) => void;
  onTranslateText: () => void;
  onTranslateAudio: () => void;
}

export const DubbingTranslateBar: React.FC<DubbingTranslateBarProps> = ({
  targetLang,
  isBusy,
  hasDubScript,
  hasVideoFile,
  isDarkUi = false,
  languages,
  onTargetLang,
  onTranslateText,
  onTranslateAudio,
}) => {
  return (
    <div className={`vf-translate-bar px-4 py-2.5 backdrop-blur-sm border-b relative z-10 ${
      isDarkUi
        ? 'bg-gradient-to-r from-slate-900/90 to-slate-800/85 border-slate-700/90'
        : 'bg-gradient-to-r from-blue-50/80 to-indigo-50/80 border-gray-100'
    }`}>
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2 min-w-[12rem]">
          <Globe size={14} className={`shrink-0 ${isDarkUi ? 'text-cyan-300' : 'text-blue-600'}`} />
          <span className={`text-[10px] font-black uppercase tracking-wide ${isDarkUi ? 'text-cyan-200' : 'text-blue-700'}`}>Target</span>
          <div className={`vf-translate-shell flex items-center gap-1 rounded-lg px-1 py-0.5 shadow-sm ${
            isDarkUi ? 'bg-slate-900 border border-slate-600' : 'bg-white border border-blue-100'
          }`}>
            <select
              value={targetLang}
              onChange={(e) => onTargetLang(e.target.value)}
              className={`vf-theme-select h-8 min-w-[8.75rem] px-2 text-[11px] font-semibold bg-transparent outline-none cursor-pointer ${
                isDarkUi ? 'text-slate-200 hover:text-white' : 'text-gray-700 hover:text-gray-900'
              }`}
            >
              {languages.map((lang) => (
                <option key={lang.code} value={lang.name}>{lang.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
        <button
          onClick={onTranslateText}
          disabled={isBusy || !hasDubScript}
          className={`h-8 text-[11px] font-bold px-2.5 rounded-lg transition-colors flex items-center gap-1 whitespace-nowrap disabled:opacity-55 ${
            isDarkUi ? 'text-slate-300 hover:bg-slate-800' : 'text-gray-700 hover:bg-gray-100'
          }`}
          title="Translate existing text in editor"
        >
          <Type size={12} />
          Text
        </button>
        <button
          onClick={onTranslateAudio}
          disabled={!hasVideoFile || isBusy}
          className={`h-8 text-[11px] font-bold px-2.5 rounded-lg transition-colors flex items-center gap-1 whitespace-nowrap disabled:opacity-55 ${
            isDarkUi ? 'text-cyan-300 hover:bg-cyan-500/15' : 'text-blue-700 hover:bg-blue-100'
          }`}
          title="Translate audio from video file"
        >
          <FileAudio size={12} />
          Audio
        </button>
        </div>
      </div>
    </div>
  );
};

